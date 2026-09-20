import type {Catalog,Offer,RateCard,ValuePreferences,ResearchValue,Plan,Benchmark} from './schema';
import {isFresh} from './recommend';
import {recommendation,efficiencyReference,RANKING_VERSION,RANKING_WEIGHTS} from './ranking';

export const CALCULATION_VERSION='official-equivalent-1';
export const utilizationFactor={full:1,half:0.5,quarter:0.25};
// Earlier editorial reviews stored the exact retired ratio in the audit notes.
// Surface that historical number without changing eligibility or current ratios.
export function historicalResearchRatio(research:ResearchValue):number|null{
  for(const note of [...research.reviewNotes].reverse()){
    const match=note.match(/本次修正前：ratio=(\d+(?:\.\d+)?)/);
    if(match&&Number.isFinite(Number(match[1])))return Number(match[1]);
  }
  return null;
}
// Explicit scenarios, not claims about an average user's actual usage.
export function blendedRate(rate:RateCard,prefs:ValuePreferences):number|null{
  if(rate.contextUpperBound!==null&&prefs.context>rate.contextUpperBound)return null;
  const cachedShare=prefs.profile==='cached'?0.64:0;
  if(cachedShare&&rate.cachedInputPerMillion===null)return null;
  return (0.8-cachedShare)*rate.inputPerMillion+0.2*rate.outputPerMillion+cachedShare*(rate.cachedInputPerMillion??0);
}
export function monthlyPayment(plan:Catalog['plans'][number]){
  const period=plan.billing.interval==='year'?12:1;
  return (plan.billing.amount*(1+plan.billing.feePercent/100)+plan.billing.feeFixed)/period;
}
export function planModelNames(catalog:Catalog,plan:Plan){
  return plan.modelIds.map(id=>catalog.models.find(model=>model.id===id)?.name).filter((name):name is string=>Boolean(name));
}
export function planMatchesQuery(catalog:Catalog,plan:Plan,rawQuery:string){
  const query=rawQuery.toLowerCase().trim();
  if(!query)return true;
  const provider=catalog.providers.find(item=>item.id===plan.providerId);
  if([plan.name,plan.product,provider?.name??''].some(name=>name.toLowerCase()===query||name.toLowerCase().startsWith(query+' ')))return true;
  const modelQuery=catalog.models.some(model=>[model.name,...model.aliases].some(term=>term.toLowerCase().includes(query)));
  if(modelQuery)return catalog.models.some(model=>plan.modelIds.includes(model.id)&&[model.name,...model.aliases].some(term=>term.toLowerCase().includes(query)));
  return [plan.name,plan.product,plan.description,...plan.benefits,provider?.name??'',...planModelNames(catalog,plan)].join(' ').toLowerCase().includes(query);
}
// Keep past-due records readable without changing their dates or using them as
// current ranking inputs. Explicitly ended promotions remain excluded.
export function pendingValuePlans(catalog:Catalog,result:ValueResult,now=new Date()){
  const prefs=result.preferences,t=now.getTime();
  const available=(f:Plan['freshness'])=>f.status!=='withdrawn'&&Date.parse(f.verifiedAt)<=t&&(!f.effectiveFrom||Date.parse(f.effectiveFrom)<=t)&&(!f.expiresAt||Date.parse(f.expiresAt)>t);
  const pastDue=(f:Plan['freshness'])=>available(f)&&!isFresh(f,now);
  const visible=new Set(result.quotes.filter(q=>Date.parse(q.validUntil)>t).map(q=>q.plan.id));
  return catalog.plans.filter(p=>{
    if(p.availability==='ended'||!available(p.freshness)||visible.has(p.id))return false;
    if(prefs.providerId&&p.providerId!==prefs.providerId||prefs.category!=='all'&&!p.categories.includes(prefs.category))return false;
    if(!planMatchesQuery(catalog,p,prefs.query)||!prefs.allowAnnual&&p.billing.interval==='year')return false;
    if(prefs.minRank!==null||prefs.minTokensPerSecond!==null)return false;
    const monthly=monthlyPayment(p),upfront=Math.max(p.billing.upfront,p.billing.minimumPurchase??0,p.billing.interval==='year'?0:monthly);
    if(prefs.budget!==null&&(p.billing.minimumPurchase===null||monthly>prefs.budget||p.billing.interval!=='year'&&upfront>prefs.budget))return false;
    if(prefs.upfrontBudget!==null&&(p.billing.minimumPurchase===null||upfront>prefs.upfrontBudget))return false;
    return pastDue(p.freshness)||catalog.research.some(r=>r.planId===p.id&&(pastDue(r.freshness)||r.replacedByOfferId!==null))||catalog.offers.some(o=>o.planId===p.id&&[o,...catalog.rateCards.filter(r=>[o.rateCardId,o.referenceRateCardId].includes(r.id))].some(x=>pastDue(x.freshness)));
  }).map(plan=>({plan,modelNames:planModelNames(catalog,plan),research:catalog.research.filter(r=>r.planId===plan.id)}));
}
const CATEGORY_FALLBACK=['general','coding','webdev','frontend'] as const;
function boardEntry(catalog:Catalog,modelId:string,category:Benchmark['category'],now:Date,retained=false){
  const available=catalog.benchmarks.filter(b=>b.category===category&&(retained?Date.parse(b.freshness.verifiedAt)<=now.getTime():isFresh(b.freshness,now)));
  // A single source/board/snapshot for every model; never fill gaps using a different test.
  const board=available.sort((a,b)=>(a.source==='arena'?0:1)-(b.source==='arena'?0:1)||b.measuredAt.localeCompare(a.measuredAt)||b.freshness.verifiedAt.localeCompare(a.freshness.verifiedAt)||a.id.localeCompare(b.id))[0];
  return board?available.find(b=>b.modelId===modelId&&b.source===board.source&&b.benchmarkVersion===board.benchmarkVersion&&b.measuredAt===board.measuredAt&&(b.source!=='arena'||b.freshness.evidenceIds[0]===board.freshness.evidenceIds[0]))??null:null;
}
export function modelReference(catalog:Catalog,modelId:string,prefs:ValuePreferences,now:Date,retained=false){
  if(prefs.category!=='all')return boardEntry(catalog,modelId,prefs.category,now,retained);
  // On the combined view, a model absent from the general board falls back to its
  // first available secondary board (coding, then webdev, then frontend). The
  // cohort is capped at the 20-entry collection window so a rank on a large
  // secondary board is not inflated against the general board's smaller cohort.
  for(const category of CATEGORY_FALLBACK){
    const hit=boardEntry(catalog,modelId,category,now,retained);
    if(hit)return category==='general'?hit:{...hit,cohortSize:Math.min(hit.cohortSize??20,20)};
  }
  return null;
}
export function modelSpeed(catalog:Catalog,modelId:string,now:Date,retained=false){return catalog.benchmarks.filter(b=>b.modelId===modelId&&b.source==='artificial-analysis'&&b.outputTokensPerSecond!==null&&(retained?Date.parse(b.freshness.verifiedAt)<=now.getTime():isFresh(b.freshness,now))).sort((a,b)=>b.measuredAt.localeCompare(a.measuredAt))[0]??null;}
export function valueQuote(catalog:Catalog,offer:Offer,prefs:ValuePreferences,now=new Date(),retained=false){
  const plan=catalog.plans.find(p=>p.id===offer.planId)!;
  const model=catalog.models.find(m=>m.id===offer.modelId)!;
  const provider=catalog.providers.find(p=>p.id===plan.providerId)!;
  const rate=catalog.rateCards.find(r=>r.id===offer.rateCardId)!;
  const reference=catalog.rateCards.find(r=>r.id===offer.referenceRateCardId)!;
  const dependencies=[plan,offer,rate,reference];
  if(!retained&&dependencies.some(d=>!isFresh(d.freshness,now)))return {ok:false as const,reason:'價格、額度或基準資料已過期'};
  const evidenceIds=[...new Set(dependencies.flatMap(d=>d.freshness.evidenceIds))];
  if(evidenceIds.some(id=>!catalog.evidence.some(e=>e.id===id&&['official-price','official-terms'].includes(e.kind))))return {ok:false as const,reason:'缺少官方價格或條款證據'};
  if((!retained&&(plan.availability!=='public'||plan.audience!=='individual'))||plan.billing.currency!=='USD')return {ok:false as const,reason:'非一般個人可比較的美元方案'};
  if(plan.billing.interval==='once')return {ok:false as const,reason:'一次性方案缺少可比較期限'};
  if(plan.billing.interval==='year'&&!prefs.allowAnnual)return {ok:false as const,reason:'未納入年繳方案'};
  const platformMix=blendedRate(rate,prefs),referenceMix=blendedRate(reference,prefs);
  if(platformMix===null||referenceMix===null)return {ok:false as const,reason:'快取或 context 費率尚未核實'};
  if(platformMix<=0||referenceMix<=0)return {ok:false as const,reason:'免費或零費率不換算為無限倍'};
  const cash=offer.kind==='metered'?prefs.apiSpendUSD:monthlyPayment(plan);
  if(cash<=0)return {ok:false as const,reason:'免費方案不以無限倍參與排行'};
  let usableUnits:number;
  let limitingWindow:string;
  if(offer.kind==='metered'){
    usableUnits=(cash-plan.billing.feeFixed)/(1+plan.billing.feePercent/100);
    limitingWindow='按用量';
  }else{
    const windowCounts={'five-hours':Math.floor(28*24/5),week:4,month:1};
    const candidates=offer.windows.map(w=>({units:w.amount*windowCounts[w.period],period:w.period})).sort((a,b)=>a.units-b.units);
    usableUnits=candidates[0].units*utilizationFactor[prefs.utilization];
    limitingWindow=candidates[0].period;
  }
  if(usableUnits<=0)return {ok:false as const,reason:'付款不足以覆蓋費用'};
  const millionTokens=usableUnits/(platformMix*offer.chargeMultiplier);
  const equivalentUSD=millionTokens*referenceMix;
  const multiplier=equivalentUSD/cash;
  const monthlyCost=offer.kind==='metered'?null:cash;
  const upfront=plan.billing.interval==='year'?plan.billing.upfront*(1+plan.billing.feePercent/100)+plan.billing.feeFixed:Math.max(monthlyCost??0,plan.billing.upfront,plan.billing.minimumPurchase??0);
  if(prefs.budget!==null&&(plan.billing.minimumPurchase===null||upfront>prefs.budget&&plan.billing.interval!=='year'||monthlyCost!==null&&monthlyCost>prefs.budget))return {ok:false as const,reason:'超過付款上限或最低付款尚未核實'};
  if(prefs.upfrontBudget!==null&&(plan.billing.minimumPurchase===null||upfront>prefs.upfrontBudget))return {ok:false as const,reason:'超過前期付款上限或門檻未核實'};
  const benchmark=modelReference(catalog,offer.modelId,prefs,now,retained);
  const speed=modelSpeed(catalog,offer.modelId,now,retained);
  if(prefs.minTokensPerSecond!==null&&(!speed?.outputTokensPerSecond||speed.outputTokensPerSecond<prefs.minTokensPerSecond))return {ok:false as const,reason:'尚無符合條件的模型速度參考'};
  if(prefs.minRank!==null&&(!benchmark?.rank||benchmark.rank>prefs.minRank))return {ok:false as const,reason:'未符合模型榜單範圍'};
  return {ok:true as const,quote:{id:offer.id,offer,plan,model,provider,multiplier,monthlyCost,upfrontCost:upfront,benchmark,
    basis:'official-api-equivalent' as const,dataStatus:dependencies.some(d=>!isFresh(d.freshness,now))?'review' as const:'current' as const,evidenceIds,verifiedAt:dependencies.map(d=>d.freshness.verifiedAt).sort()[0],validUntil:dependencies.map(d=>d.freshness.validUntil).sort()[0],
    calculation:{version:CALCULATION_VERSION,profile:prefs.profile,inputShare:0.8,outputShare:0.2,cachedInputShare:prefs.profile==='cached'?0.64:0,utilization:offer.kind==='metered'?1:utilizationFactor[prefs.utilization],cash,usableUnits,platformMix,referenceMix,chargeMultiplier:offer.chargeMultiplier,millionTokens,equivalentUSD,limitingWindow,periodWeeks:4},
  }};
}
export function rankValues(catalog:Catalog,prefs:ValuePreferences,now=new Date(),calibrating=false,retained=false):ValueResult{
  const quotes:ValueQuote[]=[];const excluded:{id:string;reason:string}[]=[];
  for(const offer of catalog.offers){
    const plan=catalog.plans.find(p=>p.id===offer.planId)!;
    const model=catalog.models.find(m=>m.id===offer.modelId)!;
    const provider=catalog.providers.find(p=>p.id===plan.providerId)!;
    if(prefs.category!=='all'&&!plan.categories.includes(prefs.category))continue;
    if(prefs.providerId&&plan.providerId!==prefs.providerId)continue;
    if(prefs.query&&![plan.name,model.name,provider.name,offer.label].join(' ').toLowerCase().includes(prefs.query.toLowerCase().trim()))continue;
    const result=valueQuote(catalog,offer,prefs,now,retained);
    if(result.ok)quotes.push({...result.quote,research:null});else excluded.push({id:offer.id,reason:result.reason});
  }
  // User-curated studies are first-class ranking inputs. Retain their estimate basis and original dates.
  for(const r of catalog.research){
    if(!retained&&(!r.eligible||r.replacedByOfferId&&catalog.offers.some(o=>o.id===r.replacedByOfferId)))continue;
    const plan=catalog.plans.find(p=>p.id===r.planId)!,model=catalog.models.find(m=>m.id===r.modelId)!,provider=catalog.providers.find(p=>p.id===plan.providerId)!;
    if(!retained&&plan.availability!=='public')continue;
    if(!retained&&(!isFresh(r.freshness,now)||!isFresh(plan.freshness,now))){excluded.push({id:r.id,reason:'原始研究或價格已達複查期限；原值保留於資料庫'});continue;}
    const cash=r.monthlyCost===null?r.cash:monthlyPayment(plan);
    const monthlyCost=r.monthlyCost===null?null:cash;
    const upfrontCost=Math.max(r.upfrontCost,plan.billing.upfront,monthlyCost??0);
    if(cash<=0)continue;
    if(prefs.category!=='all'&&!plan.categories.includes(prefs.category)||prefs.providerId&&plan.providerId!==prefs.providerId)continue;
    if(prefs.query&&![plan.name,r.modelLabel,provider.name].join(' ').toLowerCase().includes(prefs.query.toLowerCase().trim()))continue;
    if(plan.billing.interval==='year'&&!prefs.allowAnnual)continue;
    if(prefs.budget!==null&&((monthlyCost??upfrontCost)>prefs.budget)||prefs.upfrontBudget!==null&&upfrontCost>prefs.upfrontBudget)continue;
    const benchmark=r.tokenInference==='disabled'?null:modelReference(catalog,r.modelId,prefs,now,retained);
    const speed=r.tokenInference==='disabled'?null:modelSpeed(catalog,r.modelId,now,retained);
    if(prefs.minTokensPerSecond!==null&&(!speed?.outputTokensPerSecond||speed.outputTokensPerSecond<prefs.minTokensPerSecond))continue;
    if(prefs.minRank!==null&&(!benchmark?.rank||benchmark.rank>prefs.minRank))continue;
    // Observational model mixes cannot be renormalized to a fabricated cache split.
    const sourceBase=prefs.profile==='cached'&&r.basis==='research-calculated'?r.cachedRatio:r.ratio;
    const base=sourceBase??(retained?(r.ratio??historicalResearchRatio(r)):null);
    if(base===null||base<=0)continue;
    const utilization=r.monthlyCost===null?1:utilizationFactor[prefs.utilization];
    const multiplier=base*utilization*r.cash/cash;
    let millionTokens=r.basis==='research-estimate'?null:(prefs.profile==='cached'?r.cachedMillionTokens:r.millionTokens);
    if(millionTokens===null&&r.basis==='research-estimate'&&r.tokenInference!=='disabled'){
      // Multi-source estimates are dollar-denominated; convert back to comparable tokens using the model's official API blend.
      const modelProvider=catalog.models.find(m=>m.id===r.modelId)?.providerId;
      const refCard=catalog.rateCards.filter(rc=>rc.modelId===r.modelId&&rc.unit==='USD'&&(retained?Date.parse(rc.freshness.verifiedAt)<=now.getTime():isFresh(rc.freshness,now)))
        .sort((a,b)=>(a.providerId===modelProvider?0:1)-(b.providerId===modelProvider?0:1)||a.id.localeCompare(b.id))[0];
      const refMix=refCard?blendedRate(refCard,prefs):null;
      if(refMix!==null&&refMix>0)millionTokens=multiplier*cash/refMix;
    }
    quotes.push({id:r.id,plan,model:{...model,name:r.modelLabel},provider,multiplier,monthlyCost,upfrontCost,benchmark,basis:r.basis,research:r,dataStatus:sourceBase===null||!r.eligible||r.replacedByOfferId?'historical':!isFresh(r.freshness,now)||!isFresh(plan.freshness,now)?'review':'current',
      offer:{id:r.id,kind:'research',label:r.label,sharedGroup:r.sharedGroup,conditions:r.conditions},evidenceIds:[...new Set([...r.freshness.evidenceIds,...plan.freshness.evidenceIds])],
      verifiedAt:r.originalCheckedAt,validUntil:[r.freshness.validUntil,plan.freshness.validUntil].sort()[0],
      calculation:{version:'research-import-1',profile:prefs.profile,inputShare:.8,outputShare:.2,cachedInputShare:prefs.profile==='cached'?.64:0,utilization,cash,usableUnits:0,platformMix:null,referenceMix:null,chargeMultiplier:1,millionTokens,equivalentUSD:multiplier*cash,limitingWindow:'原始研究',periodWeeks:4}});
  }
  const rankingMode=prefs.ranking;
  const universe=calibrating?quotes:rankValues(catalog,{...prefs,ranking:'value',budget:null,upfrontBudget:null,allowAnnual:true,providerId:null,query:'',minRank:null,minTokensPerSecond:null},now,true,retained).quotes;
  const reference=efficiencyReference(universe);
  const rankedQuotes=quotes.map(q=>({...q,recommendation:recommendation(q,reference)}));
  rankedQuotes.sort((a,b)=>{
    // Retaining a number does not re-adopt an explicitly retired estimate.
    if((a.dataStatus==='historical')!==(b.dataStatus==='historical'))return a.dataStatus==='historical'?1:-1;
    if(rankingMode==='balanced'){
      const x=a.recommendation.score,y=b.recommendation.score;
      if(x!==null&&y===null)return -1;
      if(x===null&&y!==null)return 1;
      if(x!==null&&y!==null){
        if(Math.abs(y-x)>1e-9)return y-x;
        const efficiency=(b.recommendation.efficiency??0)-(a.recommendation.efficiency??0);
        if(efficiency)return efficiency;
        const rank=(a.benchmark?.rank??Infinity)-(b.benchmark?.rank??Infinity);if(rank)return rank;
      }
    }
    return b.multiplier-a.multiplier||(a.monthlyCost??0)-(b.monthlyCost??0)||a.id.localeCompare(b.id);
  });
  const query=prefs.query.toLowerCase().trim();
  const unknown=catalog.plans.filter(p=>{
    if(retained)return !quotes.some(q=>q.plan.id===p.id)&&catalogPlanMatches(catalog,p,prefs,now);
    return p.availability!=='ended'&&!quotes.some(q=>q.plan.id===p.id)&&!catalog.offers.some(o=>o.planId===p.id&&valueQuote(catalog,o,prefs,now).ok)&&!catalog.research.some(r=>r.planId===p.id&&(!query||[p.name,r.modelLabel,catalog.providers.find(v=>v.id===p.providerId)?.name??''].join(' ').toLowerCase().includes(query))&&p.availability==='public'&&r.eligible&&isFresh(r.freshness,now)&&(prefs.profile==='cached'&&r.basis==='research-calculated'?r.cachedRatio:r.ratio)!==null)&&(prefs.allowAnnual||p.billing.interval!=='year')&&(prefs.budget===null||(p.billing.minimumPurchase!==null&&monthlyPayment(p)<=prefs.budget&&Math.max(p.billing.upfront,p.billing.minimumPurchase)<=prefs.budget))&&(prefs.upfrontBudget===null||(p.billing.minimumPurchase!==null&&Math.max(p.billing.upfront,p.billing.minimumPurchase)<=prefs.upfrontBudget))&&prefs.minRank===null&&prefs.minTokensPerSecond===null&&isFresh(p.freshness,now)&&(!prefs.providerId||p.providerId===prefs.providerId)&&(prefs.category==='all'||p.categories.includes(prefs.category))&&(!query||planMatchesQuery(catalog,p,query));
  }).map(p=>({plan:p,modelNames:planModelNames(catalog,p),reason:p.kind==='free'?'免費方案，不以無限倍排行':'尚無可靠用量，保留方案與來源' }));
  return {ranking:{mode:rankingMode,weights:RANKING_WEIGHTS,version:RANKING_VERSION,rankedCount:rankedQuotes.filter(q=>q.recommendation.score!==null).length,referenceCount:reference.length},version:catalog.version,asOf:now.toISOString(),calculationVersion:CALCULATION_VERSION,preferences:prefs,quotes:rankedQuotes,excluded,unknown,evidence:catalog.evidence.filter(e=>quotes.some(q=>q.evidenceIds.includes(e.id)||q.benchmark?.freshness.evidenceIds.includes(e.id))||unknown.some(q=>q.plan.freshness.evidenceIds.includes(e.id))).map(e=>({...e,excerpt:''}))};
}
/** Every catalog plan remains in the primary result; review status never removes it. */
export function rankCatalogValues(catalog:Catalog,prefs:ValuePreferences,now=new Date()):ValueResult{
 return rankValues(catalog,prefs,now,false,true);
}
export function catalogPlanMatches(catalog:Catalog,p:Plan,prefs:ValuePreferences,now=new Date()){
 if(prefs.providerId&&p.providerId!==prefs.providerId||prefs.category!=='all'&&!p.categories.includes(prefs.category))return false;
 if(!planMatchesQuery(catalog,p,prefs.query)||!prefs.allowAnnual&&p.billing.interval==='year')return false;
 const monthly=monthlyPayment(p),upfront=Math.max(p.billing.upfront,p.billing.minimumPurchase??0,p.billing.interval==='year'?0:monthly);
 if(prefs.budget!==null&&(p.billing.minimumPurchase===null||monthly>prefs.budget||p.billing.interval!=='year'&&upfront>prefs.budget))return false;
 if(prefs.upfrontBudget!==null&&(p.billing.minimumPurchase===null||upfront>prefs.upfrontBudget))return false;
 if(prefs.minRank!==null&&!p.modelIds.some(id=>{const b=modelReference(catalog,id,prefs,now,true);return b?.rank!==null&&b?.rank!==undefined&&b.rank<=prefs.minRank!;}))return false;
 if(prefs.minTokensPerSecond!==null&&!p.modelIds.some(id=>(modelSpeed(catalog,id,now,true)?.outputTokensPerSecond??0)>=prefs.minTokensPerSecond!))return false;
 return true;
}
type OfficialQuote=Extract<ReturnType<typeof valueQuote>,{ok:true}>['quote'];
export type ValueQuote=Omit<OfficialQuote,'basis'|'offer'|'calculation'|'dataStatus'> & {
 basis:'official-api-equivalent'|'research-estimate'|'research-calculated';
 research:ResearchValue|null;
 dataStatus?:'current'|'review'|'historical';
 offer:Pick<Offer,'id'|'label'|'conditions'|'sharedGroup'> & {kind:'metered'|'allowance'|'research'};
 calculation:Omit<OfficialQuote['calculation'],'millionTokens'|'platformMix'|'referenceMix'> & {millionTokens:number|null;platformMix:number|null;referenceMix:number|null};
};
export type RankedValueQuote=ValueQuote & {recommendation:ReturnType<typeof recommendation>};
export type ValueResult={ranking:{mode:ValuePreferences['ranking'];weights:typeof RANKING_WEIGHTS;version:string;rankedCount:number;referenceCount:number};version:string;asOf:string;calculationVersion:string;preferences:ValuePreferences;quotes:RankedValueQuote[];excluded:{id:string;reason:string}[];unknown:{plan:Plan;modelNames:string[];reason:string}[];evidence:Catalog['evidence']};
