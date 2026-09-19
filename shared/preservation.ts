import {z} from 'zod';
import type {Catalog} from './schema';
export const PreservationDecisionSchema=z.object({path:z.string().min(3),reason:z.string().min(12),source:z.url().refine(v=>v.startsWith('https:'))}).strict();
export type PreservationDecision=z.infer<typeof PreservationDecisionSchema>;
const collections=['providers','models','plans','rateCards','offers','research','benchmarks','evidence'] as const;
export function catalogLosses(before:Catalog,after:Catalog){
 const losses:{path:string;reason:string}[]=[];
 for(const name of collections){
  const next=new Map<string,any>(after[name].map(x=>[x.id,x]));
  for(const old of before[name]){
   const current=next.get(old.id),path=`/${name}/${old.id}`;
   if(!current){losses.push({path,reason:'Existing record removed'});continue;}
   const walk=(a:any,b:any,p:string)=>{if(typeof a==='number'&&Number.isFinite(a)&&(b===null||b===undefined)){losses.push({path:p,reason:'Existing number replaced by an empty value'});return;}if(a&&typeof a==='object'&&!Array.isArray(a))for(const k of Object.keys(a))walk(a[k],b?.[k],`${p}/${k}`);};
   walk(old,current,path);
   if(name==='plans'){
    for(const id of (old as Catalog['plans'][number]).modelIds)if(!current.modelIds.includes(id))losses.push({path:`${path}/modelIds/${id}`,reason:'Existing model link removed'});
    if((old as Catalog['plans'][number]).availability==='public'&&current.availability!=='public')losses.push({path:`${path}/availability`,reason:'Public availability reduced'});
   }
   if(name==='research'){
    const study=old as Catalog['research'][number];
    for(const field of ['sourceSamples','originalCheckedAt','sourceFileHash'] as const)if(JSON.stringify(study[field])!==JSON.stringify(current[field]))losses.push({path:`${path}/${field}`,reason:'Original research provenance changed'});
    if(study.eligible&&!current.eligible)losses.push({path:`${path}/eligible`,reason:'Research removed from ranking eligibility'});
   }
  }
 }
 return losses;
}
export function assertCatalogPreserved(before:Catalog,after:Catalog,decisions:PreservationDecision[]=[]){
 const approved=z.array(PreservationDecisionSchema).parse(decisions),losses=catalogLosses(before,after);
 const missing=losses.filter(loss=>!approved.some(d=>d.path===loss.path));
 if(missing.length)throw new Error(`Catalog preservation failed; explicit per-field evidence and reason required: ${missing.map(x=>x.path).join(', ')}`);
 return losses;
}
