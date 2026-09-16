// Fetches provider icons from official sites into public/brand/providers/ and
// writes src/provider-icons.ts. Re-run when catalog providers change.
import fs from 'node:fs/promises';
import {load} from 'cheerio';
import {connectStore} from '../server/store';

const UA={'User-Agent':'AtlasIconBot/0.1 (+provider icons; local build)'};
const DIR='public/brand/providers';

async function get(url:string){
  const res=await fetch(url,{headers:UA,redirect:'follow',signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return res;
}
function extOf(contentType:string|null,href:string){
  const ct=(contentType??'').toLowerCase();
  if(ct.includes('svg')||href.endsWith('.svg'))return 'svg';
  if(ct.includes('icon')||href.endsWith('.ico'))return 'ico';
  if(ct.includes('webp')||href.endsWith('.webp'))return 'webp';
  if(ct.includes('jpeg')||ct.includes('jpg')||/\.jpe?g$/.test(href))return 'jpg';
  return 'png';
}
async function findIcon(site:string){
  const notes:string[]=[];
  try{
    const res=await get(site);
    const html=await res.text();
    const $=load(html);
    const candidates:{href:string;score:number}[]=[];
    $('link[rel]').each((_,el)=>{
      const rel=($(el).attr('rel')??'').toLowerCase(),href=$(el).attr('href');
      if(!rel.includes('icon')||!href)return;
      const sizes=($(el).attr('sizes')??'').split('x').map(Number).filter(Number.isFinite);
      let score=sizes.length?Math.max(...sizes):32;
      if(rel.includes('apple-touch-icon'))score=Math.max(score,160);
      if(href.endsWith('.svg'))score=Math.max(score,200);
      candidates.push({href:new URL(href,res.url).href,score});
    });
    candidates.sort((a,b)=>b.score-a.score);
    for(const c of candidates.slice(0,4)){
      try{
        const r=await get(c.href);const buf=Buffer.from(await r.arrayBuffer());
        if(buf.length<50||buf.length>500000)continue;
        return {buf,ext:extOf(r.headers.get('content-type'),c.href),via:c.href};
      }catch(e){notes.push(`${c.href}: ${(e as Error).message}`);}
    }
  }catch(e){notes.push(`${site}: ${(e as Error).message}`);}
  try{
    const u=new URL(site);
    const r=await get(`${u.protocol}//${u.host}/favicon.ico`);
    const buf=Buffer.from(await r.arrayBuffer());
    if(buf.length>50)return {buf,ext:'ico',via:'favicon.ico'};
  }catch{notes.push('favicon.ico failed');}
  const host=new URL(site).hostname;
  const r=await get(`https://www.google.com/s2/favicons?domain=${host}&sz=128`);
  return {buf:Buffer.from(await r.arrayBuffer()),ext:'png',via:'s2',notes};
}
const store=await connectStore();
try{
  const catalog=await store.catalog();
  const used=new Set<string>();
  for(const o of catalog.offers)used.add(catalog.plans.find(p=>p.id===o.planId)!.providerId);
  for(const r of catalog.research)used.add(catalog.plans.find(p=>p.id===r.planId)!.providerId);
  await fs.mkdir(DIR,{recursive:true});
  const manifest:Record<string,string>={};
  const hostFiles=new Map<string,string>();
  const failures:{id:string;site:string;error:string}[]=[];
  for(const p of catalog.providers){
    if(!used.has(p.id))continue;
    const host=new URL(p.website).hostname;
    try{
      if(!hostFiles.has(host)){
        const icon=await findIcon(p.website);
        const file=`${host.replace(/[^a-z0-9.-]/g,'-')}.${icon.ext}`;
        await fs.writeFile(`${DIR}/${file}`,icon.buf);
        hostFiles.set(host,file);
        console.log(`${host} -> ${file} (${icon.buf.length}b via ${icon.via}${icon.notes?.length?`; ${icon.notes[0]}`:''})`);
      }
      manifest[p.id]=`/brand/providers/${hostFiles.get(host)}`;
    }catch(e){failures.push({id:p.id,site:p.website,error:(e as Error).message});}
  }
  const ts=`export const providerIcons:Record<string,string>=${JSON.stringify(manifest,null,2)};\n`;
  await fs.writeFile('src/provider-icons.ts',ts);
  console.log(JSON.stringify({icons:Object.keys(manifest).length,failures},null,2));
}finally{await store.close();}
