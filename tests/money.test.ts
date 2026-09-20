import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {CatalogSchema,ValuePreferencesSchema} from '../shared/schema';import {rankCatalogValues} from '../shared/value';import {planMoney} from '../shared/money';
const seed=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8'))),prefs=ValuePreferencesSchema.parse({ranking:'value'}),now=new Date('2026-10-01');
test('stored official API prices produce a real 1x self baseline and channel fees reduce equivalent value',()=>{
 const c=structuredClone(seed),p=c.plans.find(p=>p.id==='api-sol')!;
 c.offers=c.offers.filter(o=>o.planId!==p.id);c.research=c.research.filter(r=>r.planId!==p.id);
 const channel={...structuredClone(p),id:'test-channel',providerId:'opencode',billing:{...p.billing,feePercent:5.5,feeFixed:0},apiRates:{...p.apiRates!,inputPerMillion:p.apiRates!.inputPerMillion/2,outputPerMillion:p.apiRates!.outputPerMillion/2,cachedInputPerMillion:p.apiRates!.cachedInputPerMillion!/2}};c.plans.push(channel);
 const v=rankCatalogValues(c,prefs,now);assert.equal(v.quotes.find(q=>q.id==='plan-api-api-sol')?.multiplier,1);
 assert.ok(Math.abs(v.quotes.find(q=>q.id==='plan-api-test-channel')!.multiplier-2/1.055)<1e-10);
 assert.equal(v.quotes.find(q=>q.id==='plan-api-api-sol')?.dataStatus,'review');
});
test('a reseller without same-model official evidence gets a monetary unit price, never an invented 1x',()=>{
 const c=structuredClone(seed),p=c.plans.find(p=>p.apiRates)!;p.id='only-reseller';p.providerId='opencode';c.plans=[p];c.rateCards=[];c.offers=[];c.research=[];
 const v=rankCatalogValues(c,prefs,now);assert.equal(v.quotes.length,0);assert.equal(v.unknown[0].money.kind,'api-unit-cost');assert.ok(v.unknown[0].money.amount!>0);
});
test('platform tokens have a monetary unit cost and dollar credits remain a distinct budget',()=>{
 const p=structuredClone(seed.plans.find(p=>p.kind==='subscription')!);p.billing={...p.billing,amount:25,interval:'month',currency:'USD',feeFixed:0,feePercent:0};p.apiRates=null;p.quota={kind:'tokens',amount:10e6,reset:'month',hardCap:true,notes:'10M platform tokens/month'};
 const m=planMoney(p,prefs);assert.equal(m.amount,2.5);assert.equal(m.kind,'unit-cost');assert.equal(m.unit,'platform-million');
 p.monetaryValue={amount:100,currency:'USD',basis:'platform-budget',period:'month',notes:'Shared with compute',freshness:p.freshness};
 assert.equal(planMoney(p,prefs).amount,100);assert.equal(planMoney(p,prefs).kind,'platform-budget');
});
test('annual payments are amortized once, free observations never divide by zero, and short caps are not monthly guarantees',()=>{
 const p=structuredClone(seed.plans[0]);p.apiRates=null;p.billing={...p.billing,amount:100,interval:'year',feePercent:0,feeFixed:0};p.quota={kind:'credits',amount:10,reset:'month',hardCap:true,notes:''};
 assert.equal(planMoney(p,prefs).amount,100/12/10);
 p.kind='free';p.billing.amount=0;p.monetaryValue={amount:4,currency:'USD',basis:'api-observation',period:'30 days',notes:'Observed usage',freshness:p.freshness};assert.equal(planMoney(p,prefs).amount,4);assert.equal(planMoney(p,prefs).kind,'api-observation');
 delete p.monetaryValue;p.kind='subscription';p.billing.amount=20;p.quota.reset='5h';assert.equal(planMoney(p,prefs).amount,null);
});
test('an ambiguous official baseline or missing cache rate cannot fabricate a comparable quote',()=>{
 const c=structuredClone(seed),p=c.plans.find(p=>p.id==='api-sol')!;p.providerId='opencode';p.id='ambiguous';p.apiRates!.cachedInputPerMillion=null;c.plans=[p];c.offers=[];c.research=[];
 const ref={id:'official-test',modelId:p.modelIds[0],providerId:'openai',unit:'USD' as const,inputPerMillion:p.apiRates!.inputPerMillion,outputPerMillion:p.apiRates!.outputPerMillion,cachedInputPerMillion:.4,contextUpperBound:128000,freshness:p.freshness};c.rateCards=[ref,{...ref,id:'different-window',inputPerMillion:ref.inputPerMillion*2}];
 assert.equal(rankCatalogValues(c,prefs,now).quotes.length,0);
 assert.equal(rankCatalogValues(c,{...prefs,profile:'cached'},now).quotes.length,0);
});
