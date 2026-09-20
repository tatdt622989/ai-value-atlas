import { z } from 'zod';

export const Category = z.enum(['general', 'coding', 'webdev', 'frontend']);
const Id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,100}$/);
const DateTime = z.iso.datetime();
const Url = z.url().refine(v => v.startsWith('https://'), 'HTTPS source required');
export const Freshness = z.object({
  verifiedAt: DateTime, validUntil: DateTime,
  effectiveFrom: DateTime.nullable(), expiresAt: DateTime.nullable(),
  evidenceIds: z.array(Id).min(1), status: z.enum(['verified', 'pending', 'withdrawn']),
}).strict();
export const EvidenceSchema = z.object({
  id: Id, url: Url, title: z.string().min(1), publisher: z.string().min(1),
  kind: z.enum(['official-price', 'official-terms', 'benchmark', 'community']),
  fetchedAt: DateTime, sourceUpdatedAt: DateTime.nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  excerpt: z.string().max(16000), method: z.enum(['http', 'browser', 'web-research', 'api', 'user-import']),
}).strict();
export const ProviderSchema = z.object({
  id: Id, name: z.string(), website: Url, trust: z.enum(['official', 'reseller', 'aggregator']),
  regions: z.array(z.string()), regionNotes: z.string(),
}).strict();
export const ModelSchema = z.object({
  id: Id, providerId: Id, name: z.string(), version: z.string(),
  aliases: z.array(z.string()), contextWindow: z.number().int().positive().nullable(),
}).strict();
export const PlanSchema = z.object({
  id: Id, providerId: Id, name: z.string(), product: z.string(),
  kind: z.enum(['subscription', 'api', 'free', 'prepaid']),
  modelIds: z.array(Id), categories: z.array(Category).min(1),
  description: z.string().max(400), benefits: z.array(z.string()).max(8), limitations: z.array(z.string()).min(1),
  billing: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/), amount: z.number().nonnegative(),
    priceLabel: z.string().min(1).max(100).optional(),
    interval: z.enum(['month', 'year', 'usage', 'once']), upfront: z.number().nonnegative(),
    minimumPurchase: z.number().nonnegative().nullable(), renewalAmount: z.number().nonnegative().nullable(),
    feePercent: z.number().min(0).max(100), feeFixed: z.number().nonnegative(), taxIncluded: z.boolean(),
  }).strict(),
  apiRates: z.object({
    inputPerMillion: z.number().nonnegative(), outputPerMillion: z.number().nonnegative(),
    cachedInputPerMillion: z.number().nonnegative().nullable(),
    maxContext: z.number().int().positive().nullable(), mode: z.enum(['standard', 'batch', 'flex']),
  }).strict().nullable(),
  quota: z.object({
    kind: z.enum(['opaque', 'tokens', 'credits', 'requests', 'payg']),
    amount: z.number().nonnegative().nullable(), reset: z.string().nullable(),
    hardCap: z.boolean(), notes: z.string(),
  }).strict(),
  monetaryValue: z.object({
    amount:z.number().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/),
    basis:z.enum(['platform-budget','api-observation','retail-credit-value','unit-cost']),
    period:z.string().min(1),notes:z.string().min(1),freshness:Freshness,
  }).strict().optional(),
  availability: z.enum(['public', 'waitlist', 'ended']),
  audience: z.enum(['individual', 'team']), purchaseUrl: Url,
  freshness: Freshness,
}).strict().superRefine((p, ctx) => {
  if (p.kind === 'api' && !p.apiRates) ctx.addIssue({ code: 'custom', message: 'API rates required' });
  if (p.kind === 'free' && (p.billing.amount || p.billing.upfront)) ctx.addIssue({ code: 'custom', message: 'Free plan must cost zero' });
  if (p.billing.interval === 'year' && p.billing.upfront < p.billing.amount) ctx.addIssue({ code: 'custom', message: 'Annual upfront must cover annual amount' });
  if (p.quota.kind === 'opaque' && p.quota.amount !== null) ctx.addIssue({ code: 'custom', message: 'Opaque quotas must not invent a quantity' });
});
export const BenchmarkSchema = z.object({
  id: Id, modelId: Id, source: z.enum(['arena', 'artificial-analysis']),
  category: Category, benchmarkName: z.string(), benchmarkVersion: z.string(),
  variant: z.string(), harness: z.string(), score: z.number().finite(), rank: z.number().int().positive().nullable(),
  cohortSize: z.number().int().positive().optional(),
  rankLow: z.number().int().positive().nullable().optional(),
  rankHigh: z.number().int().positive().nullable().optional(),
  sampleSize: z.number().int().nonnegative().nullable(),
  confidenceLow: z.number().nullable(), confidenceHigh: z.number().nullable(),
  outputTokensPerSecond: z.number().positive().nullable(),
  measuredAt: DateTime, freshness: Freshness,
}).strict();
export const LockSchema = z.object({
  path: z.string().regex(/^\/(plans|benchmarks|rateCards|offers|research)\/[a-z0-9._-]+(?:\/[a-zA-Z]+)*$/), reason: z.string().min(8), actor: z.string().min(1),
  createdAt: DateTime, expiresAt: DateTime.nullable(),
}).strict();
export const RateCardSchema=z.object({
  id:Id,providerId:Id,modelId:Id,unit:z.enum(['USD','credits']),
  inputPerMillion:z.number().nonnegative(),outputPerMillion:z.number().nonnegative(),
  cachedInputPerMillion:z.number().nonnegative().nullable(),
  contextUpperBound:z.number().int().positive().nullable(),
  freshness:Freshness,
}).strict();
export const OfferSchema=z.object({
  id:Id,planId:Id,modelId:Id,rateCardId:Id,referenceRateCardId:Id,
  kind:z.enum(['metered','allowance']),
  windows:z.array(z.object({period:z.enum(['five-hours','week','month']),amount:z.number().positive(),reset:z.enum(['rolling','subscription','calendar'])}).strict()).max(3),
  sharedGroup:Id.nullable(),chargeMultiplier:z.number().positive(),
  fixedMonthlyUSD:z.number().nonnegative().optional(),
  label:z.string().max(60),conditions:z.array(z.string()).min(1).max(10),
  freshness:Freshness,
}).strict().superRefine((o,ctx)=>{
  if(o.kind==='allowance'&&!o.windows.length)ctx.addIssue({code:'custom',message:'Allowance offers need verified quota windows'});
  if(o.kind==='metered'&&o.windows.length)ctx.addIssue({code:'custom',message:'Metered offers cannot invent included quotas'});
  if(o.kind!=='metered'&&o.fixedMonthlyUSD)ctx.addIssue({code:'custom',message:'Fixed platform fees apply only to metered scenarios'});
  if(new Set(o.windows.map(w=>w.period)).size!==o.windows.length)ctx.addIssue({code:'custom',message:'Duplicate quota windows'});
});

