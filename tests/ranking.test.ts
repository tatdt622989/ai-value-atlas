import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CatalogSchema,ValuePreferencesSchema} from '../shared/schema';
import {rankValues,modelReference,type ValueQuote} from '../shared/value';
import {recommendation,efficiencyReference} from '../shared/ranking';
const cat=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8')));
const now=new Date('2026-09-11T00:00:00Z');
const prefs=(p:unknown={})=>ValuePreferencesSchema.parse(p);
function fixture(){
 const q=rankValues(cat,prefs({category:'webdev'}),now).quotes.find(q=>q.calculation.millionTokens!==null&&q.benchmark)!;
 const copy=structuredClone(q);copy.benchmark!.cohortSize=100;copy.benchmark!.rank=10;copy.benchmark!.rankHigh=15;
 copy.calculation.millionTokens=20;copy.calculation.cash=10;return copy;
}
test('a more capable and cheaper option cannot lose to a dominated option',()=>{
 const a=fixture(),b=structuredClone(a);b.calculation.millionTokens=10;b.benchmark!.rank=20;b.benchmark!.rankHigh=25;
 const ref=efficiencyReference([a,b]);assert.ok(recommendation(a,ref).score!>recommendation(b,ref).score!);
});
test('official list-price inflation cannot inflate the comprehensive score',()=>{
 const a=fixture(),b=structuredClone(a);b.multiplier*=100;b.calculation.equivalentUSD*=100;
 const ref=efficiencyReference([a,b]);assert.deepEqual(recommendation(a,ref),recommendation(b,ref));
});
test('cached tokens do not inflate standard-profile efficiency',()=>{
 const a=fixture(),b=structuredClone(a);
 a.calculation.cachedInputShare=0.9;b.calculation.cachedInputShare=0;
 const ref=efficiencyReference([a,b]);assert.ok(recommendation(b,ref).score!>recommendation(a,ref).score!);
 a.calculation.profile='cached';b.calculation.profile='cached';
 const refCached=efficiencyReference([a,b]);assert.equal(recommendation(a,refCached).score,recommendation(b,refCached).score);
});
test('duplicate offers do not manipulate price percentiles',()=>{
 const a=fixture(),b=structuredClone(a);b.calculation.millionTokens=b.calculation.millionTokens!*2;
 assert.deepEqual(efficiencyReference([a,b]),efficiencyReference([a,b,a,b,b]));
});
test('mixed-model research remains present with no fabricated token score',()=>{
 const a=fixture();a.calculation.millionTokens=null;
 assert.equal(recommendation(a,[1,2,3]).score,null);
 const result=rankValues(cat,prefs(),now);
 assert.ok(result.quotes.some(q=>q.basis==='research-estimate'));
 assert.ok(result.quotes.filter(q=>q.basis==='research-estimate').every(q=>q.recommendation.score===null));
});
test('wider rank uncertainty never improves the score',()=>{
 const a=fixture(),b=structuredClone(a);b.benchmark!.rankHigh=50;
 const ref=efficiencyReference([a]);assert.ok(recommendation(a,ref).score!>recommendation(b,ref).score!);
});
test('budget and provider filters do not renormalize recommendation scores',()=>{
 const data=structuredClone(cat);
 for(const b of data.benchmarks){b.cohortSize=150;b.rankHigh=b.rank;}
 const all=rankValues(data,prefs({category:'webdev'}),now);
 const filtered=rankValues(data,prefs({category:'webdev',budget:20,providerId:'zai'}),now);
 assert.ok(filtered.quotes.some(q=>q.recommendation.score!==null));
 for(const q of filtered.quotes)assert.equal(q.recommendation.score,all.quotes.find(a=>a.id===q.id)?.recommendation.score);
});
test('different category rankings change comprehensive order without changing quota values',()=>{
 const a=fixture(),b=structuredClone(a);b.id='other';b.model={...b.model,id:'other'};b.benchmark={...b.benchmark!,modelId:'other',rank:90,rankHigh:90};
 const ref=efficiencyReference([a,b]);assert.ok(recommendation(a,ref).score!>recommendation(b,ref).score!);
 a.benchmark={...a.benchmark!,category:'coding',rank:90,rankHigh:90};b.benchmark={...b.benchmark!,category:'coding',rank:1,rankHigh:1};
 assert.ok(recommendation(b,ref).score!>recommendation(a,ref).score!);assert.equal(a.calculation.millionTokens,b.calculation.millionTokens);
});
test('a missing model in the latest board cannot borrow an older snapshot',()=>{
 const data=structuredClone(cat),base=data.benchmarks.find(b=>b.category==='webdev')!;
 const other=data.benchmarks.find(b=>b.category==='webdev'&&b.modelId!==base.modelId)!;
 const newer={...base,id:'new-board',freshness:{...base.freshness,verifiedAt:'2026-09-10T23:00:00Z',evidenceIds:['new-snapshot']}};
 data.benchmarks=[{...other,freshness:{...other.freshness,verifiedAt:'2026-09-09T00:00:00Z'}},newer];
 assert.equal(modelReference(data,other.modelId,prefs({category:'webdev'}),now),null);
});
test('combined ranking preserves a published rank beyond the top twenty',()=>{
 const data=structuredClone(cat),b=data.benchmarks.find(b=>b.category==='coding')!;
 data.benchmarks=[{...b,rank:35,rankHigh:38,cohortSize:46}];
 assert.equal(modelReference(data,b.modelId,prefs(),now)?.rank,35);
});
