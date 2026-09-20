import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CatalogSchema,ValuePreferencesSchema} from '../shared/schema';
import {rankCatalogValues,type RankedValueQuote} from '../shared/value';
import {valueCoverage,visibleValueCoverage,rankingCoverage} from '../shared/coverage';
import {isCompleteValueQuote} from '../shared/visibility';
const catalog=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8')));
const now=new Date('2026-09-11T00:00:00Z');
test('complete plan IDs and monetary facts cannot pass multiplier and score coverage',()=>{
 const result=rankCatalogValues(catalog,ValuePreferencesSchema.parse({}),now);
 const audit=valueCoverage(catalog,result);
 assert.equal(audit.missingRows.length,0);assert.equal(audit.complete,false);
 assert.ok(audit.missingMultipliers.length>0);assert.ok(audit.missingScores.length>0);
 const release=rankingCoverage(catalog,now);assert.equal(release.complete,false);
 assert.equal(release.views.length,10);assert.ok(release.views.every(v=>v.missingRows.length===0));
});
test('visible release hides incomplete scenarios while retaining complete siblings and catalog records',()=>{
 const result=rankCatalogValues(catalog,ValuePreferencesSchema.parse({category:'webdev'}),now);
 const q=result.quotes.find(isCompleteValueQuote)!;assert.ok(q);
 const original=JSON.stringify(catalog);
 const invalid:RankedValueQuote[]=[
  {...q,id:'missing-score',recommendation:{...q.recommendation,score:null,efficiencyPercentile:null,reason:'missing-comparable-usage'}},
  {...q,id:'nan-score',recommendation:{...q.recommendation,score:NaN}},
  {...q,id:'oversized-score',recommendation:{...q.recommendation,score:101}},
  {...q,id:'zero-ratio',multiplier:0},
  {...q,id:'infinite-ratio',multiplier:Infinity},
  {...q,id:'historical',dataStatus:'historical' as const},
 ];
 const quotes=[q,...invalid];
 assert.deepEqual(quotes.filter(isCompleteValueQuote).map(x=>x.id),[q.id]);
 const audit=visibleValueCoverage(catalog,{...result,quotes});
 assert.equal(audit.complete,true);assert.equal(audit.displayedPlans,1);
 assert.equal(audit.displayedScenarios,1);assert.ok(!audit.hiddenPlanIds.includes(q.plan.id));
 assert.deepEqual(audit.hiddenScenarioIds,invalid.map(x=>x.id));
 assert.equal(visibleValueCoverage(catalog,{...result,quotes:invalid}).complete,false);
 assert.equal(JSON.stringify(catalog),original);
});
test('an extra unscored scenario fails even when its plan also has a scored quote',()=>{
 const result=rankCatalogValues(catalog,ValuePreferencesSchema.parse({category:'webdev'}),now);
 const q=result.quotes.find(q=>q.recommendation.score!==null)!;assert.ok(q);
 const single={...catalog,plans:[q.plan]},good={...result,quotes:[q],unknown:[]};
 assert.equal(valueCoverage(single,good).complete,true);
 const bad={...q,id:'mixed-observation',recommendation:{...q.recommendation,score:null,efficiencyPercentile:null,reason:'missing-comparable-usage'}};
 const audit=valueCoverage(single,{...good,quotes:[q,bad]});
 assert.equal(audit.missingScores.length,0);assert.equal(audit.complete,false);
 assert.deepEqual(audit.invalidScenarios.map(x=>x.id),['mixed-observation']);
});
