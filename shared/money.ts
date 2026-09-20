import type {Plan,ValuePreferences} from './schema';
export type MoneyComparison={amount:number|null;currency:string;kind:'platform-budget'|'api-observation'|'retail-credit-value'|'unit-cost'|'api-unit-cost'|'free'|'contract'|'variable';unit:string;notes:string;verifiedAt:string;evidenceIds:string[]};
/** Monetary facts stay separate from API-equivalent multipliers and their ranking. */
export function planMoney(plan:Plan,prefs:ValuePreferences):MoneyComparison{
 const base={currency:plan.billing.currency,verifiedAt:plan.freshness.verifiedAt,evidenceIds:plan.freshness.evidenceIds};
 const fact=plan.monetaryValue;
 if(fact)return {...base,amount:fact.amount,currency:fact.currency,kind:fact.basis,unit:fact.period,notes:fact.notes,verifiedAt:fact.freshness.verifiedAt,evidenceIds:fact.freshness.evidenceIds};
 if(plan.apiRates){
  const a=plan.apiRates,cached=prefs.profile==='cached'?.64:0;
  // A missing cache price still has an explicit input/output price, but no blended cache quote.
  if(cached&&a.cachedInputPerMillion===null)return {...base,amount:a.inputPerMillion,kind:'api-unit-cost',unit:'input-million',notes:plan.quota.notes};
  const amount=(.8-cached)*a.inputPerMillion+.2*a.outputPerMillion+cached*(a.cachedInputPerMillion??0);
  return {...base,amount:amount*(1+plan.billing.feePercent/100),kind:'api-unit-cost',unit:'million',notes:plan.quota.notes+(plan.billing.feeFixed?`；另加每次固定費用 $${plan.billing.feeFixed}。`:'')};
 }
 const quota=plan.quota,monthly=plan.billing.amount/(plan.billing.interval==='year'?12:1);
 // Match the billing period to a recorded reset; do not extrapolate five-hour caps into guaranteed monthly usage.
 const windows:Record<string,number>={month:1,'30 days':1,'7d':4,'7 days':4};
 const count=plan.billing.interval==='once'?1:windows[quota.reset??''];
 if(quota.amount!==null&&quota.amount>0&&count&&['tokens','credits','requests'].includes(quota.kind)){
  const scale=quota.kind==='tokens'?1e6:1;
  const cash=monthly*(1+plan.billing.feePercent/100)+plan.billing.feeFixed/(plan.billing.interval==='year'?12:1);
  return {...base,amount:cash/(quota.amount*count)*scale,kind:'unit-cost',unit:quota.kind==='tokens'?'platform-million':quota.kind==='credits'?'credit':'request',notes:quota.notes+(count===4?'；按四週額度計算。':'')};
 }
 if(plan.kind==='free')return {...base,amount:0,kind:'free',unit:'month',notes:quota.notes};
 if(plan.billing.interval==='usage')return {...base,amount:null,kind:'contract',unit:'',notes:plan.billing.priceLabel??quota.notes};
 return {...base,amount:null,kind:'variable',unit:'',notes:quota.notes};
}
