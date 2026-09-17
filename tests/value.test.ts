import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CatalogSchema,ValuePreferencesSchema} from '../shared/schema';
import {planMatchesQuery,rankValues,valueQuote} from '../shared/value';
import {latestVerifiedAt} from '../shared/recommend';
import {sourcesUnchanged} from '../server/value-sources';
const seed=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8')));
const now=new Date('2026-09-11T00:00:00Z');
const prefs=(p:unknown={})=>ValuePreferencesSchema.parse(p);
test('value ordering keeps user estimates in the main list and preserves original values',()=>{
 const result=rankValues(seed,prefs({ranking:'value'}),now);const pro=result.quotes.find(q=>q.plan.id==='claude-pro')!;
 assert.equal(pro.basis,'research-estimate');assert.ok(Math.abs(pro.multiplier-57.48566666666667)<1e-10);
 assert.equal(pro.research?.sourceSamples.length,5);assert.equal(pro.research?.originalCheckedAt,'2026-09-09T16:00:00.000Z');
 assert.ok(result.quotes.every((q,i)=>!i||result.quotes[i-1].multiplier+1e-9>=q.multiplier));
 assert.ok(result.quotes.find(q=>q.plan.id==='chatgpt-plus'));
});
test('official quota arithmetic agrees with documented same-model reference',()=>{
 const offer=seed.offers.find(o=>o.id==='zai-lite-glm53-offpeak')!;const q=valueQuote(seed,offer,prefs(),now);assert.equal(q.ok,true);if(!q.ok)return;
 assert.ok(Math.abs(q.quote.multiplier-8.613264427217914)<1e-9);assert.equal(q.quote.calculation.usableUnits,40000);
 const half=valueQuote(seed,offer,prefs({utilization:'half'}),now);if(!half.ok)assert.fail();assert.equal(half.quote.multiplier,q.quote.multiplier/2);
});
test('cache scenario cannot silently reweight observational model mixes',()=>{
 const normal=rankValues(seed,prefs(),now),cached=rankValues(seed,prefs({profile:'cached'}),now);
 for(const q of normal.quotes.filter(q=>q.basis==='research-estimate'))assert.equal(cached.quotes.find(x=>x.id===q.id)?.multiplier,q.multiplier);
 assert.notEqual(cached.quotes.find(q=>q.id==='zai-lite-glm53-offpeak')?.multiplier,normal.quotes.find(q=>q.id==='zai-lite-glm53-offpeak')?.multiplier);
});
test('expiry applies to any price, limit or official reference dependency without deleting originals',()=>{
 const data=structuredClone(seed);data.rateCards.find(r=>r.id==='zai-api-glm53')!.freshness.validUntil='2026-09-10T23:59:59.000Z';
 assert.ok(!rankValues(data,prefs(),now).quotes.some(q=>q.id==='zai-lite-glm53-offpeak'));
 const future=rankValues(seed,prefs(),new Date('2026-09-25T00:00:00Z'));assert.equal(future.quotes.length,0);assert.equal(seed.research.length,164);
});
test('annual commitment stays optional and upfront cap is honored',()=>{
 assert.ok(!rankValues(seed,prefs(),now).quotes.some(q=>q.plan.id==='claude-pro-annual'));
 assert.ok(rankValues(seed,prefs({allowAnnual:true}),now).quotes.some(q=>q.plan.id==='claude-pro-annual'));
 assert.ok(!rankValues(seed,prefs({allowAnnual:true,upfrontBudget:100}),now).quotes.some(q=>q.plan.id==='claude-pro-annual'));
});
test('new official adapters replace corresponding research rows without doubling a quota',()=>{
 const result=rankValues(seed,prefs(),now);assert.ok(result.quotes.some(q=>q.id==='go-glm53'));assert.ok(!result.quotes.some(q=>q.id==='research-oc_glm53'));
 assert.ok(seed.research.some(q=>q.id==='research-oc_glm53'));
});
test('latest source hash must match; an older matching hash cannot authorize renewal',()=>{
 const old=seed.evidence[0],next={...old,id:'new-evidence',contentHash:'a'.repeat(64),fetchedAt:'2026-09-11T00:00:00.000Z'};
 const data={...seed,evidence:[{...old,fetchedAt:'2026-09-10T00:00:00.000Z'},next]};
 assert.equal(sourcesUnchanged(data,{entries:[{key:'zai',evidence:old}] } as any),false);
 assert.equal(sourcesUnchanged(data,{entries:[{key:'zai',evidence:next}] } as any),true);
});
test('research warning about future effective terms is retained for editorial decision',()=>{
 const q=rankValues(seed,prefs(),now).quotes.find(q=>q.plan.id==='claude-max20');assert.ok(q);assert.ok(q.research?.reviewNotes.some(n=>n.includes('2026-09-14')));
});
test('cross-model or wrong plan references cannot create an artificial multiplier',()=>{
 const data=structuredClone(seed);data.offers[0].modelId='astra';assert.equal(CatalogSchema.safeParse(data).success,false);
});

