<script setup lang="ts">
import {computed,ref} from 'vue';
import type {ValueQuote,ValueResult} from '../../shared/value';
import {monthlyPayment} from '../../shared/value';
import {isCompleteValueQuote,type CompleteValueQuote} from '../../shared/visibility';
import type {Plan,Catalog,Benchmark} from '../../shared/schema';
import {providerIcons} from '../provider-icons';
import {t,td,collatorLocale} from '../i18n';
import type {UiKey} from '../locales/ui';
const props=defineProps<{data:ValueResult|null;catalog:Catalog|null;busy:boolean;now:number}>();
const emit=defineEmits<{detail:[ValueQuote];unknown:[Plan];reset:[];method:[]}>();
const quotes=computed(()=>(props.data?.quotes??[]).filter(isCompleteValueQuote));
const balanced=computed(()=>props.data?.preferences.ranking!=='value');
const displayValue=(q:CompleteValueQuote)=>balanced.value?q.recommendation.score:q.multiplier;
const max=computed(()=>balanced.value?100:Math.max(...quotes.value.filter(q=>q.dataStatus!=='historical').map(q=>q.multiplier),1));
const money=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:2});
const currency=(p:Plan)=>p.billing.currency==='USD'?'$':p.billing.currency+' ';
const condition=(q:ValueQuote)=>q.research?td(q.research.label):q.offer.kind==='metered'?t('cond.officialBaseline'):q.offer.id.startsWith('go-')?t('cond.goWindows'):`${td(q.offer.label)}`;
const compact=(text:string)=>{const line=text.replace(/\s+/g,' ').trim();return [...line].length>42?[...line].slice(0,41).join('')+'…':line;};

