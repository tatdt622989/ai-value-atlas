import fs from 'node:fs/promises';
import {CatalogSchema} from '../shared/schema';
import {collectValueSources,applyValueFacts} from '../server/value-sources';
import {connectStore} from '../server/store';
const store=await connectStore();
try{
 const current=await store.catalog();const bundle=await collectValueSources();
 for(const entry of bundle.entries)await store.db.collection('evidence').insertOne({...entry.evidence,raw:entry.source.raw,runId:'initial-value-verification'});
 const next=applyValueFacts(current,bundle);
 // Existing source assertions keep their original verification dates.
 for(const plan of next.plans.filter(p=>p.kind==='api'&&p.providerId==='openai')){plan.billing.minimumPurchase=5;plan.limitations.push('新帳號預付儲值最低 USD 5；額度到期與自動充值依官方條款。');}
 for(const plan of next.plans.filter(p=>p.kind==='api'&&p.providerId==='anthropic')){plan.billing.minimumPurchase=null;plan.limitations.push('最低付款門檻尚未核實，不能保證小額預算可開始使用。');}
 const checked=CatalogSchema.parse(next);
 const published=await store.publish(checked,current.version,'initial-source-review','Add verified model-specific value offers; match official GLM rates and quota windows.');
 await fs.writeFile('data/catalog.json',JSON.stringify(published,null,2)+'\n');
 console.log(JSON.stringify({version:published.version,plans:published.plans.length,rateCards:published.rateCards.length,offers:published.offers.length,verifiedSources:bundle.entries.map(e=>e.evidence.url)},null,2));
}finally{await store.close();}
