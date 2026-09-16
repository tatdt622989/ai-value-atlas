// Reviewed exact aliases; never infer a different reasoning level or model generation.
import fs from 'node:fs/promises';
import {connectStore,uid,hash} from '../server/store';
import {ARENA_SOURCES,parseArena,makeEvidence} from '../server/sources';
import {CatalogSchema} from '../shared/schema';
import {getField} from '../server/policy';
const aliases:Record<string,string>={astra:'GPT 6 Astra (Max)',fable51:'Claude Fable 5.1 (Max)',opus5:'Claude Opus 5 (Max)',sol:'GPT 5.6 Sol (xHigh)',terra:'GPT 5.6 Terra (xHigh)',luna:'GPT 5.6 Luna (xHigh)',k3:'Kimi K3 (Max)',sonnet5:'Claude Sonnet 5 (High)',hy4:'Hy4 preview',glm52:'GLM 5.2 (Max)',qmax:'Qwen3.8 Max',glm53:'GLM 5.3 (Max)',glmflash:'GLM 5.3 Flash',q27:'Qwen 3.8 27B'};
const store=await connectStore();
try{
 const current=await store.catalog(),candidate=structuredClone(current);
 await fs.writeFile('work/rankings/catalog-before.json',JSON.stringify(current,null,2));
 for(const [id,name] of Object.entries(aliases)){
  const model=candidate.models.find(m=>m.id===id);if(!model)throw new Error(`Unknown model ${id}`);
  const alias=`arena-agent:${name}`;if(!model.aliases.includes(alias))model.aliases.push(alias);
 }
 const glm51=candidate.models.find(m=>m.id==='glm51')!;
 if(!glm51.aliases.includes('glm-5.1'))glm51.aliases.push('glm-5.1');
 const summary=[];
 for(const [category,url] of Object.entries(ARENA_SOURCES)){
  const file=`work/rankings/${category}.html`,raw=await fs.readFile(file,'utf8'),stat=await fs.stat(file);
  const ev=makeEvidence({url,raw,text:'',contentHash:hash(raw),fetchedAt:stat.mtime.toISOString(),lastModified:null},{title:`Arena ${category} leaderboard`,publisher:'Arena',kind:'benchmark'});
  const parsed=parseArena(raw,candidate,ev,category as keyof typeof ARENA_SOURCES);
  ev.sourceUpdatedAt=parsed.benchmarks[0].measuredAt;
  // A compact structured excerpt for audit; original bytes are stored separately.
  ev.excerpt=JSON.stringify(parsed.benchmarks.map(b=>({variant:b.variant,rank:b.rank,score:b.score,rankLow:b.rankLow,rankHigh:b.rankHigh}))).slice(0,16000);
  const prior=candidate.benchmarks.filter(b=>b.source==='arena'&&b.category===category);
  candidate.benchmarks=[...candidate.benchmarks.filter(b=>!prior.includes(b)),...parsed.benchmarks];candidate.evidence.push(ev);
  await store.db.collection('evidence').insertOne({...ev,raw,import:'category-rankings'});
  await store.db.collection('discoveries').insertOne({source:`arena-${category}`,names:parsed.unmatched,createdAt:ev.fetchedAt});
  summary.push({category,url,date:ev.sourceUpdatedAt,matched:parsed.benchmarks.length,cohortSize:parsed.benchmarks[0].cohortSize,top:parsed.benchmarks.slice(0,4).map(b=>({model:b.modelId,rank:b.rank,score:b.score})),unmatched:parsed.unmatched,belowCutoff:parsed.belowCutoff});
 }
 CatalogSchema.parse(candidate);
 for(const lock of current.locks)if((!lock.expiresAt||Date.parse(lock.expiresAt)>Date.now())&&JSON.stringify(getField(current,lock.path))!==JSON.stringify(getField(candidate,lock.path)))throw new Error(`Locked field: ${lock.path}`);
 for(const key of ['research','plans','offers','rateCards'] as const)if(JSON.stringify(current[key])!==JSON.stringify(candidate[key]))throw new Error(`Unexpected ${key} change`);
 const id=uid('stage'),reason='User requested real category leaderboards: reviewed exact model aliases and separate Arena Overall, Code, WebDev and Frontend snapshots. Original research and pricing unchanged.';
 await store.db.collection('staged_catalogs').insertOne({id,baseVersion:current.version,catalog:candidate,status:'pending',createdAt:new Date().toISOString(),reason});
 await fs.writeFile('work/rankings/import-review.json',JSON.stringify({id,baseVersion:current.version,aliases,summary},null,2));
 console.log(JSON.stringify({id,summary},null,2));
}finally{await store.close();}
