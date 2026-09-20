import type { Benchmark, Catalog, Plan, Preferences } from './schema';

export function isFresh(f: Plan['freshness'], now = new Date()) {
  const t = now.getTime();
  return f.status === 'verified' && Date.parse(f.verifiedAt) <= t && Date.parse(f.validUntil) > t
    && (!f.effectiveFrom || Date.parse(f.effectiveFrom) <= t) && (!f.expiresAt || Date.parse(f.expiresAt) > t);
}
// The freshest verification recorded anywhere in the catalog; the oldest row
// (e.g. research kept at its original date) must never pin this to the past.
export function latestVerifiedAt(catalog: Catalog): string | null {
  const dates = [...catalog.plans, ...catalog.rateCards, ...catalog.offers, ...catalog.research, ...catalog.benchmarks]
    .map(item => item.freshness.verifiedAt).sort();
  return dates.at(-1) ?? null;
}
export type FreshnessEntry = {
  collection: 'plans'|'rateCards'|'offers'|'research'|'benchmarks'; id: string; label: string;
  availability: string|null; verifiedAt: string; validUntil: string; status: string; fresh: boolean;
};
// Completeness of one published catalog: what the topbar badge reports, which
// entities fell out of their window, and which retire on their own.
export function freshnessAudit(catalog: Catalog, now = new Date()) {
  const plans = new Map(catalog.plans.map(p=>[p.id,p]));
  const row = (collection: FreshnessEntry['collection'], item: {id:string;label:string;freshness:Plan['freshness'];availability:string|null}): FreshnessEntry =>
    ({collection,id:item.id,label:item.label,availability:item.availability,verifiedAt:item.freshness.verifiedAt,
      validUntil:item.freshness.validUntil,status:item.freshness.status,fresh:isFresh(item.freshness,now)});
  const entries = [
    ...catalog.plans.map(p=>row('plans',{id:p.id,label:p.name,freshness:p.freshness,availability:p.availability})),
    ...catalog.rateCards.map(r=>row('rateCards',{id:r.id,label:r.id,freshness:r.freshness,availability:null})),
    ...catalog.offers.map(o=>row('offers',{id:o.id,label:o.label,freshness:o.freshness,availability:plans.get(o.planId)?.availability??null})),
    ...catalog.research.map(r=>row('research',{id:r.id,label:r.label,freshness:r.freshness,availability:plans.get(r.planId)?.availability??null})),
    ...catalog.benchmarks.map(b=>row('benchmarks',{id:b.id,label:`${b.modelId} ${b.category}`,freshness:b.freshness,availability:null})),
  ];
  const collections = Object.fromEntries((['plans','rateCards','offers','research','benchmarks'] as const).map(name=>{
    const group = entries.filter(e=>e.collection===name);
    return [name,{total:group.length,fresh:group.filter(e=>e.fresh).length,stale:group.filter(e=>!e.fresh).length,
      expiringIn24h:group.filter(e=>e.fresh&&Date.parse(e.validUntil)-now.getTime()<86400000).length}];
  }));
  const stale = entries.filter(e=>!e.fresh);
  // Ended plans may legitimately expire; anything still on offer must not fall out of its window.
  const gaps = stale.filter(e=>e.availability!=='ended');
  const latest = latestVerifiedAt(catalog);
  const latestEntry = entries.find(e=>e.verifiedAt===latest);
  return {version:catalog.version,publishedAt:catalog.publishedAt,latestVerifiedAt:latest,
    latestVerifiedEntity:latestEntry?`/${latestEntry.collection}/${latestEntry.id}`:null,
    collections,gaps,retired:stale.filter(e=>e.availability==='ended'),complete:gaps.length===0};
}
export function monthlyCost(p: Plan, prefs: Preferences): number | null {
  let amount = p.billing.amount;
  if (p.kind === 'api') {
    if (!p.apiRates || p.apiRates.maxContext===null || prefs.workload.context > p.apiRates.maxContext || p.apiRates.mode !== 'standard') return null;
    amount = (prefs.workload.inputTokens*p.apiRates.inputPerMillion + prefs.workload.outputTokens*p.apiRates.outputPerMillion)/1e6;
  } else if (p.billing.interval === 'year') amount /= 12;
  else if (p.billing.interval === 'once') return null; // Unknown duration must not be invented.
  return Math.ceil((amount*(1+p.billing.feePercent/100)+p.billing.feeFixed)*100)/100;
}
function capability(plan: Plan, catalog: Catalog, prefs: Preferences, now: Date) {
  const pool = catalog.benchmarks.filter(b=>isFresh(b.freshness,now));
  // Normalize only inside identical benchmark/version/category/harness cohorts. Never average raw scores across sources.
  const selected: { benchmark: Benchmark; percentile: number }[]=[];
  for (const cat of prefs.categories) {
    const options = pool.filter(b=>b.category===cat && plan.modelIds.includes(b.modelId));
    const normalized=options.map(b=>{
      const peers=pool.filter(x=>x.source===b.source && x.category===b.category && x.benchmarkVersion===b.benchmarkVersion && x.harness===b.harness);
      const percentile=peers.length<2 ? 0.5 : peers.filter(x=>x.score<=b.score).length/peers.length;
      return {benchmark:b,percentile};
    }).sort((a,b)=>b.percentile-a.percentile);
    if (normalized[0]) selected.push(normalized[0]);
  }
  return { score: selected.length ? selected.reduce((s,x)=>s+x.percentile,0)/selected.length : null, records: selected.map(x=>x.benchmark) };
}
export type Recommendation = ReturnType<typeof recommend>['results'][number];
export function recommend(catalog: Catalog, prefs: Preferences, now = new Date()) {
  const rejected: {id:string; reason:string}[]=[];
  const results = catalog.plans.flatMap(plan=>{
    const provider=catalog.providers.find(p=>p.id===plan.providerId)!;
    let rejection:string|null=null;
    const cost=monthlyCost(plan,prefs);
    const neededUpfront=plan.billing.interval==='year' ? plan.billing.upfront : Math.max(plan.billing.upfront,plan.billing.minimumPurchase??0,cost??0);
    if (!isFresh(plan.freshness,now)) rejection='資料已過有效期或尚未核實';
    else if (plan.freshness.evidenceIds.some(id=>!catalog.evidence.some(e=>e.id===id&&e.kind!=='community'))) rejection='缺少可用的正式來源';
    else if (plan.availability!=='public' || plan.audience!=='individual') rejection='不適用一般個人使用者';
    else if (plan.billing.currency!==prefs.currency) rejection='不同幣別尚未換算';
    else if ((prefs.mode==='api') !== (plan.kind==='api')) rejection='不同服務類型';
    else if (plan.billing.minimumPurchase===null) rejection='最低付款門檻尚未核實';
    else if (!prefs.includeResellers && provider.trust!=='official') rejection='目前只比較官方供應商';
    else if (plan.billing.interval==='year' && (!prefs.allowAnnual || neededUpfront>prefs.upfrontBudget)) rejection='未允許年繳或前期付款不足';
    else if (cost===null) rejection='缺少適用費率或超過已驗證計費範圍';
    else if (cost>prefs.budget || (plan.billing.interval!=='year' && neededUpfront>Math.max(prefs.budget,prefs.upfrontBudget))) rejection='超過預算';
    else if (!prefs.categories.some(c=>plan.categories.includes(c))) rejection='用途不符合';
    if (rejection) { rejected.push({id:plan.id,reason:rejection});return []; }
    const caps=capability(plan,catalog,prefs,now);
    const coverage=prefs.categories.filter(c=>plan.categories.includes(c)).length/prefs.categories.length;
    const savings=prefs.budget===0?1:Math.max(0,1-cost!/prefs.budget);
    // Opaque subscriptions: a transparent ordinal decision heuristic, never a token or ROI estimate.
    const access=plan.kind==='free'?0.25:1;
    const value=plan.kind==='api'?0.25*coverage+0.75*savings:0.55*coverage+0.25*access+0.20*savings;
    const abilityWeight=prefs.priority==='quality'?0.30:0.20;
    const speedRecords=caps.records.filter(b=>b.outputTokensPerSecond!==null);
    const speed = speedRecords.length ? Math.min(1,Math.max(...speedRecords.map(b=>b.outputTokensPerSecond!))/200) : null;
    const secondary=prefs.priority==='price'?savings:prefs.priority==='speed'&&speed!==null?speed:caps.score??0.5;
    const score=(1-abilityWeight)*value+abilityWeight*secondary;
    return [{plan,provider,monthlyCost:cost!,upfrontCost:neededUpfront,remaining:Math.max(0,prefs.budget-cost!),score,
      capability:caps.records,capabilityMissing:caps.score===null,speedMissing:prefs.priority==='speed'&&speed===null,
      reasons:[`${prefs.categories.filter(c=>plan.categories.includes(c)).length} 項用途符合`,plan.kind==='api'?'依指定用量計價':'固定費用在預算內'],
      estimatedRequests: null as number|null}];
  }).sort((a,b)=>b.score-a.score||a.monthlyCost-b.monthlyCost||a.plan.id.localeCompare(b.plan.id));
  return {version:catalog.version,asOf:now.toISOString(),results,rejected,
    caveats:['訂閱額度未公開時，不推估 API 等值或保證收益。','費用依美元公開牌價；可能另含稅與地區差異。','能力是特定模型與測試環境的參考，不代表方案實測。']};
}
