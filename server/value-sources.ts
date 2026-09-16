import {load} from 'cheerio';
import type {Catalog,Evidence,RateCard,Offer} from '../shared/schema';
import {CatalogSchema} from '../shared/schema';
import {fetchSource,makeEvidence} from './sources';

export const VALUE_SOURCES={zai:'https://docs.z.ai/devpack/overview',reference:'https://docs.z.ai/guides/overview/pricing',go:'https://opencode.ai/docs/go/'};
const clean=(s:string)=>s.replace(/[‐‑–]/g,'-').replace(/\s+/g,' ').trim();
export function htmlTables(raw:string){const $=load(raw);return $('table').toArray().map(t=>$(t).find('tr').toArray().map(r=>$(r).find('th,td').toArray().map(c=>clean($(c).text()))));}
const text=(raw:string)=>{const $=load(raw);$('script,style,nav,footer,header').remove();return clean($('body').text());};
const amount=(s:string)=>{const value=Number(s.replace(/[$,\s]/g,''));if(!Number.isFinite(value)||value<0||!s.trim())throw new Error(`Invalid numeric price/allowance: ${s}`);return value;};
const cacheAmount=(s:string)=>s==='-'?null:amount(s);
const findRow=(tables:string[][][],name:string)=>tables.flat().find(r=>r[0]===name);
const rateNames=['GLM-5.3-Flash','GLM-5.3','GLM-5.2','GLM-5.1'] as const;
const modelIds:Record<string,string>={'GLM-5.3-Flash':'glmflash','GLM-5.3':'glm53','GLM-5.2':'glm52','GLM-5.1':'glm51'};
export function parseValueSources(raw:{zai:string;reference:string;go:string}){
  const z=text(raw.zai),g=text(raw.go),zt=htmlTables(raw.zai),rt=htmlTables(raw.reference),gt=htmlTables(raw.go);
  const lite=z.match(/Starting at just (\d+(?:\.\d+)?) USD per month/i);
  const go=g.match(/\$(\d+(?:\.\d+)?)\s*\/\s*month subscription/i);
  if(!lite||!go)throw new Error('Official subscription price format changed');
  if(!z.includes('50% of the standard credit rate')||!z.includes('14:00–18:00')&&!z.includes('14:00-18:00')||!z.includes('UTC+8'))throw new Error('Z.ai off-peak schedule changed');
  if(!g.includes('20% of the monthly limit')||!g.includes('50%')||!g.includes('monthly'))throw new Error('OpenCode quota window policy changed');
  const quotaTable=zt.find(t=>t[0]?.includes('5-Hour Credits')&&t[0]?.includes('Weekly Credits'));
  const quota=quotaTable?.find(r=>r[0]==='Lite');if(!quota)throw new Error('Z.ai Lite quota table missing');
  const multiplierTable=zt.find(t=>t[0]?.includes('Input Multiplier')&&t[0]?.includes('Output Multiplier'));
  const charges:Record<string,{input:number;output:number;cached:number}>={};
  for(const name of ['GLM-5.3','GLM-5.3-Flash']){
    const r=multiplierTable?.find(r=>r.some(c=>c===name||c.startsWith(name+' (')));
    if(!r)throw new Error(`Z.ai charging model disappeared: ${name}`);
    // The first body row has a row-spanned product-type cell; take the last 3 numeric columns.
    const values=r.slice(-3);charges[name]={input:amount(values[0])*100,cached:amount(values[1])*100,output:amount(values[2])*100};
  }
  const referenceTables=rt.filter(t=>t[0]?.includes('Input')&&t[0]?.includes('Output'));
  const goTable=gt.find(t=>t[0]?.includes('Monthly limit')&&t[0]?.includes('Cached Read'));
  if(!goTable)throw new Error('OpenCode token pricing table missing');
  const models=rateNames.map(name=>{
    const r=findRow(referenceTables,name),p=goTable.find(r=>r[0]===name);
    if(!r||!p)throw new Error(`Mapped model missing: ${name}`);
    return {name,id:modelIds[name],reference:{input:amount(r[1]),cached:cacheAmount(r[2]),output:amount(r[4])},go:{input:amount(p[1]),output:amount(p[2]),cached:cacheAmount(p[3]),monthly:amount(p[5])}};
  });
  return {liteMonthly:Number(lite[1]),goMonthly:Number(go[1]),fiveHour:amount(quota[1]),weekly:amount(quota[2]),charges,models};
}
export async function collectValueSources(){
  const hosts=new Set(['docs.z.ai','opencode.ai']);
  const entries=await Promise.all(Object.entries(VALUE_SOURCES).map(async([key,url])=>{
    const source=await fetchSource(url,hosts);
    const evidence=makeEvidence(source,{title:key==='go'?'OpenCode Go 價格與額度':key==='zai'?'Z.ai Coding Plan 條款':'Z.ai 官方 API 費率',publisher:key==='go'?'OpenCode':'Z.ai',kind:key==='reference'?'official-price':'official-terms'});
    return {key:key as keyof typeof VALUE_SOURCES,source,evidence};
  }));
  const raw=Object.fromEntries(entries.map(e=>[e.key,e.source.raw])) as {zai:string;reference:string;go:string};
  return {entries,facts:parseValueSources(raw)};
}
export function applyValueFacts(current:Catalog,bundle:Awaited<ReturnType<typeof collectValueSources>>){
  const next=structuredClone(current);next.schemaVersion='1.1.0';
  const ev=Object.fromEntries(bundle.entries.map(e=>[e.key,e.evidence])) as Record<keyof typeof VALUE_SOURCES,Evidence>;
  next.evidence=[...next.evidence,...bundle.entries.map(e=>e.evidence)];
  const freshness=(e:Evidence)=>({verifiedAt:e.fetchedAt,validUntil:new Date(Date.parse(e.fetchedAt)+3*86400000).toISOString(),effectiveFrom:null,expiresAt:null,evidenceIds:[e.id],status:'verified' as const});
  const f=bundle.facts;
  const zai=next.plans.find(p=>p.id==='zai-lite');if(!zai)throw new Error('Z.ai Lite plan must be reviewed before initializing offers');
  zai.billing.amount=f.liteMonthly;zai.billing.upfront=f.liteMonthly;zai.billing.renewalAmount=f.liteMonthly;zai.freshness=freshness(ev.zai);zai.modelIds=['glm53','glmflash'];
  zai.quota={kind:'credits',amount:f.weekly,reset:'7 days',hardCap:true,notes:`每週 ${f.weekly}；每 5 小時 ${f.fiveHour}。GLM-5.3 與 Flash 共享方案額度。`};
  if(!next.providers.some(p=>p.id==='opencode'))next.providers.push({id:'opencode',name:'OpenCode',website:'https://opencode.ai',trust:'aggregator',regions:['international'],regionNotes:'適用支援的 coding agent；須遵守 session header 與流量規則，未實測所有地區付款。'});
  // Refresh reviewed model mappings only; removed models need an editorial decision.
  const mappedModels=f.models.filter(m=>next.models.some(existing=>existing.id===m.id));
  let go=next.plans.find(p=>p.id==='opencode-go');
  if(!go){go={...structuredClone(zai),id:'opencode-go',providerId:'opencode',name:'OpenCode Go',product:'OpenCode Go',description:'同一訂閱搭配不同模型，使用額度與計費率不同。',benefits:['可搭配支援的 Coding Agent','依模型提供明確的月用量上限'],limitations:['每 5 小時、每週與每月均有限制；各模型情境不能相加。','客戶端需保留 session header；額外 Zen balance 用量另計。'],purchaseUrl:VALUE_SOURCES.go};next.plans.push(go);}
  go.billing.amount=f.goMonthly;go.billing.upfront=f.goMonthly;go.billing.renewalAmount=f.goMonthly;go.modelIds=[...new Set([...go.modelIds,...mappedModels.map(m=>m.id)])];go.freshness=freshness(ev.go);go.quota={kind:'opaque',amount:null,reset:'model-specific',hardCap:false,notes:'各模型上限不同；若啟用 Zen balance，用完訂閱額度後可產生額外費用。'};
  const rateCards:RateCard[]=[],offers:Offer[]=[];
  const card=(id:string,modelId:string,providerId:string,unit:'USD'|'credits',prices:{input:number;output:number;cached:number|null},e:Evidence)=>({id,modelId,providerId,unit,inputPerMillion:prices.input,outputPerMillion:prices.output,cachedInputPerMillion:prices.cached,contextUpperBound:null,freshness:freshness(e)});
  for(const m of mappedModels){
    const refId=`zai-api-${m.id}`,goId=`go-rate-${m.id}`;
    rateCards.push(card(refId,m.id,'zai','USD',m.reference,ev.reference),card(goId,m.id,'opencode','USD',m.go,ev.go));
    offers.push({id:`go-${m.id}`,planId:go.id,modelId:m.id,rateCardId:goId,referenceRateCardId:refId,kind:'allowance',windows:[{period:'five-hours',amount:m.go.monthly*.2,reset:'rolling'},{period:'week',amount:m.go.monthly*.5,reset:'subscription'},{period:'month',amount:m.go.monthly,reset:'subscription'}],sharedGroup:'opencode-go-scenarios',chargeMultiplier:1,label:'月額度情境',conditions:['每 5 小時／週／月限制','用滿額度的上限情境；不能相加','模型或客戶端路由可能與榜單測試環境不同'],freshness:freshness(ev.go)});
    const planId=`official-${m.id}`;
    if(!next.plans.some(p=>p.id===planId))next.plans.push({...structuredClone(zai),id:planId,name:`${m.name} API`,product:'Z.ai API',kind:'api',modelIds:[m.id],description:'官方 API 按量使用，作為同模型等值的比較基準。',benefits:['官方模型 API','按實際用量計費'],limitations:['工具費另計，付款與帳號資格依官方設定。'],billing:{...zai.billing,amount:0,interval:'usage',upfront:0,minimumPurchase:null,renewalAmount:null},apiRates:{inputPerMillion:m.reference.input,outputPerMillion:m.reference.output,cachedInputPerMillion:m.reference.cached,maxContext:32000,mode:'standard'},quota:{kind:'payg',amount:null,reset:null,hardCap:false,notes:'實際帳單按用量'},purchaseUrl:VALUE_SOURCES.reference,freshness:freshness(ev.reference)});
    const api=next.plans.find(p=>p.id===planId)!;api.freshness=freshness(ev.reference);api.billing.renewalAmount=null;api.apiRates={...api.apiRates!,inputPerMillion:m.reference.input,outputPerMillion:m.reference.output,cachedInputPerMillion:m.reference.cached};
    offers.push({id:`baseline-${m.id}`,planId,modelId:m.id,rateCardId:refId,referenceRateCardId:refId,kind:'metered',windows:[],sharedGroup:null,chargeMultiplier:1,label:'官方基準',conditions:['官方 API 按量計費','最低儲值額未核實，設付款上限時暫不列入'],freshness:freshness(ev.reference)});
  }
  for(const [name,prices] of Object.entries(f.charges)){
    const modelId=modelIds[name],cardId=`zai-credits-${modelId}`;rateCards.push(card(cardId,modelId,'zai','credits',prices,ev.zai));
    for(const [period,multiplier] of [['offpeak',.5],['peak',1]] as const)offers.push({id:`zai-lite-${modelId}-${period}`,planId:zai.id,modelId,rateCardId:cardId,referenceRateCardId:`zai-api-${modelId}`,kind:'allowance',windows:[{period:'five-hours',amount:f.fiveHour,reset:'rolling'},{period:'week',amount:f.weekly,reset:'subscription'}],sharedGroup:'zai-lite-credits',chargeMultiplier:multiplier,label:period==='peak'?'尖峰':'離峰',conditions:[`${period==='peak'?'尖峰':'離峰'}・用滿 4 週`,'尖峰為週一至五 14:00–18:00（UTC+8）','未計 MCP、活動贈額；同套餐不同模型／時段情境不能相加'],freshness:freshness(ev.zai)});
  }
  next.rateCards=[...next.rateCards.filter(r=>!rateCards.some(n=>n.id===r.id)),...rateCards];
  next.offers=[...next.offers.filter(o=>!offers.some(n=>n.id===o.id)),...offers];
  for(const lock of current.locks){
    if(lock.expiresAt&&Date.parse(lock.expiresAt)<=Date.now())continue;
    const [,collection,id]=lock.path.split('/');
    if(!['plans','offers','rateCards'].includes(collection))continue;
    const target=collection as 'plans'|'offers'|'rateCards';
    const original=current[target].find(x=>x.id===id);if(!original)continue;
    // Preserve the whole locked entity, including its prior evidence dates.
    (next[target] as any[])=next[target].map(x=>x.id===id?structuredClone(original):x);
  }
  return CatalogSchema.parse(next);
}
// Automatic renewal requires identical source bytes, not merely unchanged price cells.
// New wording may alter material restrictions even when prices remain the same.
export function sourcesUnchanged(current:Catalog,bundle:Awaited<ReturnType<typeof collectValueSources>>){
  return bundle.entries.every(({evidence})=>current.evidence.filter(e=>e.url===evidence.url).sort((a,b)=>b.fetchedAt.localeCompare(a.fetchedAt))[0]?.contentHash===evidence.contentHash);
}
