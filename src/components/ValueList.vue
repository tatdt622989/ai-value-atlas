<script setup lang="ts">
import {computed,ref} from 'vue';
import type {ValueQuote,ValueResult} from '../../shared/value';
import type {Plan} from '../../shared/schema';
import {providerIcons} from '../provider-icons';
import {t,td,collatorLocale} from '../i18n';
import type {UiKey} from '../locales/ui';
const props=defineProps<{data:ValueResult|null;busy:boolean;now:number}>();
const emit=defineEmits<{detail:[ValueQuote];unknown:[Plan];reset:[];method:[]}>();
const quotes=computed(()=>props.data?.quotes.filter(q=>Date.parse(q.validUntil)>props.now)??[]);
const balanced=computed(()=>props.data?.preferences.ranking!=='value');
const viewCategory=computed(()=>{const c=props.data?.preferences.category??'all';return c==='all'?'general':c;});
const boardLabel:Record<string,string>={coding:'Coding',webdev:'WebDev',frontend:'Frontend'};
const max=computed(()=>balanced.value?100:Math.max(...quotes.value.map(q=>q.multiplier),1));
const displayValue=(q:typeof quotes.value[number])=>balanced.value?q.recommendation?.score??null:q.multiplier;
const unknown=computed(()=>props.data?.unknown.filter(q=>Date.parse(q.plan.freshness.validUntil)>props.now)??[]);
const money=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:2});
const condition=(q:ValueQuote)=>q.research?td(q.research.label):q.offer.kind==='metered'?t('cond.officialBaseline'):q.offer.id.startsWith('go-')?t('cond.goWindows'):`${td(q.offer.label)} · ${t('cond.utilWeeks',{u:t(q.calculation.utilization===1?'cond.utilFull':q.calculation.utilization===.5?'cond.utilHalf':'cond.utilQuarter')})}`;
const unknownReason=(p:Plan)=>p.availability==='waitlist'?td('缺貨／候補；暫不可購'):p.kind==='free'?t('unknown.free'):t('unknown.nousage');
type SortKey='value'|'plan'|'rank'|'cost';
type SortDirection='asc'|'desc';
const sortKey=ref<SortKey>('value');
const sortDirection=ref<SortDirection>('desc');
const defaultDirection:Record<SortKey,SortDirection>={value:'desc',plan:'asc',rank:'asc',cost:'asc'};
const sortLabels:Record<SortKey,UiKey>={value:'sort.value',plan:'sort.plan',rank:'sort.rank',cost:'sort.cost'};
const sortIndicator=(key:SortKey)=>sortKey.value===key?(sortDirection.value==='asc'?'↑':'↓'):'↕';
const sortDirectionLabel=(key:SortKey)=>sortKey.value!==key?t('sort.none'):sortDirection.value==='asc'?t('sort.asc'):t('sort.desc');
const toggleSort=(key:SortKey)=>{if(sortKey.value===key)sortDirection.value=sortDirection.value==='asc'?'desc':'asc';else{sortKey.value=key;sortDirection.value=defaultDirection[key]}};
const sortedQuotes=computed(()=>{
 const rows=[...quotes.value],direction=sortDirection.value==='asc'?1:-1;
 const compareNullable=(a:number|null,b:number|null)=>{if(a===null&&b===null)return 0;if(a===null)return 1;if(b===null)return -1;return(a-b)*direction};
 rows.sort((a,b)=>{
  let result=0;
  if(sortKey.value==='value')result=compareNullable(displayValue(a),displayValue(b));
  if(sortKey.value==='rank')result=compareNullable(a.benchmark?.rank??null,b.benchmark?.rank??null);
  if(sortKey.value==='cost')result=compareNullable(a.monthlyCost,b.monthlyCost);
  if(sortKey.value==='plan')result=(`${a.provider.name} ${a.plan.name} ${a.model.name}`).localeCompare(`${b.provider.name} ${b.plan.name} ${b.model.name}`,collatorLocale())*direction;
  return result||b.multiplier-a.multiplier||(a.monthlyCost??Infinity)-(b.monthlyCost??Infinity)||a.id.localeCompare(b.id);
 });
 return rows;
});
</script>
<template>
  <section class="value-results" :aria-label="t('list.aria')" :aria-busy="busy">
    <div class="value-basis">
      <h1>{{balanced?t('list.headingBalanced'):t('list.headingValue')}}</h1>
      <button class="basis-link" @click="emit('method')">{{balanced?t('list.methodBalanced'):t('list.methodValue')}} <span class="info-icon" aria-hidden="true">i</span></button>
    </div>
    <div v-if="busy" role="status" class="loading-line"><span></span><span class="sr-only">{{t('list.updating')}}</span></div>
    <div class="value-table">
      <div class="value-head value-grid">
        <button type="button" class="sort-button" :aria-label="t(sortLabels.value) + '，' + sortDirectionLabel('value')" :aria-pressed="sortKey==='value'" @click="toggleSort('value')">{{balanced?t('list.score'):t('list.perDollar')}} <span class="sort-icon" aria-hidden="true">{{sortIndicator('value')}}</span></button>
        <button type="button" class="sort-button" :aria-label="t(sortLabels.plan) + '，' + sortDirectionLabel('plan')" :aria-pressed="sortKey==='plan'" @click="toggleSort('plan')">{{t('sort.plan')}} <span class="sort-icon" aria-hidden="true">{{sortIndicator('plan')}}</span></button>
        <button type="button" class="sort-button" :aria-label="t(sortLabels.rank) + '，' + sortDirectionLabel('rank')" :aria-pressed="sortKey==='rank'" @click="toggleSort('rank')">{{t('sort.rank')}} <span class="sort-icon" aria-hidden="true">{{sortIndicator('rank')}}</span></button>
        <button type="button" class="sort-button" :aria-label="t(sortLabels.cost) + '，' + sortDirectionLabel('cost')" :aria-pressed="sortKey==='cost'" @click="toggleSort('cost')">{{t('sort.cost')}} <span class="sort-icon" aria-hidden="true">{{sortIndicator('cost')}}</span></button>
        <span>{{t('sort.conditions')}}</span><span></span>
      </div>
      <template v-if="data">
        <article v-for="(q,i) in sortedQuotes" :key="q.id" class="value-row value-grid" :class="{best:i===0&&(!balanced||displayValue(q)!==null)}">
          <div class="value-cell"><strong>{{displayValue(q)?.toFixed(1)??'—'}}<span v-if="!balanced">×</span><sup v-if="q.basis==='research-estimate'" :aria-label="q.research?td(q.research.label):t('score.estimate')">*</sup></strong><div v-if="displayValue(q)!==null" class="value-track" aria-hidden="true"><span :style="{width:((displayValue(q)??0)/max*100)+'%'}"></span></div><span class="score-context" v-if="balanced">{{q.recommendation?.score===null?(q.recommendation.reason==='missing-comparable-usage'?t('score.pendingSplit'):t('score.noBenchmark',{v:q.multiplier.toFixed(1)})):t('score.multiplier',{v:q.multiplier.toFixed(1),basis:q.basis==='research-estimate'?t('score.estimate'):t('score.discount')})}}</span></div>
          <div class="plan-cell" :class="{'research-plan':q.research}"><span class="provider-mark" aria-hidden="true"><img v-if="providerIcons[q.provider.id]" :src="providerIcons[q.provider.id]" alt="" loading="lazy"><template v-else>{{q.provider.id==='opencode'?'OC':q.provider.name.slice(0,1)}}</template></span><div class="plan-name"><span>{{q.provider.name}}<span class="name-dot"> · </span>{{q.plan.kind==='api'?t('list.officialApi'):td(q.plan.name).replace(q.provider.name,'').replace('Coding ','').trim()}}</span><small>{{q.model.name}}</small><span class="mobile-price">{{q.plan.billing.interval==='once'?`$${money(q.upfrontCost)} · ${t('list.oneTime')}`:q.monthlyCost===null?t('list.usageBased'):`$${money(q.monthlyCost)}${t('list.perMonth')}`}}<span v-if="q.basis==='research-estimate'"> · {{t('list.est')}}*</span></span></div></div>
          <div class="ability-cell"><strong v-if="q.benchmark?.rank&&Date.parse(q.benchmark.freshness.validUntil)>now">#{{q.benchmark.rank}}<small v-if="q.benchmark.category!==viewCategory" class="board-tag">{{boardLabel[q.benchmark.category]??q.benchmark.category}}</small></strong><span v-else class="muted">—</span></div>
          <div class="cost-cell"><template v-if="q.plan.billing.interval==='once'"><strong>${{money(q.upfrontCost)}}</strong><span>{{t('list.oneTime')}}</span></template><template v-else-if="q.monthlyCost!==null"><strong>${{money(q.monthlyCost)}}</strong><span>{{t('list.perMonth')}}</span></template><template v-else>{{t('list.usageBased')}}</template></div>
          <div class="condition-cell">{{condition(q)}}</div><button class="row-arrow" :aria-label="t('list.viewScenario',{plan:td(q.plan.name),model:q.model.name,label:td(q.offer.label)})" @click="emit('detail',q)">→</button>
        </article>
        <div v-if="!quotes.length&&!unknown.length" class="empty-state"><h2>{{t('list.empty')}}</h2><p>{{t('list.emptyHint')}}</p><button class="solid-button" @click="emit('reset')">{{t('list.clearFilters')}}</button></div>
      </template>
      <div v-else class="loading-rows" :aria-label="t('list.loadingRows')"><div v-for="i in 7" :key="i"><span></span><span></span><span></span></div></div>
    </div>
    <details v-if="unknown.length" class="unknown-plans" :open="Boolean(data?.preferences.query.trim())">
      <summary><span class="disclosure" aria-hidden="true">⌄</span><strong>{{t('unknown.title')}}</strong><span class="muted">{{t('unknown.more',{names:unknown.slice(0,2).map(q=>q.plan.name).join('、'),n:unknown.length})}}</span></summary>
      <div class="unknown-intro">{{t('unknown.intro')}}</div>
      <article v-for="q in unknown" :key="q.plan.id"><div><strong>{{td(q.plan.name)}}</strong><small>{{q.modelNames.length?`${q.modelNames.join(' / ')} · ${unknownReason(q.plan)}`:unknownReason(q.plan)}}</small></div><span>{{q.plan.billing.interval==='usage'?t('detail.byUsage'):q.plan.kind==='free'?t('list.free'):`$${money(q.plan.billing.amount)} / ${q.plan.billing.interval==='once'?t('list.oneTime'):q.plan.billing.interval==='year'?t('list.perYear'):t('unknown.perMonth')}`}}</span><button class="row-arrow" :aria-label="t('list.viewPlan',{plan:td(q.plan.name),models:q.modelNames.length?' '+q.modelNames.join(' '):''})" @click="emit('unknown',q.plan)">→</button></article>
    </details>
    <div class="results-note"><span v-if="balanced">{{t('list.balancedNote')}}</span><span>{{t('list.estimateNote')}}</span><span v-if="data" aria-live="polite">{{t('list.scenarios',{n:quotes.length})}}</span></div>
  </section>
</template>
