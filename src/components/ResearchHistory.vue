<script setup lang="ts">
import type {ResearchValue} from '../../shared/schema';
import {historicalResearchRatio} from '../../shared/value';
import {t,td} from '../i18n';
defineProps<{rows:ResearchValue[]}>();
</script>
<template>
  <section v-if="rows.length" class="research-notes">
    <h3>{{t('pending.research')}}</h3><p class="context-note">{{t('pending.intro')}}</p>
    <article v-for="r in rows" :key="r.id" class="research-history-row">
      <h4>{{r.modelLabel}} · {{(r.ratio??historicalResearchRatio(r))===null?t('score.noPublishedUsage'):`${(r.ratio??historicalResearchRatio(r))!.toFixed(2)}×`}}<span v-if="r.ratio===null&&historicalResearchRatio(r)!==null"> ({{t('research.historical')}})</span></h4>
      <p>{{td(r.label)}} · {{t('research.originalCheck')}} {{r.originalCheckedAt.slice(0,10)}}</p>
      <p v-if="r.low!==null">{{t('research.range',{lo:r.low.toFixed(1),hi:r.high===null?t('score.notPublished'):r.high.toFixed(1),c:td(r.confidence)})}}</p>
      <dl class="detail-facts"><div v-if="r.millionTokens!==null"><dt>{{t('calc.totalTokens')}}</dt><dd>{{r.millionTokens.toFixed(2)}} M</dd></div><div v-if="r.cachedRatio!==null"><dt>{{t('research.cachedRatio')}}</dt><dd>{{r.cachedRatio.toFixed(2)}}×</dd></div><div v-if="r.cachedMillionTokens!==null"><dt>{{t('research.cachedTokens')}}</dt><dd>{{r.cachedMillionTokens.toFixed(2)}}</dd></div></dl>
      <p>{{td(r.warning)}}</p>
      <details v-if="r.reviewNotes.length"><summary>{{t('research.reviewHistory')}}</summary><p v-for="note in r.reviewNotes" :key="note">{{td(note)}}</p></details>
      <details><summary>{{t('research.sourcesWeights')}}</summary><p>{{td(r.method)}}</p><article v-for="s in r.sourceSamples" :key="s.url" class="research-source"><a :href="s.url" target="_blank" rel="noopener noreferrer">{{td(s.label)}} ↗</a><small>{{s.date}} · {{t('research.weight',{n:Math.round(s.weight*100)})}} · {{t('research.monthlyEquivalent',{v:s.value.toLocaleString()})}}</small><p>{{td(s.note)}}</p></article></details>
    </article>
  </section>
</template>