type Row={id:string;plan:Plan;quote:CompleteValueQuote;benchmark:Benchmark|null;provider:string;models:string};
const baseRows=computed<Row[]>(()=>quotes.value.map(q=>({id:q.id,plan:q.plan,quote:q,benchmark:q.benchmark,provider:q.provider.name,models:q.model.name})));
const planCount=computed(()=>new Set(baseRows.value.map(r=>r.plan.id)).size);
function price(row:Row){
 const p=row.plan;
 if(p.billing.priceLabel)return td(p.billing.priceLabel);
 if(p.kind==='free')return t('list.free');
 if(p.billing.interval==='usage')return t('list.usageBased');
 if(p.billing.interval==='once')return `${currency(p)}${money(p.billing.upfront)} · ${t('list.oneTime')}`;
 return `${currency(p)}${money(monthlyPayment(p))} / ${t('unknown.perMonth')}`;
}
const open=(row:Row)=>emit('detail',row.quote);
type SortKey='value'|'plan'|'rank'|'cost';
const sortKey=ref<SortKey>('value'),sortDirection=ref<'asc'|'desc'>('desc');
const defaults:Record<SortKey,'asc'|'desc'>={value:'desc',plan:'asc',rank:'asc',cost:'asc'};
const labels:Record<SortKey,UiKey>={value:'sort.value',plan:'sort.plan',rank:'sort.rank',cost:'sort.cost'};
const indicator=(key:SortKey)=>sortKey.value===key?(sortDirection.value==='asc'?'↑':'↓'):'↕';
const directionLabel=(key:SortKey)=>sortKey.value!==key?t('sort.none'):sortDirection.value==='asc'?t('sort.asc'):t('sort.desc');
const toggleSort=(key:SortKey)=>{if(sortKey.value===key)sortDirection.value=sortDirection.value==='asc'?'desc':'asc';else{sortKey.value=key;sortDirection.value=defaults[key]}};
const rows=computed(()=>{
 const direction=sortDirection.value==='asc'?1:-1;
 const compare=(a:number|null,b:number|null)=>a===null&&b===null?0:a===null?1:b===null?-1:(a-b)*direction;
 return [...baseRows.value].sort((a,b)=>{
  if(sortKey.value==='value'&&(a.quote?.dataStatus==='historical')!==(b.quote?.dataStatus==='historical'))return a.quote?.dataStatus==='historical'?1:-1;
  let value=0;
  if(sortKey.value==='value')value=compare(a.quote?displayValue(a.quote):null,b.quote?displayValue(b.quote):null);
  if(sortKey.value==='rank')value=compare(a.benchmark?.rank??null,b.benchmark?.rank??null);
  if(sortKey.value==='cost')value=compare(a.quote?.monthlyCost??a.plan.billing.amount/(a.plan.billing.interval==='year'?12:1),b.quote?.monthlyCost??b.plan.billing.amount/(b.plan.billing.interval==='year'?12:1));
  if(sortKey.value==='plan')value=(`${a.provider} ${a.plan.name} ${a.models}`).localeCompare(`${b.provider} ${b.plan.name} ${b.models}`,collatorLocale())*direction;
  return value||(b.quote?.multiplier??-1)-(a.quote?.multiplier??-1)||a.id.localeCompare(b.id);
 });
});
</script>
<template>
 <section class="value-results" :aria-label="t('list.aria')" :aria-busy="busy">
  <div class="value-basis"><h1>{{balanced?t('list.headingBalanced'):t('list.headingValue')}}</h1><button class="basis-link" @click="emit('method')">{{balanced?t('list.methodBalanced'):t('list.methodValue')}} <span class="info-icon" aria-hidden="true">i</span></button><span v-if="data" class="catalog-total" aria-live="polite">{{t('record.total',{n:planCount,scenarios:quotes.length})}}</span></div>
  <div v-if="busy" role="status" class="loading-line"><span></span><span class="sr-only">{{t('list.updating')}}</span></div>
  <div class="value-table">
   <div class="value-head value-grid"><button v-for="key in (['value','plan','rank','cost'] as const)" :key="key" class="sort-button" :aria-label="t(labels[key])+'，'+directionLabel(key)" :aria-pressed="sortKey===key" @click="toggleSort(key)">{{key==='value'?(balanced?t('list.score'):t('list.perDollar')):t(labels[key])}} <span class="sort-icon" aria-hidden="true">{{indicator(key)}}</span></button><span>{{t('sort.conditions')}}</span><span></span></div>
   <template v-if="data">
    <article v-for="(row,i) in rows" :key="row.id" class="value-row value-grid" :data-plan-id="row.plan.id" :data-record-id="row.id" data-ranking-status="adopted" :class="{best:i===0}">
     <div class="value-cell"><strong>{{(displayValue(row.quote)??row.quote.multiplier).toFixed(1)}}<span v-if="!balanced||displayValue(row.quote)===null">×</span><sup v-if="row.quote.basis==='research-estimate'">*</sup></strong><div v-if="displayValue(row.quote)!==null" class="value-track" aria-hidden="true"><span :style="{width:((displayValue(row.quote)??0)/max*100)+'%'}"></span></div><span class="score-context">{{!balanced&&row.quote.recommendation.score!==null?t('score.points',{v:row.quote.recommendation.score.toFixed(1)}):t('score.multiplier',{v:row.quote.multiplier.toFixed(1),basis:row.quote.basis==='research-estimate'?t('score.estimate'):t('score.discount')})}}</span></div>
     <div class="plan-cell"><span class="provider-mark" aria-hidden="true"><img v-if="providerIcons[row.plan.providerId]" :src="providerIcons[row.plan.providerId]" alt="" loading="lazy"><template v-else>{{row.provider.slice(0,1)}}</template></span><div class="plan-name"><span>{{row.provider}} · {{td(row.plan.name)}}</span><small>{{row.models||td(row.plan.product)}}</small><span class="mobile-price">{{price(row)}}</span></div></div>
     <div class="ability-cell"><strong v-if="row.benchmark?.rank">#{{row.benchmark.rank}}</strong><span v-else class="muted">{{t('score.notListed')}}</span><small v-if="row.benchmark&&Date.parse(row.benchmark.freshness.validUntil)<=now">{{row.benchmark.measuredAt.slice(5,10)}}</small></div>
     <div class="cost-cell"><strong>{{price(row)}}</strong><small v-if="row.plan.billing.interval==='year'" class="annual-payment">{{t('detail.annualUpfront')}} {{currency(row.plan)}}{{money(row.plan.billing.upfront)}}</small></div>
     <div class="condition-cell"><span>{{compact(condition(row.quote))}}</span></div>
     <button class="row-arrow" :aria-label="t('record.view',{plan:td(row.plan.name),model:row.quote?.model.name??''})" @click="open(row)">→</button>
    </article>
    <div v-if="!rows.length" class="empty-state"><h2>{{t('list.empty')}}</h2><p>{{t('list.emptyHint')}}</p><button class="solid-button" @click="emit('reset')">{{t('list.clearFilters')}}</button></div>
   </template>
   <div v-else class="loading-rows" :aria-label="t('list.loadingRows')"><div v-for="i in 7" :key="i"><span></span><span></span><span></span></div></div>
  </div>
  <div class="results-note"><span>{{t('record.note')}}</span><span v-if="data">{{t('record.total',{n:planCount,scenarios:quotes.length})}}</span></div>
 </section>
</template>