test('a $10 filter includes OpenCode Go at its actual $10 upfront price',()=>{
 const rows=rankValues(seed,prefs({budget:10}),now).quotes;assert.ok(rows.some(q=>q.id==='go-glmflash'));assert.ok(rows.every(q=>q.monthlyCost===null||q.monthlyCost<=10));
});
test('missing speed data is never treated as meeting a requested speed',()=>{
 assert.equal(rankValues(seed,prefs({minTokensPerSecond:50}),now).quotes.length,0);
});

test('a reviewed monthly price change recomputes research value without modifying the original estimate',()=>{
 const data=structuredClone(seed);data.plans.find(p=>p.id==='chatgpt-plus')!.billing.amount=40;
 const quote=rankValues(data,prefs(),now).quotes.find(q=>q.plan.id==='chatgpt-plus')!;
 assert.equal(quote.monthlyCost,40);assert.equal(quote.multiplier,22.37226666666667/2);assert.equal(quote.research!.ratio,22.37226666666667);
 assert.ok(!rankValues(data,prefs({budget:20}),now).quotes.some(q=>q.plan.id==='chatgpt-plus'));
});
test('category ranking never borrows a different domain and preserves unranked offers',()=>{
 const data=structuredClone(seed);data.benchmarks=data.benchmarks.filter(b=>b.category!=='coding');
 const result=rankValues(data,prefs({category:'coding'}),now);
 assert.ok(result.quotes.length);assert.ok(result.quotes.every(q=>q.benchmark===null));assert.equal(result.ranking.rankedCount,0);
});
test('plans without a reliable multiplier are searchable and visible by linked model name',()=>{
 const data=structuredClone(seed),plan=data.plans.find(p=>p.id==='cursor-pro')!;
 plan.name='Developer Pro';plan.modelIds=['astra'];
 const result=rankValues(data,prefs({query:'GPT-6 Astra'}),now);
 const unknown=result.unknown.find(q=>q.plan.id==='cursor-pro');
 assert.ok(unknown);assert.deepEqual(unknown.modelNames,['GPT-6 Astra']);
});
test('a model query excludes plans that only mention the model in their copy',()=>{
 const data=structuredClone(seed),plan=data.plans.find(p=>p.id==='cursor-pro')!;
 plan.description='This plan does not include GPT-6 Astra.';plan.modelIds=[];
 assert.equal(planMatchesQuery(data,plan,'GPT-6 Astra'),false);
 plan.modelIds=['astra'];assert.equal(planMatchesQuery(data,plan,'GPT-6 Astra'),true);
});

test('ineligible research remains searchable without being misrepresented as a ranked offer',()=>{
 const data=structuredClone(seed),r=data.research.find(r=>r.id==='research-r4_k3')!;
 r.eligible=false;
 const result=rankValues(data,prefs({query:'R4'}),now);
 assert.ok(result.unknown.some(q=>q.plan.id===r.planId));
 assert.ok(!result.quotes.some(q=>q.id===r.id));
});
test('waitlisted research is not ranked and ended plans are not offered for purchase',()=>{
 const data=structuredClone(seed),r=data.research.find(r=>r.id==='research-r4_k3')!,p=data.plans.find(p=>p.id===r.planId)!;
 r.eligible=true;p.availability='waitlist';
 const waiting=rankValues(data,prefs({query:'R4'}),now);
 assert.ok(waiting.unknown.some(q=>q.plan.id===p.id));assert.ok(!waiting.quotes.some(q=>q.id===r.id));
 p.availability='ended';const ended=rankValues(data,prefs({query:'R4'}),now);
 assert.ok(!ended.unknown.some(q=>q.plan.id===p.id));assert.ok(!ended.quotes.some(q=>q.id===r.id));
});
test('unresolved current ratio preserves the plan and original samples in the catalog',()=>{
 const data=structuredClone(seed),r=data.research.find(r=>r.id==='research-claude_pro')!;
 r.ratio=null;
 const result=rankValues(data,prefs({query:'Claude'}),now);
 assert.ok(result.unknown.some(q=>q.plan.id===r.planId));assert.ok(!result.quotes.some(q=>q.id===r.id));
 assert.equal(r.sourceSamples.length,5);
});
test('topbar verification date reports the newest verification, not the oldest retained row',()=>{
 const all=[...seed.plans,...seed.rateCards,...seed.offers,...seed.research,...seed.benchmarks].map(x=>x.freshness.verifiedAt).sort();
 assert.equal(latestVerifiedAt(seed),all.at(-1));
 assert.notEqual(latestVerifiedAt(seed),all[0]);
 const data=structuredClone(seed);
 for(const plan of data.plans){plan.freshness.verifiedAt='2026-09-16T15:00:00.000Z';plan.freshness.validUntil='2026-09-18T15:00:00.000Z';}
 assert.equal(latestVerifiedAt(data),'2026-09-16T15:00:00.000Z');
 assert.equal(latestVerifiedAt({...seed,plans:[],rateCards:[],offers:[],research:[],benchmarks:[]}),null);
});
