<script setup lang="ts">
import type {ResearchValue} from '../../shared/schema';
import {t,td} from '../i18n';
defineProps<{rows:ResearchValue[]}>();
</script>
<template>
  <section v-if="rows.length" class="research-notes">
    <h3>{{t('pending.research')}}</h3><p class="context-note">{{t('pending.intro')}}</p>
    <article v-for="r in rows" :key="r.id" class="research-history-row">
      <h4>{{r.modelLabel}} · {{r.ratio===null?'—':`${r.ratio.toFixed(1)}×`}}</h4>
      <p>{{td(r.label)}} · {{t('research.originalCheck')}} {{r.originalCheckedAt.slice(0,10)}}</p>
      <p v-if="r.low!==null">{{t('research.range',{lo:r.low.toFixed(1),hi:r.high===null?'—':r.high.toFixed(1),c:td(r.confidence)})}}</p>
      <p>{{td(r.warning)}}</p>
      <details><summary>{{t('research.sourcesWeights')}}</summary><p>{{td(r.method)}}</p><article v-for="s in r.sourceSamples" :key="s.url" class="research-source"><a :href="s.url" target="_blank" rel="noopener noreferrer">{{td(s.label)}} ↗</a><small>{{s.date}} · {{t('research.weight',{n:Math.round(s.weight*100)})}}</small><p>{{td(s.note)}}</p></article></details>
    </article>
  </section>
</template>
