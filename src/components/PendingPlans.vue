<script setup lang="ts">
import type {pendingValuePlans} from '../../shared/value';
import type {Plan} from '../../shared/schema';
import {t,td} from '../i18n';
defineProps<{rows:ReturnType<typeof pendingValuePlans>;open:boolean}>();
const emit=defineEmits<{detail:[Plan]}>();
const money=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:2});
</script>
<template>
  <details v-if="rows.length" class="unknown-plans pending-plans" :open="open">
    <summary><span class="disclosure" aria-hidden="true">⌄</span><strong>{{t('pending.title')}}</strong><span class="muted">{{t('pending.count',{n:rows.length})}}</span></summary>
    <p class="unknown-intro">{{t('pending.intro')}}</p>
    <article v-for="q in rows" :key="q.plan.id">
      <div><strong>{{td(q.plan.name)}}</strong><small>{{q.modelNames.join(' / ')}}</small><small>{{t('pending.checked',{date:q.plan.freshness.verifiedAt.slice(0,10)})}}</small><small v-if="q.research.length">{{t('pending.research')}}: {{q.research.filter(r=>r.ratio!==null).map(r=>`${r.modelLabel} ${r.ratio!.toFixed(1)}×`).join(' · ')}}</small></div>
      <span class="pending-price"><small>{{t('pending.price')}}</small>{{q.plan.billing.interval==='usage'?t('detail.byUsage'):`${q.plan.billing.currency} ${money(q.plan.billing.amount)} / ${q.plan.billing.interval==='once'?t('list.oneTime'):q.plan.billing.interval==='year'?t('list.perYear'):t('unknown.perMonth')}`}}</span>
      <button class="row-arrow" :aria-label="t('pending.view',{plan:td(q.plan.name)})" @click="emit('detail',q.plan)">→</button>
    </article>
  </details>
</template>
