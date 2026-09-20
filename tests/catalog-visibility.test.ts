import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {CatalogSchema,ValuePreferencesSchema} from '../shared/schema';
import {rankCatalogValues} from '../shared/value';
const seed=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8'))),now=new Date('2026-10-01T00:00:00Z');
const prefs=(value:unknown={})=>ValuePreferencesSchema.parse(value);
const ids=(result:ReturnType<typeof rankCatalogValues>)=>new Set([...result.quotes.map(q=>q.plan.id),...result.unknown.map(q=>q.plan.id)]);
test('an API price record remains visible without fabricating an unrecorded context limit',()=>{
 const c=structuredClone(seed),plan=c.plans.find(p=>p.apiRates)!;plan.apiRates!.maxContext=null;
 const parsed=CatalogSchema.parse(c),result=rankCatalogValues(parsed,prefs(),now);
 assert.ok(ids(result).has(plan.id));assert.equal(parsed.plans.find(p=>p.id===plan.id)!.apiRates!.maxContext,null);
});
test('mixed-model community estimates retain their numerical ratio without inventing a model token count',()=>{
 const catalog=structuredClone(seed),study=catalog.research.find(r=>r.planId==='chatgpt-plus')!;
 study.tokenInference='disabled';study.basis='research-estimate';study.ratio=15.2;study.millionTokens=null;
 const quote=rankCatalogValues(catalog,prefs(),now).quotes.find(q=>q.id===study.id)!;
 assert.equal(quote.multiplier,15.2);assert.equal(quote.calculation.millionTokens,null);assert.equal(quote.recommendation.score,null);assert.equal(quote.benchmark,null);
});
test('the primary catalog contains every plan after review deadlines, including every provider, annual and ended plans',()=>{
 const before=structuredClone(seed);const result=rankCatalogValues(seed,prefs(),now);
 assert.deepEqual([...ids(result)].sort(),seed.plans.map(p=>p.id).sort());
 for(const provider of seed.providers){const actual=ids(rankCatalogValues(seed,prefs({providerId:provider.id}),now));assert.deepEqual([...actual].sort(),seed.plans.filter(p=>p.providerId===provider.id).map(p=>p.id).sort(),provider.id);}
 assert.deepEqual(seed,before);assert.ok(result.quotes.some(q=>q.plan.id==='chatgpt-plus'));assert.ok(result.quotes.some(q=>q.plan.id==='claude-pro'));
});
test('retired research stays in the catalog without appearing as a current primary scenario',()=>{
 const data=structuredClone(seed);for(const r of data.research)r.eligible=false;
 const before=structuredClone(data),result=rankCatalogValues(data,prefs(),now);
 assert.ok(result.quotes.every(q=>q.dataStatus!=='historical'));
 assert.deepEqual([...ids(result)].sort(),data.plans.map(p=>p.id).sort());
 assert.deepEqual(data,before);
 assert.equal(result.ranking.referenceCount,rankCatalogValues({...data,research:[]},prefs(),now).ranking.referenceCount);
});
test('a retired Claude ratio cannot return from audit notes, while its plan stays visible',()=>{
 const data=structuredClone(seed),r=data.research.find(r=>r.planId==='claude-pro')!,original=r.ratio!;
 r.ratio=null;r.reviewNotes.push(`本次修正前：ratio=${original}，method=原始研究`);
 const before=structuredClone(r),result=rankCatalogValues(data,prefs({query:'Claude Pro'}),now);
 assert.ok(!result.quotes.some(q=>q.id===r.id));assert.ok(ids(result).has(r.planId));assert.deepEqual(r,before);
});
test('retired high estimates cannot enter the primary list or recommendation reference',()=>{
 const c=structuredClone(seed),r=c.research.find(r=>r.planId==='claude-max20')!;
 r.eligible=false;r.ratio=99999;
 const result=rankCatalogValues(c,prefs({ranking:'value'}),now);
 assert.ok(!result.quotes.some(q=>q.id===r.id));assert.ok(ids(result).has(r.planId));
});
test('explicit search, annual and budget filters still apply to all retained rows',()=>{
 const result=rankCatalogValues(seed,prefs({providerId:'anthropic',allowAnnual:false,budget:30}),now);
 assert.ok(ids(result).has('claude-pro'));assert.ok(!ids(result).has('claude-pro-annual'));assert.ok(!ids(result).has('claude-max20'));
 assert.equal(ids(rankCatalogValues(seed,prefs({query:'no-such-plan-xyz'}),now)).size,0);
});
