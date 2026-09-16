import fs from 'node:fs/promises';
import {connectStore} from '../server/store';
import {getField} from '../server/policy';
const store=await connectStore();try{
 const current=await store.catalog(),next=structuredClone(current);
 const go=next.plans.find(p=>p.id==='opencode-go')!;go.billing.upfront=go.billing.amount;go.billing.renewalAmount=go.billing.amount;
 for(const p of next.plans.filter(p=>p.id.startsWith('official-')))p.billing.renewalAmount=null;
 for(const l of current.locks)if((!l.expiresAt||Date.parse(l.expiresAt)>Date.now())&&JSON.stringify(getField(current,l.path))!==JSON.stringify(getField(next,l.path)))throw new Error(`Locked ${l.path}`);
 const published=await store.publish(next,current.version,'implementation-fix','Fix copied Z.ai upfront/renewal fields on OpenCode Go; preserve actual researched $10 price and all source dates. API has no subscription renewal.');
 await fs.writeFile('data/catalog.json',JSON.stringify(published,null,2)+'\n');console.log({version:published.version,goUpfront:go.billing.upfront});
}finally{await store.close();}
