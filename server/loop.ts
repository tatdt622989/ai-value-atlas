import { type AtlasStore, uid } from './store';
import { ARENA_SOURCES,AA_URL,fetchSource,makeEvidence,parseArena,parseArtificialAnalysis } from './sources';
import { aiReady,research,review } from './ai';
import {newProposal,evaluateProposal,publishProposal} from './policy';
import {VALUE_SOURCES,parseValueSources,applyValueFacts,sourcesUnchanged, type collectValueSources} from './value-sources';
import type { Evidence, Benchmark } from '../shared/schema';

export async function updateLoop(store:AtlasStore,trigger='manual') {
  const lease=await store.claimLease('daily-update',20);if(!lease) return {status:'already-running'};
  // Check again while holding the cross-process lease; simultaneous replicas cannot duplicate a day.
  if(trigger.startsWith('schedule:')&&await store.db.collection('runs').findOne({trigger})) {
    await store.releaseLease('daily-update',lease);return {status:'already-ran'};
  }
  const id=uid('run'),startedAt=new Date().toISOString(),notes:string[]=[];
  await store.db.collection('runs').insertOne({id,trigger,startedAt,status:'running',notes});
  let success=0,failures=0,aiCalls=0;
  try {
    let current=await store.catalog();
    const urls=Array.from(new Set(current.evidence.filter(e=>e.kind==='official-price'||e.kind==='official-terms'||current.research.some(r=>r.freshness.evidenceIds.includes(e.id))).map(e=>e.url)));
    const hosts=new Set([...urls.map(url=>new URL(url).hostname),'arena.ai','artificialanalysis.ai']);
    const collected:Evidence[]=[];
    const valueEntries:Awaited<ReturnType<typeof collectValueSources>>['entries']=[];
    // Bounded concurrency; a failed provider never refreshes its old evidence.
    for(let i=0;i<urls.length;i+=3) {
      const batch=await Promise.allSettled(urls.slice(i,i+3).map(async url=>{
        const meta=current.evidence.find(e=>e.url===url)!;
        const fetched=await fetchSource(url,hosts);
        const evidence=makeEvidence(fetched,meta);
        const key=Object.entries(VALUE_SOURCES).find(([,u])=>u===url)?.[0] as keyof typeof VALUE_SOURCES|undefined;
        if(key)valueEntries.push({key,source:fetched,evidence});
        await store.db.collection('evidence').insertOne({...evidence,raw:fetched.raw,runId:id});return evidence;
      }));
      for(let j=0;j<batch.length;j++){const result=batch[j];if(result.status==='fulfilled'){collected.push(result.value);success++;}else{failures++;notes.push(`${new URL(urls[i+j]).hostname}: ${result.reason?.message??'fetch failed'}`);}}
    }
    const sourceReviews=collected.map(e=>{
      const previous=current.evidence.filter(x=>x.url===e.url).sort((a,b)=>b.fetchedAt.localeCompare(a.fetchedAt))[0];
      const ids=current.research.filter(r=>r.freshness.evidenceIds.some(id=>current.evidence.find(x=>x.id===id)?.url===e.url)).map(r=>r.id);
      return {runId:id,url:e.url,evidenceId:e.id,researchIds:ids,previousHash:previous?.contentHash??null,currentHash:e.contentHash,status:previous?.contentHash===e.contentHash?'unchanged':'needs-review',createdAt:startedAt};
    }).filter(r=>r.researchIds.length);
    if(sourceReviews.length)await store.db.collection('source_reviews').insertMany(sourceReviews);
    notes.push(`已保留 ${current.research.length} 筆原始研究；${sourceReviews.filter(r=>r.status==='needs-review').length} 個研究來源待核對差異，不覆寫原值或權重。`);
    const benchmarkChanges:Benchmark[]=[];const benchmarkEvidence:Evidence[]=[];
    for(const [category,url] of Object.entries(ARENA_SOURCES))try {
      const fetched=await fetchSource(url,hosts);const ev=makeEvidence(fetched,{title:`Arena ${category} 排行榜`,publisher:'Arena',kind:'benchmark'});
      const parsed=parseArena(fetched.raw,current,ev,category as keyof typeof ARENA_SOURCES);benchmarkChanges.push(...parsed.benchmarks);benchmarkEvidence.push(ev);success++;
      await store.db.collection('evidence').insertOne({...ev,raw:fetched.raw,runId:id});
      notes.push(`Arena ${category} 已解析完整榜單中 ${parsed.benchmarks.length} 個已映射模型；${parsed.unmatched.length} 個新／未映射版本保留待審。`);
      await store.db.collection('discoveries').insertOne({runId:id,source:`arena-${category}`,names:parsed.unmatched,createdAt:startedAt});
    } catch(e) {failures++;notes.push(`Arena ${category}: ${(e as Error).message}`);}
    if(process.env.ARTIFICIAL_ANALYSIS_API_KEY) {
      try {
        // Stage all pages first. Any failed page discards the entire AA update.
        const staged:Benchmark[]=[],evs:Evidence[]=[];let page=1;
        while(page<=20) {
          const fetched=await fetchSource(`${AA_URL}?page=${page}`,hosts,{'x-api-key':process.env.ARTIFICIAL_ANALYSIS_API_KEY});
          const ev=makeEvidence({...fetched,text:fetched.raw},{title:'Artificial Analysis Data API',publisher:'Artificial Analysis',kind:'benchmark'});ev.method='api';
          const parsed=parseArtificialAnalysis(JSON.parse(fetched.raw),current,ev);staged.push(...parsed.benchmarks);evs.push(ev);
          await store.db.collection('evidence').insertOne({...ev,raw:fetched.raw,runId:id});
          await store.db.collection('discoveries').insertOne({runId:id,source:'artificial-analysis',names:parsed.unmatched,createdAt:startedAt});
          if(!parsed.pagination.has_more) break;
          if(parsed.pagination.page!==page||page>=20)throw new Error('AA pagination overflow or mismatch');page++;
        }
        benchmarkChanges.push(...staged);benchmarkEvidence.push(...evs);success++;notes.push(`Artificial Analysis 已解析各指數共 ${staged.length} 筆能力資料。`);
      }catch(e){failures++;notes.push(`Artificial Analysis: ${(e as Error).message}`);}
    }else notes.push('Artificial Analysis 未設定 key；未取得 AA 補充評測與速度資料。Arena 四個分類独立蒐集。');
    // Deterministic adapters publish independently from LLM research, only when opt-in is enabled.
    if(benchmarkChanges.length) {
      const unlocked=benchmarkChanges.filter(b=>!current.locks.some(l=>(l.path===`/benchmarks/${b.id}`||l.path.startsWith(`/benchmarks/${b.id}/`))&&(!l.expiresAt||Date.parse(l.expiresAt)>Date.now())));
      const unusual=unlocked.some(b=>{const old=current.benchmarks.find(x=>x.id===b.id);return !old||old.benchmarkVersion!==b.benchmarkVersion||old.harness!==b.harness||Math.abs(old.score-b.score)>Math.max(15,Math.abs(old.score)*0.15);});
      const staged={...current,benchmarks:[...current.benchmarks.filter(b=>!unlocked.some(x=>x.id===b.id)),...unlocked],evidence:[...current.evidence,...benchmarkEvidence]};
      if(process.env.AUTO_PUBLISH==='true'&&!unusual) {
        current=await store.publish(staged,current.version,'verified-source-adapter','Refresh mapped benchmarks from official structured source; no model alias inference.');
      } else {
        await store.db.collection('staged_catalogs').insertOne({id:uid('stage'),runId:id,baseVersion:current.version,catalog:staged,status:'pending',createdAt:startedAt});
        notes.push(unusual?'能力資料包含新測試版本或異常變化，必須人工審核。':'能力資料已暫存，AUTO_PUBLISH 未啟用。');
      }
    }
    // A complete source set is required; partial fetches cannot renew derived value facts.
    if(valueEntries.length===Object.keys(VALUE_SOURCES).length)try{
      const raw=Object.fromEntries(valueEntries.map(e=>[e.key,e.source.raw])) as {zai:string;reference:string;go:string};
      const bundle={entries:valueEntries,facts:parseValueSources(raw)};
      const candidate=applyValueFacts(current,bundle);
      if(process.env.AUTO_PUBLISH==='true'&&sourcesUnchanged(current,bundle)){
        current=await store.publish(candidate,current.version,'verified-value-adapter','All official source bytes unchanged; renew verified prices, limits and rates, preserving locked entities.');
        notes.push('價值資料來源內容完全一致，已核驗續期；人工鎖定保留。');
      }else{
        await store.db.collection('staged_catalogs').insertOne({id:uid('stage'),runId:id,baseVersion:current.version,catalog:candidate,status:'pending',createdAt:startedAt,reason:'Review full official price and quota source changes before publishing value data.'});
        notes.push('價值資料已暫存；來源內容變動或自動發布未啟用，須人工核對完整條款。');
      }
    }catch(e){failures++;notes.push(`價值來源格式／政策異常，未延長有效期：${(e as Error).message}`);}
    else notes.push('價值資料來源未全數取得，未延長任何相關價格或額度有效期。');
    const maxCalls=Number(process.env.MAX_AI_CALLS_PER_RUN??6);
    if(aiReady()&&maxCalls>=2&&collected.length) {
      const finding=await research(current,collected);aiCalls++;
      if(finding.discoveries.length)await store.db.collection('discoveries').insertOne({runId:id,source:'ai-search',items:finding.discoveries,createdAt:startedAt});
      if(finding.changes.length) {
        const proposal=newProposal(current,finding.changes,collected,finding.summary,'ai');
        proposal.review=await review(proposal,current);aiCalls++;
        const verdict=evaluateProposal(current,proposal);proposal.status=verdict.canPublish?'approved':proposal.review.decision==='reject'?'quarantined':'pending';
        await store.db.collection('proposals').insertOne(proposal);
        if(verdict.canPublish&&!verdict.requiresHuman&&process.env.AUTO_PUBLISH==='true')await publishProposal(store,proposal.id,'daily-ai');
        else notes.push(`AI 更新 ${proposal.id} 已進入審核；${verdict.problems.join('；')||'等待人工發布'}`);
      }else notes.push('AI 搜尋完成，未提出符合來源要求的欄位修改。');
    }else notes.push('AI 搜尋／複核尚未設定或呼叫上限不足；本次只蒐集來源，可使用 atlas-data-editor skill 完成。');
    const status=failures?'partial':'completed';
    const result={id,status,startedAt,finishedAt:new Date().toISOString(),notes,success,failures,aiCalls};
    await store.db.collection('runs').updateOne({id},{$set:result});return result;
  } catch(e) {
    const result={id,status:'failed',startedAt,finishedAt:new Date().toISOString(),notes:[...notes,(e as Error).message],success,failures,aiCalls};
    await store.db.collection('runs').updateOne({id},{$set:result});return result;
  } finally {await store.releaseLease('daily-update',lease);}
}
export function startScheduler(store:AtlasStore) {
  if(process.env.UPDATE_SCHEDULE_ENABLED!=='true')return ()=>{};
  const hour=Number(process.env.UPDATE_HOUR_UTC??1);if(!Number.isInteger(hour)||hour<0||hour>23)throw new Error('Invalid UPDATE_HOUR_UTC');
  let active=false;
  const tick=async()=>{
    if(active)return;active=true;
    try {
      const now=new Date();const due=new Date(now);due.setUTCHours(hour,0,0,0);
      if(now<due)return;
      const day=now.toISOString().slice(0,10);
      const previous=await store.db.collection('runs').findOne({$or:[{trigger:`schedule:${day}`},{startedAt:{$gte:due.toISOString()},status:{$in:['completed','partial']}}]});
      if(!previous)await updateLoop(store,`schedule:${day}`);
    }catch(e){console.error('Scheduler error:',(e as Error).message);}finally{active=false;}
  };
  const timer=setInterval(tick,60000);timer.unref();void tick();return ()=>clearInterval(timer);
}
