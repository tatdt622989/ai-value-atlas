import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {CatalogSchema} from '../shared/schema';import {evaluateProposal,newProposal,ProposalSchema} from '../server/policy';import {hash} from '../server/store';
const seed=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8')));
function fixture(){
 const now=new Date();const ev={...seed.evidence.find(e=>e.id==='openai-plus')!,id:'test-evidence',fetchedAt:now.toISOString(),excerpt:'ChatGPT Plus is $22 per month, billed monthly.',contentHash:hash('checked content')};
 const p=newProposal(seed,[{path:'/plans/chatgpt-plus/billing/amount',before:20,after:22,evidenceId:ev.id,quote:ev.excerpt}],[ev],'Official monthly price changed; preserve billing interval.');
 return {p,ev,now:new Date(Math.max(Date.parse(p.createdAt),now.getTime()))};
}
test('verified price change still requires an explicit human publishing decision',()=>{
 const {p,now}=fixture();const result=evaluateProposal(seed,p,now);assert.equal(result.canPublish,true);assert.equal(result.requiresHuman,true);assert.equal(seed.plans[0].billing.amount,20);assert.equal(result.next.plans[0].billing.amount,22);
});
test('human field locks prevent automatic or competing manual overwrite',()=>{
 const {p,now}=fixture(),data=structuredClone(seed);data.locks=[{path:p.changes[0].path,reason:'Verified exception stays until explicitly unlocked.',actor:'editor',createdAt:now.toISOString(),expiresAt:null}];p.baseHash=hash(data);
 assert.ok(evaluateProposal(data,p,now).problems.some(p=>p.includes('人工鎖定')));
});
test('stale base version and old evidence are quarantined',()=>{
 const {p,now}=fixture();p.baseVersion='old-version';p.evidence[0].fetchedAt=new Date(now.getTime()-2*86400000).toISOString();const r=evaluateProposal(seed,p,now);assert.equal(r.canPublish,false);assert.ok(r.problems.length>=2);
});
test('wrong provider domain and invented quote cannot prove a price',()=>{
 const {p,now}=fixture();p.evidence[0].url='https://example.com/fake';p.changes[0].quote='A quotation that does not exist';const r=evaluateProposal(seed,p,now);assert.equal(r.canPublish,false);assert.ok(r.problems.some(p=>p.includes('官方網域')));
});
test('AI cannot self-authorize without a separate review record',()=>{
 const {p,now}=fixture();p.origin='ai';assert.equal(evaluateProposal(seed,p,now).canPublish,false);
 p.review={decision:'approve',reason:'Checked source, amount and billing interval independently.',reviewer:'review-model',reviewedAt:now.toISOString()};assert.equal(evaluateProposal(seed,p,now).canPublish,true);
});
test('unbounded expiration refresh and protected object paths are rejected',()=>{
 const {p,now}=fixture();p.changes=[{path:'/plans/chatgpt-plus/freshness/validUntil',before:seed.plans[0].freshness.validUntil,after:new Date(now.getTime()+10*86400000).toISOString(),evidenceId:p.evidence[0].id,quote:p.evidence[0].excerpt}];assert.equal(evaluateProposal(seed,p,now).canPublish,false);
 p.changes[0].path='/plans/chatgpt-plus/__proto__/admin';assert.equal(ProposalSchema.safeParse(p).success,false);
});
