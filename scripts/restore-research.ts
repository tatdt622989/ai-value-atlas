import fs from 'node:fs/promises';
import {CatalogSchema,type Catalog,type Plan,type ResearchValue,type Evidence} from '../shared/schema';
import {getField} from '../server/policy';
import {connectStore,hash} from '../server/store';
const filename=process.argv[2];if(!filename)throw new Error('HTML file path required');
const text=await fs.readFile(filename,'utf8'),embedded=text.match(/<script\s+id="data"\s+type="application\/json">([\s\S]*?)<\/script>/)?.[1];if(!embedded)throw new Error('Data JSON not found');
const data=JSON.parse(embedded),checksum=hash(text);const store=await connectStore();
const safe=(s:string)=>s.toLowerCase().replace(/[^a-z0-9._-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
const planMap:Record<string,string>={codex_plus:'chatgpt-plus',codex_pro100:'chatgpt-pro100',codex_pro200:'chatgpt-pro200',claude_pro:'claude-pro',claude_pro_annual:'claude-pro-annual',claude_max5:'claude-max5',claude_max20:'claude-max20',codex_free:'chatgpt-free',codex_go:'chatgpt-go'};
const replaces:Record<string,string>={zLite_off:'zai-lite-glm53-offpeak',zLite_peak:'zai-lite-glm53-peak',zLite_flash:'zai-lite-glmflash-offpeak',oc_glm52:'go-glm52',oc_glm53:'go-glm53',oc_glmflash:'go-glmflash',official_glm53:'baseline-glm53',official_glmflash:'baseline-glmflash',official_glm52:'baseline-glm52'};
try{
 const current=await store.catalog(),next=structuredClone(current),records:ResearchValue[]=[];
 const checkedAt=(date:string)=>new Date(date.length===10?date+'T00:00:00+08:00':date).toISOString();
 function source(url:string,record:any){const id='import-source-'+hash(url).slice(0,16);if(!next.evidence.some(e=>e.id===id)){const at=checkedAt(record.checked_at??data.checked_at);next.evidence.push({id,url,title:'原始研究來源 · '+new URL(url).hostname,publisher:new URL(url).hostname,kind:'community',fetchedAt:at,sourceUpdatedAt:null,contentHash:hash(record.sources??[url]),excerpt:'使用者提供資料所記錄的來源；保留原始檢查日期。此 hash 為匯入來源清單，不代表重新抓取網頁全文。',method:'user-import' as any});}return id;}
 function provider(name:string,url:string){const found=next.providers.find(p=>p.name===name||p.id===name.toLowerCase());if(found)return found;const id='research-'+(safe(name)||hash(name).slice(0,10));const p={id,name,website:new URL(url).origin,trust:'aggregator' as const,regions:['international'],regionNotes:'沿用使用者原始研究，帳號與付款資格依來源條款。'};next.providers.push(p);return p;}
 for(const [type,list] of [['plans',data.plans],['subscriptions',data.subscriptions]] as const)for(const r of list){
  const sub=type==='subscriptions',url=(r.sources??[r.url]).find((s:string)=>s?.startsWith('https://'));
  if(!url)throw new Error(`Source absent for ${r.id}`);
  const pub=provider(sub?r.provider:r.platform,url),mid=sub?(r.unified_model_id??'sol'):r.model_id??r.model;
  let model=next.models.find(m=>m.id===mid);if(!model){const old=data.models.find((m:any)=>m.id===mid);if(!old)throw new Error(`Model ${mid} missing`);model={id:mid,providerId:pub.id,name:old.name,version:old.name,aliases:[],contextWindow:null};next.models.push(model);}
  const at=checkedAt(r.checked_at??data.checked_at),evidenceIds=Array.from(new Set((r.sources??[url]).filter((u:string)=>u.startsWith('https://')).map((u:string)=>source(u,r)))) as string[];
  const freshness={verifiedAt:at,validUntil:new Date(Date.parse(at)+3*86400000).toISOString(),effectiveFrom:null,expiresAt:null,evidenceIds,status:'verified' as const};
  const pid=sub?planMap[r.id]:'research-plan-'+safe(r.id);const point=r.computed??{};
  const cost=sub?r.monthly_usd:(point.paid_usd??r.cash);const annual=sub?r.billing_months===12:r.pricing_mode==='annual';
  const metered=!sub&&r.pricing_mode==='payg';
  let plan=next.plans.find(p=>p.id===pid);
  if(!plan){plan={id:pid,providerId:pub.id,name:sub?r.plan:r.plan,product:sub?r.product:r.platform,kind:cost===0?'free':metered?'prepaid':'subscription',modelIds:[mid],categories:['coding','webdev','frontend','general'],description:(r.note??r.notes??r.limits??'使用者整理的方案資料').slice(0,400),benefits:[],limitations:[r.conditions,r.note,r.notes,r.model_conditions,r.extra_usage].filter((x:unknown)=>typeof x==='string'&&x&&!x.startsWith('http')),billing:{currency:'USD',amount:annual?(r.upfront_usd??r.upfront_cash??cost*12):metered?0:cost,interval:annual?'year':metered?'usage':'month',upfront:r.upfront_usd??point.upfront_usd??r.upfront_cash??cost,minimumPurchase:r.minimum_purchase??(sub?r.upfront_usd:cost),renewalAmount:null,feePercent:0,feeFixed:0,taxIncluded:false},apiRates:null,quota:{kind:'opaque',amount:null,reset:null,hardCap:false,notes:r.limits??r.note??''},availability:'public',audience:'individual',purchaseUrl:url,freshness};if(!plan.limitations.length)plan.limitations=['沿用原始研究的適用條件。'];next.plans.push(plan);}
  const ratio=sub?r.estimated_api_multiple:point.ratio;
  records.push({id:'research-'+safe(r.id),planId:pid,modelId:mid,originalId:r.id,sourceFileHash:checksum,basis:sub?'research-estimate':'research-calculated',modelLabel:sub?r.unified_model_label??model.name:model.name,label:sub?'多來源估算':'原始研究',eligible:Boolean(r.eligible_main),replacedByOfferId:replaces[r.id]??null,monthlyCost:metered?null:cost,cash:cost>0?cost:1,upfrontCost:r.upfront_usd??point.upfront_usd??r.upfront_cash??cost,ratio:typeof ratio==='number'&&Number.isFinite(ratio)?ratio:null,cachedRatio:sub?null:r.cache80?.ratio??null,millionTokens:point.million_tokens??null,cachedMillionTokens:r.cache80?.million_tokens??null,low:r.estimate_low_multiple??null,high:r.estimate_high_multiple??null,confidence:r.estimate_confidence??r.confidence??'',method:r.estimate_method??'沿用原始研究的官方基準、通路費率、額度與匯率換算；保留一般與快取情境。',warning:r.estimate_warning??r.payment_note??'',sourceSamples:r.estimate_sources??[],conditions:[r.limits,r.model_conditions,r.extra_usage,r.note,r.payment_note].filter(Boolean),sharedGroup:sub?pid:'research-group-'+safe((sub?r.provider:r.platform)+'-'+String(r.plan).split('｜')[0]),originalCheckedAt:at,reviewedAt:null,reviewNotes:sub&&['claude_max5','claude_max20'].includes(r.id)?['本輪複查：Real API Pricing 說明 Max 永久額度從 2026-09-14 生效；原研究已引用此來源。原值保留，生效日與權重調整待編輯決定。']:[],freshness});
 }
 next.research=[...next.research.filter(r=>!records.some(x=>x.id===r.id)),...records];
 for(const lock of current.locks)if((!lock.expiresAt||Date.parse(lock.expiresAt)>Date.now())&&JSON.stringify(getField(current,lock.path))!==JSON.stringify(getField(next,lock.path)))throw new Error(`Import would overwrite locked field ${lock.path}`);
 const published=await store.publish(CatalogSchema.parse(next),current.version,'user-requested-restoration','Restore user research, original estimates, source weights and eligible ranking entries. No blanket removal of unofficial data.');
 await fs.writeFile('data/catalog.json',JSON.stringify(published,null,2)+'\n');
 await fs.copyFile(filename,'docs/original-research.html');
 console.log(JSON.stringify({version:published.version,research:records.length,originalMain:records.filter(r=>r.eligible).length,estimates:records.filter(r=>r.basis==='research-estimate'&&r.ratio!==null).length,sourceDatesPreserved:true},null,2));
}finally{await store.close();}
