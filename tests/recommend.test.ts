import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CatalogSchema,PreferencesSchema} from '../shared/schema';
import {recommend,monthlyCost,isFresh} from '../shared/recommend';
const seed=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8')));
const now=new Date(seed.publishedAt);
const preferences=(overrides={})=>PreferencesSchema.parse({budget:20,...overrides});
test('recommendations never exceed monthly budget, including zero',()=>{
 for(const budget of [0,1,10,20,100,200])for(const mode of ['api','subscription']){
  const result=recommend(seed,preferences({budget,mode}),now);
  assert.ok(result.results.every(r=>r.monthlyCost<=budget));
  if(budget===0&&mode==='subscription')assert.ok(result.results.every(r=>r.plan.kind==='free'));
 }
});
test('stale prices disappear even if no update job runs',()=>{
 const future=new Date(now.getTime()+4*86400000);
 assert.equal(recommend(seed,preferences(),future).results.length,0);
});
test('expired promotion and future effective dates cannot enter results',()=>{
 const data=structuredClone(seed);data.plans=data.plans.slice(0,1);
 data.plans[0].freshness.expiresAt=new Date(now.getTime()-1).toISOString();assert.equal(recommend(data,preferences(),now).results.length,0);
 data.plans[0].freshness.expiresAt=null;data.plans[0].freshness.effectiveFrom=new Date(now.getTime()+1).toISOString();assert.equal(recommend(data,preferences(),now).results.length,0);
});
test('annual cost does not conceal the upfront commitment',()=>{
 const p=seed.plans.find(p=>p.id==='claude-pro-annual')!;assert.equal(monthlyCost(p,preferences()),16.67);
 assert.ok(!recommend(seed,preferences({allowAnnual:true,upfrontBudget:199}),now).results.some(r=>r.plan.id===p.id));
 assert.ok(recommend(seed,preferences({allowAnnual:true,upfrontBudget:200}),now).results.some(r=>r.plan.id===p.id));
});
test('fee and minimum purchase cannot be hidden by low unit prices',()=>{
 const data=structuredClone(seed);data.plans=data.plans.filter(p=>p.id==='api-luna');data.plans[0].billing.minimumPurchase=25;
 assert.equal(recommend(data,preferences({mode:'api'}),now).results.length,0);
 const plan=structuredClone(seed.plans[0]);plan.billing.feePercent=10;plan.billing.feeFixed=1;assert.equal(monthlyCost(plan,preferences()),23);
});
test('API prices use workload and reject unsupported context tiers',()=>{
 const p=seed.plans.find(p=>p.id==='api-sol')!;
 assert.equal(monthlyCost(p,preferences({mode:'api'})),9);
 assert.equal(monthlyCost(p,preferences({mode:'api',workload:{inputTokens:1e6,outputTokens:250000,context:200000}})),null);
});
test('opaque subscription quotas remain unknown, not fabricated token values',()=>{
 const bad=structuredClone(seed);bad.plans[0].quota.amount=1e9;assert.equal(CatalogSchema.safeParse(bad).success,false);
 assert.equal(recommend(seed,preferences(),now).results[0].estimatedRequests,null);
});
test('missing speed or category benchmark does not turn into measured performance',()=>{
 const withoutFrontend=structuredClone(seed);withoutFrontend.benchmarks=withoutFrontend.benchmarks.filter(b=>b.category!=='frontend');
 const result=recommend(withoutFrontend,preferences({priority:'speed',categories:['frontend']}),now);
 assert.ok(result.results.every(r=>r.speedMissing&&r.capability.length===0));
});
test('invalid inputs and currency assumptions fail closed',()=>{
 for(const input of [{budget:-1},{budget:Infinity},{budget:20,currency:'TWD'},{budget:20,categories:[]}])assert.equal(PreferencesSchema.safeParse(input).success,false);
});
test('schema requires referential integrity and valid freshness windows',()=>{
 const bad=structuredClone(seed);bad.plans[0].modelIds=['not-a-model'];assert.equal(CatalogSchema.safeParse(bad).success,false);
 assert.equal(isFresh({...seed.plans[0].freshness,verifiedAt:new Date(now.getTime()+10).toISOString()},now),false);
});
