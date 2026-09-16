import {ref, watch} from 'vue';
import {uiZh, uiEn, type UiKey} from './locales/ui';
import {dataEn} from './locales/data-en';

export type Locale = 'zh' | 'en';
const STORAGE_KEY = 'atlas-locale';

function initialLocale(): Locale {
  const param = new URLSearchParams(location.search).get('lang');
  if (param === 'zh' || param === 'en') {
    localStorage.setItem(STORAGE_KEY, param);
    return param;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'zh' || stored === 'en') return stored;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const locale = ref<Locale>(initialLocale());

export function setLocale(next: Locale) {
  locale.value = next;
  localStorage.setItem(STORAGE_KEY, next);
}
export function toggleLocale() {
  setLocale(locale.value === 'zh' ? 'en' : 'zh');
}

const ui = {zh: uiZh, en: uiEn} as const;
export function t(key: UiKey, params?: Record<string, string | number>): string {
  let s: string = ui[locale.value][key] ?? ui.zh[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// Translate catalog content (canonical zh) into the active locale; falls back to zh.
export function td(s: string | null | undefined): string {
  if (!s) return '';
  return locale.value === 'en' ? dataEn[s] ?? s : s;
}

// BCP-47 tag for Intl/toLocaleString; collation tag for localeCompare.
export function dateLocale(): string {
  return locale.value === 'zh' ? 'zh-TW' : 'en-US';
}
export function collatorLocale(): string {
  return locale.value === 'zh' ? 'zh-Hant' : 'en';
}

const meta: Record<Locale, {lang: string; title: string; description: string}> = {
  zh: {lang: 'zh-Hant', title: 'Atlas — 每一美元的 AI 價值', description: '比較每美元的 AI 使用價值，保留公開費率、多來源研究、模型能力與更新紀錄。'},
  en: {lang: 'en', title: 'Atlas — AI value per dollar', description: 'Compare AI usage value per dollar, with public rates, multi-source research, model ability, and update history preserved.'},
};

watch(locale, (l) => {
  document.documentElement.lang = meta[l].lang;
  document.title = meta[l].title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta[l].description);
}, {immediate: true});
