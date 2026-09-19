import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CatalogSchema,ValuePreferencesSchema} from '../shared/schema';
import {rankValues,pendingValuePlans,historicalResearchRatio} from '../shared/value';
const catalog=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8')));
const now=new Date('2026-09-25T00:00:00Z');
const prefs=ValuePreferencesSchema.parse({});
test('expired catalog stays readable with original research, without entering the current ranking',()=>{
 const before=structuredClone(catalog),result=rankValues(catalog,prefs,now);
 assert.equal(result.quotes.length,0);
 const pending=pendingValuePlans(catalog,result,now);
 assert.ok(pending.length>0);
 const pro=pending.find(q=>q.plan.id==='claude-pro')!;assert.ok(pro);
 assert.deepEqual(pro.research,catalog.research.filter(r=>r.planId==='claude-pro'));
 assert.deepEqual(catalog,before);
});
test('pending records respect provider, model, category, annual and budget filters',()=>{
 const filtered=ValuePreferencesSchema.parse({providerId:'anthropic',query:'Claude',allowAnnual:false,budget:30});
 const rows=pendingValuePlans(catalog,rankValues(catalog,filtered,now),now);
 assert.ok(rows.some(q=>q.plan.id==='claude-pro'));
 assert.ok(rows.every(q=>q.plan.providerId==='anthropic'&&q.plan.billing.interval!=='year'&&q.plan.billing.amount<=30));
 const unmatched=ValuePreferencesSchema.parse({query:'no-matching-plan-12345'});
 assert.deepEqual(pendingValuePlans(catalog,rankValues(catalog,unmatched,now),now),[]);
});
test('ended and future plans stay out, and current ranked plans are not duplicated',()=>{
 const data=structuredClone(catalog);
 data.plans.find(p=>p.id==='claude-pro')!.availability='ended';
 data.plans.find(p=>p.id==='claude-max20')!.freshness.verifiedAt='2026-10-01T00:00:00Z';
 const rows=pendingValuePlans(data,rankValues(data,prefs,now),now);
 assert.ok(!rows.some(q=>['claude-pro','claude-max20'].includes(q.plan.id)));
 const earlier=new Date('2026-09-11T00:00:00Z'),current=rankValues(catalog,prefs,earlier);
 assert.ok(!pendingValuePlans(catalog,current,earlier).some(q=>current.quotes.some(r=>r.plan.id===q.plan.id)));
});
test('a record that expires while the page stays open moves into pending display',()=>{
 const earlier=new Date('2026-09-11T00:00:00Z');
 const loaded=rankValues(catalog,prefs,earlier);assert.ok(loaded.quotes.some(q=>q.plan.id==='claude-pro'));
 assert.ok(pendingValuePlans(catalog,loaded,now).some(q=>q.plan.id==='claude-pro'));
});
test('replacing research with an official offer preserves its original plan and numbers in the visible catalog',()=>{
 const data=structuredClone(catalog),study=data.research.find(r=>r.ratio!==null)!;
 const plan=data.plans.find(p=>p.id===study.planId)!;
 const fresh={...plan.freshness,verifiedAt:'2026-09-24T00:00:00Z',validUntil:'2026-09-26T00:00:00Z',effectiveFrom:null,expiresAt:null};
 plan.freshness=fresh;study.freshness=fresh;study.replacedByOfferId=data.offers[0].id;
 const result=rankValues(data,prefs,now);assert.ok(!result.quotes.some(q=>q.id===study.id));
 const original=pendingValuePlans(data,result,now).find(q=>q.plan.id===plan.id)!;
 assert.ok(original);assert.deepEqual(original.research.find(r=>r.id===study.id),study);
});

test('retired ratios are visible only as historical numbers and never restored to current ranking data',()=>{
 const study=structuredClone(catalog.research[0]);study.ratio=null;study.reviewNotes=['本次修正前：ratio=57.48566666666667，method=原始樣本平均'];
 const before=structuredClone(study);
 assert.equal(historicalResearchRatio(study),57.48566666666667);assert.deepEqual(study,before);
 study.reviewNotes=['待重新核驗，尚無可重現的數值'];assert.equal(historicalResearchRatio(study),null);
});
