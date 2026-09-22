import type {ValueQuote} from './value';

export const RANKING_VERSION='fair-value-4';
export const RANKING_WEIGHTS={efficiency:0.6,ability:0.4} as const;
export function tokenEfficiency(q:ValueQuote){
  if(q.dataStatus==='historical')return null;
  const n=q.calculation.millionTokens,cash=q.calculation.cash;
  if(n===null||!Number.isFinite(n)||n<=0||cash<=0)return null;
  // Standard profile does not count cached tokens toward usage (method rule 1).
  const usable=q.calculation.profile==='cached'?n:n*(1-(q.calculation.cachedInputShare??0));
  return usable/cash;
}
export function abilityPercentile(q:ValueQuote){
  const b=q.benchmark;
  if(!b?.rank||!b.cohortSize||b.rank>b.cohortSize)return null;
  // Conservative end of the source's rank interval, not 1/rank or a capability ratio.
  const rank=Math.min(b.cohortSize,Math.max(b.rank,b.rankHigh??b.rank));
  return (b.cohortSize-rank+0.5)/b.cohortSize;
}
export function efficiencyReference(universe:ValueQuote[]){
  // One observation per distinct efficiency prevents duplicate offers from moving scores.
  return [...new Set(universe.map(tokenEfficiency).filter((n):n is number=>n!==null))].sort((a,b)=>a-b);
}
export function recommendation(q:ValueQuote,reference:number[]){
  const efficiency=tokenEfficiency(q),ability=abilityPercentile(q);
  if(q.dataStatus==='historical')return {score:null,efficiency:null,abilityPercentile:ability,efficiencyPercentile:null,reason:'historical-reference'};
  const missing=efficiency===null?'missing-comparable-usage':ability===null?'missing-category-benchmark':reference.length===0?'missing-price-reference':null;
  if(missing)return {score:null,efficiency,abilityPercentile:ability,efficiencyPercentile:null,reason:missing};
  const below=reference.filter(v=>v<efficiency!).length,equal=reference.filter(v=>v===efficiency).length;
  const cost=Math.max(0.5/reference.length,Math.min(1-0.5/reference.length,(below+equal/2)/reference.length));
  const score=100*Math.pow(cost,RANKING_WEIGHTS.efficiency)*Math.pow(ability!,RANKING_WEIGHTS.ability);
  return {score,efficiency,abilityPercentile:ability,efficiencyPercentile:cost,reason:null};
}
