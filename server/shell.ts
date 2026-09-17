import {rankValues} from '../shared/value';
import {ValuePreferencesSchema} from '../shared/schema';
import type {AtlasStore} from './store';

const SITE='https://atlas.6yuwei.com';
const DESCRIPTION='比較每美元的 AI 使用價值，保留公開費率、多來源研究、模型能力與更新紀錄。';
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const money=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:2});

// Renders a crawler- and no-JS-friendly snapshot of the live ranking into the
// app mount point; Vue replaces it on mount, so what you see is what gets indexed.
export async function renderHome(store:AtlasStore,shell:string|null):Promise<string>{
  if(!shell)return '<!doctype html><meta charset="UTF-8"><title>Atlas</title>';
  try{
    const catalog=await store.catalog();
    const result=rankValues(catalog,ValuePreferencesSchema.parse({}));
    const now=Date.now();
    const items=result.quotes.filter(q=>Date.parse(q.validUntil)>now).slice(0,15).map(q=>{
      const score=q.recommendation?.score;
      const planName=q.plan.name.replace(q.provider.name,'').replace('Coding ','').trim();
      return{
        value:score===null||score===undefined?`${q.multiplier.toFixed(1)}×`:score.toFixed(1),
        name:`${q.provider.name} · ${planName||q.plan.name}`,
        model:q.model.name,
        price:q.plan.billing.interval==='once'?`$${money(q.upfrontCost)} · 一次付清`:q.monthlyCost===null?'依用量計費':`$${money(q.monthlyCost)} / 月`,
      };
    });
    const date=new Date(result.asOf).toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});
    const list=items.map(q=>`<li><strong>${q.value}</strong><span>${esc(q.name)}<small>${esc(q.model)} · ${q.price}</small></span></li>`).join('');
    const snapshot=`<div class="seo-shell"><h1>每一美元的 AI 價值排行</h1><p>${DESCRIPTION}</p><ol>${list}</ol><p class="seo-asof">資料版本 ${esc(result.version)} · ${date}</p><noscript><p>互動式比較、篩選與方案詳情需要啟用 JavaScript。</p></noscript></div>`;
    const ld={'@context':'https://schema.org','@graph':[
      {'@type':'WebSite',name:'Atlas',url:`${SITE}/`,inLanguage:['zh-Hant','en'],description:DESCRIPTION},
      {'@type':'ItemList',name:'每一美元的 AI 價值排行',itemListOrder:'https://schema.org/ItemListOrderDescending',numberOfItems:items.length,itemListElement:items.map((q,i)=>({'@type':'ListItem',position:i+1,name:`${q.name} — ${q.model}`,url:`${SITE}/?query=${encodeURIComponent(q.name.replace(/\s*·\s*/g,' '))}`}))},
    ]};
    return shell.replace('<div id="app"></div>',`<div id="app">${snapshot}</div>`).replace('</head>',`<script type="application/ld+json">${JSON.stringify(ld)}</script></head>`);
  }catch(e){
    console.error('Failed to render home snapshot:',e instanceof Error?e.message:e);
    return shell;
  }
}