export const ResearchValueSchema=z.object({
  id:Id,planId:Id,modelId:Id,originalId:z.string(),sourceFileHash:z.string().regex(/^[a-f0-9]{64}$/),
  basis:z.enum(['research-estimate','research-calculated']),modelLabel:z.string(),label:z.string(),
  tokenInference:z.enum(['model-proxy','disabled']).optional(),
  billingToUSD:z.number().positive().optional(),
  tokenMix:z.object({input:z.number().min(0).max(1),output:z.number().min(0).max(1),cached:z.number().min(0).max(1)}).strict().refine(m=>Math.abs(m.input+m.output+m.cached-1)<1e-9,'Token shares must sum to one').optional(),
  observedUsage:z.object({millionTokens:z.number().positive(),equivalentUSD:z.number().positive(),startedAt:DateTime,endedAt:DateTime,projectionFactor:z.number().positive().optional()}).strict().refine(u=>Date.parse(u.startedAt)<=Date.parse(u.endedAt),'Observation end must follow its start').optional(),
  eligible:z.boolean(),replacedByOfferId:Id.nullable(),monthlyCost:z.number().nonnegative().nullable(),cash:z.number().positive(),upfrontCost:z.number().nonnegative(),
  ratio:z.number().nonnegative().nullable(),cachedRatio:z.number().nonnegative().nullable(),millionTokens:z.number().nonnegative().nullable(),cachedMillionTokens:z.number().nonnegative().nullable(),
  low:z.number().nonnegative().nullable(),high:z.number().nonnegative().nullable(),confidence:z.string(),method:z.string(),warning:z.string(),
  sourceSamples:z.array(z.object({label:z.string(),url:Url,value:z.number().nonnegative(),weight:z.number().nonnegative(),date:z.string(),kind:z.string(),note:z.string()}).strict()),
  conditions:z.array(z.string()),sharedGroup:Id.nullable(),
  originalCheckedAt:DateTime,reviewedAt:DateTime.nullable(),reviewNotes:z.array(z.string()),
  freshness:Freshness,
}).strict();
export const CatalogSchema = z.object({
  schemaVersion: z.enum(['1.0.0','1.1.0']), version: Id, publishedAt: DateTime,
  providers: z.array(ProviderSchema), models: z.array(ModelSchema), plans: z.array(PlanSchema),
  benchmarks: z.array(BenchmarkSchema), evidence: z.array(EvidenceSchema), locks: z.array(LockSchema),
  rateCards:z.array(RateCardSchema).default([]),offers:z.array(OfferSchema).default([]),research:z.array(ResearchValueSchema).default([]),
}).strict().superRefine((c, ctx) => {
  const check = (items: {id:string}[], label:string) => {
    if (new Set(items.map(v=>v.id)).size !== items.length) ctx.addIssue({code:'custom',message:`Duplicate ${label} IDs`});
  };
  check(c.providers,'provider');check(c.models,'model');check(c.plans,'plan');check(c.benchmarks,'benchmark');check(c.evidence,'evidence');
  check(c.research,'research value');
  for(const r of c.research)if(!c.plans.some(p=>p.id===r.planId)||!c.models.some(m=>m.id===r.modelId))ctx.addIssue({code:'custom',message:`Invalid research references ${r.id}`});
  check(c.rateCards,'rate card');check(c.offers,'offer');
  const providers = new Set(c.providers.map(x=>x.id)), models = new Set(c.models.map(x=>x.id)), evidence = new Set(c.evidence.map(x=>x.id));
  for (const m of c.models) if (!providers.has(m.providerId)) ctx.addIssue({code:'custom',message:`Unknown provider ${m.providerId}`});
  for (const p of c.plans) {
    if (!providers.has(p.providerId) || p.modelIds.some(id=>!models.has(id))) ctx.addIssue({code:'custom',message:`Invalid plan references ${p.id}`});
    if(p.monetaryValue?.freshness.evidenceIds.some(id=>!evidence.has(id)))ctx.addIssue({code:'custom',message:`Missing monetary evidence ${p.id}`});
  }
  for (const b of c.benchmarks) if (!models.has(b.modelId)) ctx.addIssue({code:'custom',message:`Unknown benchmark model ${b.modelId}`});
  for(const r of c.rateCards)if(!providers.has(r.providerId)||!models.has(r.modelId))ctx.addIssue({code:'custom',message:`Invalid rate card references ${r.id}`});
  for(const o of c.offers){
    const p=c.plans.find(p=>p.id===o.planId),rate=c.rateCards.find(r=>r.id===o.rateCardId),reference=c.rateCards.find(r=>r.id===o.referenceRateCardId);
    if(!p||!p.modelIds.includes(o.modelId)||!models.has(o.modelId)||!rate||!reference||rate.modelId!==o.modelId||reference.modelId!==o.modelId||reference.unit!=='USD'||(o.kind==='metered'&&rate.unit!=='USD'))ctx.addIssue({code:'custom',message:`Invalid offer references or units ${o.id}`});
    if(reference&&c.providers.find(p=>p.id===reference.providerId)?.trust!=='official')ctx.addIssue({code:'custom',message:`Reference must use official provider ${o.id}`});
  }
  for (const e of [...c.plans,...c.benchmarks,...c.rateCards,...c.offers,...c.research,...c.plans.filter(p=>p.monetaryValue).map(p=>({id:p.id,freshness:p.monetaryValue!.freshness}))]) {
    if (e.freshness.evidenceIds.some(id=>!evidence.has(id))) ctx.addIssue({code:'custom',message:`Missing evidence for ${e.id}`});
    if (Date.parse(e.freshness.validUntil)<=Date.parse(e.freshness.verifiedAt)) ctx.addIssue({code:'custom',message:`Invalid expiry for ${e.id}`});
    const maxDays='benchmarkName' in e?7:3;
    if(Date.parse(e.freshness.validUntil)-Date.parse(e.freshness.verifiedAt)>maxDays*86400000)ctx.addIssue({code:'custom',message:`Freshness exceeds ${maxDays} days for ${e.id}`});
  }
});
export type Catalog = z.infer<typeof CatalogSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Benchmark = z.infer<typeof BenchmarkSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type ResearchValue=z.infer<typeof ResearchValueSchema>;
export type Offer=z.infer<typeof OfferSchema>;
export type RateCard=z.infer<typeof RateCardSchema>;
export type CategoryId = z.infer<typeof Category>;
export const PreferencesSchema = z.object({
  budget: z.number().min(0).max(100000), currency: z.literal('USD').default('USD'),
  mode: z.enum(['subscription', 'api']).default('subscription'),
  categories: z.array(Category).min(1).default(['general','coding','webdev','frontend']),
  priority: z.enum(['balanced', 'quality', 'price', 'speed']).default('balanced'),
  allowAnnual: z.boolean().default(false), upfrontBudget: z.number().min(0).max(100000).default(0),
  includeResellers: z.boolean().default(false),
  workload: z.object({inputTokens: z.number().int().min(0).max(1000000000), outputTokens: z.number().int().min(0).max(1000000000), context: z.number().int().min(1).max(2000000)}).default({inputTokens:1000000,outputTokens:250000,context:32000}),
}).strict();
export type Preferences = z.infer<typeof PreferencesSchema>;
export const ValuePreferencesSchema=z.object({
  category:z.enum(['all','general','coding','webdev','frontend']).default('all'),
  ranking:z.enum(['balanced','value']).default('balanced'),
  utilization:z.enum(['full','half','quarter']).default('full'),
  profile:z.enum(['standard','cached']).default('standard'),
  budget:z.number().min(0).max(100000).nullable().default(null),
  upfrontBudget:z.number().min(0).max(100000).nullable().default(null),
  allowAnnual:z.boolean().default(true),
  providerId:z.string().max(100).nullable().default(null),
  query:z.string().max(100).default(''),
  minRank:z.number().int().min(1).max(1000).nullable().default(null),
  minTokensPerSecond:z.number().positive().max(100000).nullable().default(null),
  apiSpendUSD:z.number().positive().max(100000).default(20),
  context:z.number().int().min(1).max(2000000).default(32000),
}).strict();
export type ValuePreferences=z.infer<typeof ValuePreferencesSchema>;
