import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CatalogSchema} from '../shared/schema';
import {applyValueFacts} from '../server/value-sources';

test('price refresh preserves separately reviewed Go offers and does not resurrect removed models',()=>{
 const current=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8')));
 current.models=current.models.filter(m=>m.id!=='glm51');
 current.plans=current.plans.filter(p=>!p.modelIds.includes('glm51')||p.id==='opencode-go');
 current.benchmarks=current.benchmarks.filter(b=>b.modelId!=='glm51');
 current.offers=current.offers.filter(o=>o.modelId!=='glm51');
 current.rateCards=current.rateCards.filter(r=>r.modelId!=='glm51');
 current.research=current.research.filter(r=>r.modelId!=='glm51');
 const go=current.plans.find(p=>p.id==='opencode-go')!;
 go.modelIds=[...go.modelIds.filter(id=>id!=='glm51'),'astra'];
 const base=current.offers.find(o=>o.id==='go-glm53')!;
 current.rateCards.push({...structuredClone(current.rateCards.find(r=>r.id===base.rateCardId)!),id:'go-astra-rate',modelId:'astra'});
 current.rateCards.push({...structuredClone(current.rateCards.find(r=>r.id===base.referenceRateCardId)!),id:'astra-reference-rate',modelId:'astra'});
 const extra={...structuredClone(base),id:'go-extra-reviewed',modelId:'astra',rateCardId:'go-astra-rate',referenceRateCardId:'astra-reference-rate'};
 current.offers.push(extra);
 const evidence=current.evidence[0];
 const bundle:any={entries:['zai','reference','go'].map(key=>({key,evidence})),facts:{liteMonthly:18,goMonthly:10,fiveHour:2000,weekly:10000,charges:{'GLM-5.3':{input:690,output:2400,cached:170},'GLM-5.3-Flash':{input:230,output:800,cached:56}},models:[['glm53','GLM-5.3'],['glm52','GLM-5.2'],['glmflash','GLM-5.3-Flash'],['glm51','GLM-5.1']].map(([id,name])=>({id,name,reference:{input:1.4,output:4.4,cached:.26},go:{input:1.4,output:4.4,cached:.26,monthly:60}}))}};
 // Use distinct evidence IDs, as a real collection run does.
 bundle.entries.forEach((entry:any,i:number)=>entry.evidence={...evidence,id:`refresh-evidence-${i}`});
 CatalogSchema.parse(current);
 const updated=applyValueFacts(current,bundle);
 assert(updated.plans.find(p=>p.id==='opencode-go')!.modelIds.includes('astra'));
 assert.deepEqual(updated.offers.find(o=>o.id===extra.id),extra);
 assert(!updated.models.some(m=>m.id==='glm51'));
 assert(!updated.plans.some(p=>p.id==='official-glm51'));
 assert(!updated.offers.some(o=>o.modelId==='glm51'));
 CatalogSchema.parse(updated);
});
