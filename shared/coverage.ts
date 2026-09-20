import {ValuePreferencesSchema,type Catalog} from './schema';
import {rankCatalogValues,type ValueResult} from './value';
import {isCompleteValueQuote} from './visibility';

/** IDs, multipliers and scores are separate release requirements. */
export function valueCoverage(catalog:Catalog,result:ValueResult){
 const expected=catalog.plans.filter(p=>result.preferences.category==='all'||p.categories.includes(result.preferences.category));
 const visible=new Set([...result.quotes.map(q=>q.plan.id),...result.unknown.map(p=>p.plan.id)]);
 const hasMultiplier=(n:number)=>Number.isFinite(n)&&n>=0;
 const hasScore=(n:number|null)=>n!==null&&Number.isFinite(n)&&n>=0&&n<=100;
 const current=result.quotes.filter(q=>q.dataStatus!=='historical');
 const missingRows=expected.filter(p=>!visible.has(p.id)).map(p=>p.id);
 const missingMultipliers=expected.filter(p=>!current.some(q=>q.plan.id===p.id&&hasMultiplier(q.multiplier))).map(p=>p.id);
 const missingScores=expected.filter(p=>!current.some(q=>q.plan.id===p.id&&hasScore(q.recommendation.score))).map(p=>p.id);
 const invalidScenarios=result.quotes.filter(q=>q.dataStatus==='historical'||!hasMultiplier(q.multiplier)||!hasScore(q.recommendation.score)).map(q=>({id:q.id,planId:q.plan.id,reason:q.dataStatus==='historical'?'historical':!hasMultiplier(q.multiplier)?'missing-multiplier':q.recommendation.reason??'invalid-score'}));
 return {complete:![missingRows,missingMultipliers,missingScores,invalidScenarios].some(x=>x.length),plans:expected.length,plansWithMultiplier:expected.length-missingMultipliers.length,plansWithScore:expected.length-missingScores.length,missingRows,missingMultipliers,missingScores,invalidScenarios};
}

export function visibleValueCoverage(catalog:Catalog,result:ValueResult){
 const quotes=result.quotes.filter(isCompleteValueQuote),ids=new Set(quotes.map(q=>q.plan.id));
 const plans=catalog.plans.filter(p=>result.preferences.category==='all'||p.categories.includes(result.preferences.category));
 return {complete:quotes.length>0,displayedPlans:ids.size,displayedScenarios:quotes.length,
  hiddenPlanIds:plans.filter(p=>!ids.has(p.id)).map(p=>p.id),
  hiddenScenarioIds:result.quotes.filter(q=>!isCompleteValueQuote(q)).map(q=>q.id)};
}

export function rankingCoverage(catalog:Catalog,now=new Date(),visibleOnly=false){
 const views=(['all','general','coding','webdev','frontend'] as const).flatMap(category=>(['standard','cached'] as const).map(profile=>{
  const result=rankCatalogValues(catalog,ValuePreferencesSchema.parse({category,profile}),now);
  return {category,profile,...valueCoverage(catalog,result),visible:visibleValueCoverage(catalog,result)};
 }));
 return {version:catalog.version,checkedAt:now.toISOString(),mode:visibleOnly?'visible':'full-catalog',complete:views.every(v=>visibleOnly?v.visible.complete:v.complete),views};
}
