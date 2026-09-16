import fs from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import {fetchSource} from '../server/sources';
const [input,output='data/legacy-source-audit.json']=process.argv.slice(2);
if(!input)throw new Error('Usage: node --import tsx scripts/audit-legacy.ts <legacy.html> [output.json]');
const raw=await fs.readFile(input,'utf8');const match=raw.match(/<script\s+id="data"\s+type="application\/json">([\s\S]*?)<\/script>/);if(!match)throw new Error('Legacy JSON not found');
const legacy=JSON.parse(match[1]);const urls=[...new Set(Object.values(legacy.sources) as string[])];
const allowedHosts=new Set(urls.map(url=>new URL(url).hostname));
const results:any[]=[];
for(let i=0;i<urls.length;i+=5){
 const batch=await Promise.allSettled(urls.slice(i,i+5).map(async url=>{
  const parsed=new URL(url);const ips=await lookup(parsed.hostname,{all:true});
  if(ips.some(({address})=>/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80)/i.test(address)))throw new Error('Private address forbidden');
  const source=await fetchSource(url,allowedHosts);
  const related=legacy.plans.filter((p:any)=>[...(p.source_urls??[]),p.url,...(p.sources??[])].includes(url));
  return {url,status:'reachable-unreviewed',fetchedAt:source.fetchedAt,hash:source.contentHash,relatedPlanIds:related.map((p:any)=>p.id),notes:'Source reachable. Prices, units, eligibility and time windows still require claim-level review; reachability is not verification.'};
 }));
 batch.forEach((r,j)=>results.push(r.status==='fulfilled'?r.value:{url:urls[i+j],status:'unavailable',error:r.reason?.message??String(r.reason),notes:'Do not refresh source freshness or publish legacy claims.'}));
 console.log(`Checked ${Math.min(i+5,urls.length)}/${urls.length} source URLs`);
}
await fs.writeFile(output,JSON.stringify({checkedAt:new Date().toISOString(),sourceSnapshot:legacy.checked_at,totalSources:urls.length,counts:{reachable:results.filter(r=>r.status==='reachable-unreviewed').length,unavailable:results.filter(r=>r.status==='unavailable').length},results},null,2));
console.log(`Saved ${output}`);
