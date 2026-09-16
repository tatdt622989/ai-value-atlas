import { z } from 'zod';
import { CatalogSchema, EvidenceSchema, type Catalog } from '../shared/schema';
import { hash, uid, type AtlasStore } from './store';

// JSON-pointer paths deliberately address stable IDs, never array indexes.
export const ChangeSchema=z.object({
  path:z.string().regex(/^\/(plans|benchmarks|rateCards|offers)\/[a-z0-9._-]+\/(billing\/(amount|upfront|renewalAmount)|apiRates\/(inputPerMillion|outputPerMillion|cachedInputPerMillion)|freshness\/(verifiedAt|validUntil|expiresAt|status)|score|rank|measuredAt|inputPerMillion|outputPerMillion|cachedInputPerMillion|chargeMultiplier)$/),
  before:z.union([z.string(),z.number(),z.null()]),after:z.union([z.string(),z.number(),z.null()]),
  evidenceId:z.string(),quote:z.string().min(8).max(300),
}).strict();
export const ProposalSchema=z.object({
  id:z.string(),baseVersion:z.string(),baseHash:z.string(),createdAt:z.iso.datetime(),
  origin:z.enum(['ai','human','adapter']),reason:z.string().min(8),
  changes:z.array(ChangeSchema).min(1).max(200),evidence:z.array(EvidenceSchema).min(1).max(100),
  review:z.object({decision:z.enum(['approve','reject','needs-human']),reason:z.string().min(8),reviewer:z.string(),reviewedAt:z.iso.datetime()}).nullable(),
  status:z.enum(['pending','approved','quarantined','published']).default('pending'),
}).strict();
export type Proposal=z.infer<typeof ProposalSchema>;
export function getField(catalog:Catalog,path:string) {
  const [,collection,id,...keys]=path.split('/');
  let node:any=(catalog[collection as 'plans'|'benchmarks'|'rateCards'|'offers'|'research'] as any[])?.find(x=>x.id===id);
  for (const key of keys) node=node?.[key];
  return node;
}
function setField(catalog:Catalog,path:string,value:unknown) {
  const [,collection,id,...keys]=path.split('/');
  let node:any=(catalog[collection as 'plans'|'benchmarks'|'rateCards'|'offers'|'research'] as any[]).find(x=>x.id===id);
  if(!node) throw new Error(`Unknown entity: ${id}`);
  for(const key of keys.slice(0,-1)) node=node[key];
  node[keys.at(-1)!]=value;
}
export function evaluateProposal(current:Catalog,input:unknown,now=new Date()) {
  const p=ProposalSchema.parse(input), problems:string[]=[];
  if(p.baseVersion!==current.version || p.baseHash!==hash(current)) problems.push('版本衝突：必須以目前發布版本重新提案');
  if(Date.parse(p.createdAt)>now.getTime() || now.getTime()-Date.parse(p.createdAt)>86400000) problems.push('提案超過一天或日期在未來');
  const seen=new Set<string>();
  for(const c of p.changes) {
    if(seen.has(c.path)) problems.push(`重複修改欄位 ${c.path}`);seen.add(c.path);
    if(JSON.stringify(getField(current,c.path))!==JSON.stringify(c.before)) problems.push(`原值不一致 ${c.path}`);
    if(current.locks.some(l=>(c.path===l.path || c.path.startsWith(l.path+'/'))&&(!l.expiresAt||Date.parse(l.expiresAt)>now.getTime()))) problems.push(`人工鎖定 ${c.path}`);
    const e=p.evidence.find(x=>x.id===c.evidenceId);
    if(!e) {problems.push(`缺少證據 ${c.path}`);continue;}
    if(e.kind==='community') problems.push(`社群來源不能作為發布依據 ${c.path}`);
    if(Date.parse(e.fetchedAt)>now.getTime() || now.getTime()-Date.parse(e.fetchedAt)>86400000) problems.push(`來源抓取時間無效 ${c.path}`);
    if(!e.excerpt.includes(c.quote)) problems.push(`引文不在來源中 ${c.path}`);
    if(!c.path.startsWith('/benchmarks/')) {
      const collection=c.path.split('/')[1] as 'plans'|'rateCards'|'offers'|'research';
      const plan=current[collection].find(x=>c.path.split('/')[2]===x.id)!;
      if(!plan){problems.push(`未知方案 ${c.path}`);continue;}
      const hosts=plan.freshness.evidenceIds.map(id=>current.evidence.find(x=>x.id===id)).filter(Boolean).map(e=>new URL(e!.url).hostname);
      if(!hosts.includes(new URL(e.url).hostname)||!['official-price','official-terms'].includes(e.kind)) problems.push(`方案必須來自既有官方網域 ${c.path}`);
      if((c.path.includes('/billing/')||c.path.includes('/apiRates/'))&&typeof c.after==='number' && !c.quote.replace(/,/g,'').includes(String(c.after))) problems.push(`引文未支持新價格 ${c.path}`);
      if(c.path.endsWith('/validUntil')) {
        const requiredUrls=new Set(plan.freshness.evidenceIds.map(id=>current.evidence.find(x=>x.id===id)!.url));
        for(const url of requiredUrls) if(!p.evidence.some(x=>x.url===url&&Date.parse(x.fetchedAt)<=now.getTime()&&now.getTime()-Date.parse(x.fetchedAt)<=86400000)) problems.push(`延長有效期必須重新核實所有方案來源 ${url}`);
        if(!p.changes.some(x=>x.path===`/${collection}/${plan.id}/freshness/verifiedAt`)) problems.push(`有效期與核驗時間必須一起更新 ${plan.id}`);
      }
    }
    if(c.path.endsWith('/validUntil') && typeof c.after==='string') {
      const maxAge=c.path.startsWith('/benchmarks/')?7:3;
      if(Date.parse(c.after)>Date.parse(e.fetchedAt)+maxAge*86400000) problems.push(`有效期超出政策 ${c.path}`);
    }
    if(c.path.endsWith('/verifiedAt')&&c.after!==e.fetchedAt) problems.push(`核驗時間必須等於證據時間 ${c.path}`);
  }
  if(p.review && (Date.parse(p.review.reviewedAt)<Date.parse(p.createdAt)||Date.parse(p.review.reviewedAt)>now.getTime())) problems.push('審核日期無效');
  const next=structuredClone(current);
  next.evidence=[...next.evidence.filter(e=>!p.evidence.some(x=>x.id===e.id)),...p.evidence];
  for(const c of p.changes) {
    if(getField(next,c.path)===undefined){problems.push(`未知欄位 ${c.path}`);continue;}
    setField(next,c.path,c.after);
    const [,collection,id]=c.path.split('/');
    const entity=next[collection as 'plans'|'benchmarks'|'rateCards'|'offers'|'research'].find(x=>x.id===id)!;
    entity.freshness.evidenceIds=Array.from(new Set([...entity.freshness.evidenceIds,c.evidenceId]));
  }
  const valid=CatalogSchema.safeParse(next);if(!valid.success) problems.push(valid.error.message);
  const material=p.changes.some(c=>c.path.includes('/billing/')||c.path.includes('/apiRates/')||(/^(\/rateCards\/|\/offers\/)/.test(c.path)&&!c.path.includes('/freshness/'))||c.path.endsWith('/status')||c.path.endsWith('/expiresAt'));
  if(p.origin!=='human' && (!p.review || p.review.decision!=='approve')) problems.push('缺少獨立審核通過紀錄');
  return {proposal:p,next,problems,requiresHuman:material,canPublish:problems.length===0};
}
export async function publishProposal(store:AtlasStore,id:string,actor:string,manual=false,lock=false) {
  const doc=await store.db.collection('proposals').findOne({id});if(!doc) throw new Error('Proposal not found');
  const { _id,...input }=doc;
  if(input.status==='published') throw new Error('Proposal already published');
  const current=await store.catalog();const result=evaluateProposal(current,input);
  if(result.proposal.origin!=='human') for(const evidence of result.proposal.evidence) {
    const stored=await store.db.collection('evidence').findOne({id:evidence.id,contentHash:evidence.contentHash,url:evidence.url});
    if(!stored||stored.fetchedAt!==evidence.fetchedAt||stored.excerpt!==evidence.excerpt) throw new Error('Evidence does not match the independently collected source');
  }
  if(!result.canPublish) throw new Error(result.problems.join('; '));
  if(result.requiresHuman&&!manual) throw new Error('Material changes require an editorial decision');
  if(lock) for(const c of result.proposal.changes) result.next.locks.push({path:c.path,reason:result.proposal.reason,actor,createdAt:new Date().toISOString(),expiresAt:null});
  const published=await store.publish(result.next,current.version,actor,result.proposal.reason);
  await store.db.collection('proposals').updateOne({id},{$set:{status:'published',publishedVersion:published.version,publishedBy:actor}});
  return {version:published.version};
}
export async function editorialReview(store:AtlasStore,id:string,actor:string,decision:'approve'|'reject'|'needs-human',reason:string) {
  const review={decision,reason,reviewer:`human:${actor}`,reviewedAt:new Date().toISOString()};
  const changed=await store.db.collection('proposals').updateOne({id,status:{$ne:'published'}},{$set:{review,status:decision==='reject'?'quarantined':'pending'}});
  if(!changed.matchedCount) throw new Error('Pending proposal not found');
  await store.db.collection('editorial_events').insertOne({proposalId:id,...review});
  return {id,review};
}
export function newProposal(current:Catalog,changes:Proposal['changes'],evidence:Proposal['evidence'],reason:string,origin:Proposal['origin']='human'):Proposal {
  return {id:uid('proposal'),baseVersion:current.version,baseHash:hash(current),createdAt:new Date().toISOString(),origin,reason,changes,evidence,review:null,status:'pending'};
}
