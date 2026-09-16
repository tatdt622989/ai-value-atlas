<script setup lang="ts">
import {computed} from 'vue';
import type {Catalog} from '../../shared/schema';
import {isFresh} from '../../shared/recommend';
import {t,dateLocale,collatorLocale} from '../i18n';
const props=defineProps<{catalog:Catalog}>();
const freshCount=computed(()=>props.catalog.plans.filter(p=>isFresh(p.freshness)).length);
const sourceCount=computed(()=>new Set(props.catalog.evidence.map(e=>new URL(e.url).hostname)).size);
const staleCount=computed(()=>props.catalog.plans.length-freshCount.value);
const publishedDate=computed(()=>new Date(props.catalog.publishedAt).toLocaleDateString(dateLocale()));
const providerName=(id:string)=>props.catalog.providers.find(v=>v.id===id)?.name??id;
const sortedPlans=computed(()=>[...props.catalog.plans].sort((a,b)=>Number(!isFresh(b.freshness))-Number(!isFresh(a.freshness))||providerName(a.providerId).localeCompare(providerName(b.providerId),collatorLocale())));
</script>
<template><section class="secondary-view"><div class="section-top"><div><h2>{{t('status.title')}}</h2></div><a class="outline" href="/api/v1/catalog" target="_blank" rel="noopener noreferrer">{{t('status.publicJson')}}</a></div><div class="status-summary"><div><strong>{{freshCount}}<small>/{{catalog.plans.length}}</small></strong><span>{{t('status.inDate')}}</span></div><div><strong>{{sourceCount}}</strong><span>{{t('status.sources')}}</span></div><div><strong>{{staleCount}}</strong><span>{{t('status.pendingRecheck')}}</span></div><div><strong>{{publishedDate}}</strong><span>{{t('status.lastUpdated')}}</span></div></div><h2 class="subheading">{{t('status.planSources')}}</h2><div class="source-list"><article v-for="p in sortedPlans" :key="p.id"><div><h3>{{providerName(p.providerId)}} · {{p.name}}</h3><p>{{p.kind==='api'?t('status.apiUsage'):t('status.subFree')}} · {{t('status.verified')}} {{p.freshness.verifiedAt.slice(0,10)}}</p></div><span class="status-label" :class="{expired:!isFresh(p.freshness)}">{{isFresh(p.freshness)?t('status.inDateTag'):t('status.recheckTag')}}</span><a :href="catalog.evidence.find(e=>e.id===p.freshness.evidenceIds[0])?.url" target="_blank" rel="noopener noreferrer">{{t('status.viewSource')}}</a></article></div></section></template>
