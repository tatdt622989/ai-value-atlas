<script setup lang="ts">
import {computed,ref} from 'vue';
import type { Catalog,CategoryId } from '../../shared/schema';
import {isFresh} from '../../shared/recommend';
import {t} from '../i18n';
import type {UiKey} from '../locales/ui';
const props=defineProps<{catalog:Catalog}>();const category=ref<CategoryId>('webdev');
const categories:[CategoryId,UiKey|string][]=[['webdev','WebDev'],['coding','Coding'],['frontend','Frontend'],['general','bench.general']];
const records=computed(()=>props.catalog.benchmarks.filter(b=>b.category===category.value&&isFresh(b.freshness)).sort((a,b)=>(a.source+a.benchmarkVersion+a.harness).localeCompare(b.source+b.benchmarkVersion+b.harness)||(a.rank??9999)-(b.rank??9999)));
const catLabel=(label:UiKey|string)=>label==='bench.general'?t('bench.general'):label;
</script>
<template><section class="secondary-view"><div class="section-top"><div><h2>{{t('bench.title')}}</h2><p>{{t('bench.intro')}}</p></div><a href="https://arena.ai/leaderboard/code/webdev" target="_blank" rel="noopener noreferrer" class="outline">{{t('bench.gotoBoard')}}</a></div><div class="tab-filters"><button v-for="[id,label] in categories" :key="id" :class="{active:category===id}" @click="category=id">{{catLabel(label)}}</button></div><div v-if="!records.length" class="empty-state"><h3>{{t('bench.empty')}}</h3><p>{{category==='frontend'?t('bench.frontendNote'):t('bench.aaNote')}}</p></div><div v-else class="benchmark-table"><div class="benchmark-head"><span>{{t('bench.rank')}}</span><span>{{t('bench.modelVersion')}}</span><span>{{t('bench.score')}}</span><span>{{t('bench.tested')}}</span><span>{{t('bench.source')}}</span></div><article v-for="b in records" :key="b.id" class="benchmark-row"><span class="rank-number">{{b.rank??t('score.notListed')}}</span><div><h3>{{catalog.models.find(m=>m.id===b.modelId)?.name}}</h3><p>{{b.variant}} · {{b.harness}}</p></div><div class="score-number">{{b.score}}<small v-if="b.confidenceLow!==null">{{b.confidenceLow}}–{{b.confidenceHigh}}</small></div><span>{{b.measuredAt.slice(0,10)}}</span><a :href="catalog.evidence.find(e=>e.id===b.freshness.evidenceIds[0])?.url" target="_blank" rel="noopener noreferrer">{{b.source==='arena'?'Arena':'Artificial Analysis'}} ↗</a></article></div><p class="context-note">{{t('bench.note')}}</p></section></template>
