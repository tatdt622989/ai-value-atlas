<script setup lang="ts">
import {computed,ref} from 'vue';
import type {Catalog,ValuePreferences} from '../../shared/schema';
import {t} from '../i18n';
import type {UiKey} from '../locales/ui';
const props=defineProps<{modelValue:ValuePreferences;catalog:Catalog|null}>();
const emit=defineEmits<{ 'update:modelValue':[ValuePreferences];reset:[] }>();
const expanded=ref(false);
const categories:[string,UiKey][]=[['all','filter.all'],['coding','filter.coding'],['webdev','filter.webdev'],['frontend','filter.frontend']];
function set<K extends keyof ValuePreferences>(key:K,value:ValuePreferences[K]){emit('update:modelValue',{...props.modelValue,[key]:value});}
const count=computed(()=>[props.modelValue.budget!==null,props.modelValue.upfrontBudget!==null,props.modelValue.providerId!==null,props.modelValue.minRank!==null,props.modelValue.profile!=='standard',!!props.modelValue.query,!props.modelValue.allowAnnual,props.modelValue.minTokensPerSecond!==null].filter(Boolean).length);
</script>
<template>
<section class="filter-band compact-filters" :aria-label="t('filter.aria')">
  <div class="primary-filters">
    <div class="preference-group" role="group" :aria-label="t('filter.preference')">
      <span class="filter-label">{{t('filter.preference')}}</span>
      <div class="preference-buttons">
        <button :class="{active:modelValue.ranking==='balanced'}" :aria-pressed="modelValue.ranking==='balanced'" @click="set('ranking','balanced')">{{t('filter.balanced')}}</button>
        <button :class="{active:modelValue.ranking==='value'}" :aria-pressed="modelValue.ranking==='value'" @click="set('ranking','value')">{{t('filter.valueOnly')}}</button>
      </div>
    </div>
    <div class="category-group" role="group" :aria-label="t('filter.category')">
      <span class="filter-label">{{t('filter.category')}}</span>
      <div class="category-buttons"><button v-for="[id,key] in categories" :key="id" :aria-pressed="modelValue.category===id" :class="{active:modelValue.category===id}" @click="set('category',id as ValuePreferences['category'])">{{t(key)}}</button></div>
    </div>
    <button class="advanced-toggle" :aria-expanded="expanded" aria-controls="extra-filters" @click="expanded=!expanded">{{t('filter.advanced')}}<span v-if="count" class="filter-count">{{count}}</span><span aria-hidden="true">{{expanded?'−':'＋'}}</span></button>
  </div>
<div v-if="expanded" id="extra-filters" class="extra-filters"><label>{{t('filter.search')}}<input type="search" :value="modelValue.query" maxlength="100" :placeholder="t('filter.searchPlaceholder')" @input="set('query',($event.target as HTMLInputElement).value)"></label><label>{{t('filter.budget')}}<input type="number" min="0" max="100000" :value="modelValue.budget" :placeholder="t('filter.any')" @input="set('budget',($event.target as HTMLInputElement).value===''?null:Number(($event.target as HTMLInputElement).value))"></label><label>{{t('filter.upfront')}}<input type="number" min="0" max="100000" :value="modelValue.upfrontBudget" :placeholder="t('filter.any')" @input="set('upfrontBudget',($event.target as HTMLInputElement).value===''?null:Number(($event.target as HTMLInputElement).value))"></label><label>{{t('filter.provider')}}<select :value="modelValue.providerId??''" @change="set('providerId',($event.target as HTMLSelectElement).value||null)"><option value="">{{t('filter.allProviders')}}</option><option v-for="p in catalog?.providers" :key="p.id" :value="p.id">{{p.name}}</option></select></label><label>{{t('filter.ability')}}<select :value="modelValue.minRank??''" @change="set('minRank',($event.target as HTMLSelectElement).value?Number(($event.target as HTMLSelectElement).value):null)"><option value="">{{t('filter.anyRank')}}</option><option :value="10">{{t('filter.top10')}}</option><option :value="20">{{t('filter.top20')}}</option><option :value="50">{{t('filter.top50')}}</option></select></label><label>{{t('filter.tokenProfile')}}<select :value="modelValue.profile" @change="set('profile',($event.target as HTMLSelectElement).value as ValuePreferences['profile'])"><option value="standard">{{t('filter.standard')}}</option><option value="cached">{{t('filter.cached')}}</option></select></label><label>{{t('filter.speed')}}<select :value="modelValue.minTokensPerSecond??''" @change="set('minTokensPerSecond',($event.target as HTMLSelectElement).value?Number(($event.target as HTMLSelectElement).value):null)"><option value="">{{t('filter.anySpeed')}}</option><option value="50">{{t('filter.speed50')}}</option><option value="100">{{t('filter.speed100')}}</option></select></label><label class="annual-control">{{t('filter.billing')}}<select :value="String(modelValue.allowAnnual)" @change="set('allowAnnual',($event.target as HTMLSelectElement).value==='true')"><option value="false">{{t('filter.monthly')}}</option><option value="true">{{t('filter.annual')}}</option></select></label><button class="reset-filter" @click="emit('reset')">{{t('filter.reset')}}</button><p class="filter-footnote">{{t('filter.footnote')}}</p></div></section></template>
