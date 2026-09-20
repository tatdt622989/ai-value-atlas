import { load } from 'cheerio';
import { z } from 'zod';
import { type Catalog, type Evidence, type Benchmark, BenchmarkSchema } from '../shared/schema';
import { hash, uid } from './store';

export const ARENA_URL='https://arena.ai/leaderboard/code/webdev';
export const ARENA_SOURCES={webdev:ARENA_URL,frontend:'https://arena.ai/leaderboard/code/webdev/frontend',coding:'https://arena.ai/leaderboard/agent/code',general:'https://arena.ai/leaderboard/agent/'} as const;
export const AA_URL='https://artificialanalysis.ai/api/v2/language/models/free';
export async function fetchSource(url:string,allowedHosts:Set<string>,headers:Record<string,string>={}) {
  let target=new URL(url);
  for(let hop=0;hop<4;hop++) {
    if(target.protocol!=='https:' || target.username || target.password || (target.port&&target.port!=='443') || !allowedHosts.has(target.hostname)) throw new Error('Source URL is outside the approved HTTPS registry');
    const res=await fetch(target,{headers:{'User-Agent':'AtlasEvidenceBot/0.1 (+source verification; daily)',...headers},redirect:'manual',signal:AbortSignal.timeout(20000)});
    if(res.status>=300&&res.status<400&&res.headers.get('location')) {target=new URL(res.headers.get('location')!,target);continue;}
    if(!res.ok) throw new Error(`Source HTTP ${res.status}`);
    const reader=res.body?.getReader();if(!reader) throw new Error('Empty source response');
    let bytes=0;const chunks:Uint8Array[]=[];
    while(true) {const {value,done}=await reader.read();if(done) break;bytes+=value.length;if(bytes>3000000){await reader.cancel();throw new Error('Source exceeds size limit');}chunks.push(value);}
    const raw=Buffer.concat(chunks).toString('utf8');
    const $=load(raw);$('script,style,nav,footer,noscript,header').remove();
    const text=$('main').length?$('main').text():$('body').text();
    return {url:target.href,raw,text:text.replace(/\s+/g,' ').trim(),contentHash:hash(raw),fetchedAt:new Date().toISOString(),lastModified:res.headers.get('last-modified')};
  }
  throw new Error('Too many redirects');
}
export function makeEvidence(source:Awaited<ReturnType<typeof fetchSource>>,meta:Pick<Evidence,'title'|'publisher'|'kind'>):Evidence {
  return {...meta,id:uid('e'),url:source.url,fetchedAt:source.fetchedAt,sourceUpdatedAt:source.lastModified&&Number.isFinite(Date.parse(source.lastModified))?new Date(source.lastModified).toISOString():null,contentHash:source.contentHash,excerpt:source.text.slice(0,16000),method:'http'};
}
export function parseArena(raw:string,catalog:Catalog,evidence:Evidence,category:keyof typeof ARENA_SOURCES='webdev',options:{retainPublishedSnapshot?:boolean}={}) {
  const $=load(raw),agent=category==='coding'||category==='general';
  const headers=$('thead').first().text(),heading=$('h1').first().text();
  if(agent?(!headers.includes('Net Improvement')||!headers.includes('Sessions')):(!headers.includes('Rank')||!headers.includes('Score')||!headers.includes('Votes')))throw new Error('Arena table schema changed');
  // Verify the selected board; redirects to Overall must not masquerade as Frontend.
  if(!(category==='frontend'?heading.includes('Frontend'):category==='webdev'?heading.includes('WebDev')&&heading.includes('Overall'):category==='coding'?heading.includes('Agent')&&heading.includes('Code'):heading.includes('Agent')&&heading.includes('Overall')))throw new Error('Arena category mismatch');
  const date=$('body').text().match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}/)?.[0];
  if(!date)throw new Error('Arena publication date missing');
  const measuredAt=new Date(`${date} 00:00:00 UTC`).toISOString();
  const aged=Date.parse(evidence.fetchedAt)-Date.parse(measuredAt)>7*86400000;
  if(Date.parse(measuredAt)>Date.parse(evidence.fetchedAt)||aged&&!options.retainPublishedSnapshot)throw new Error('Arena source snapshot is stale or future-dated');
  const parsed:Benchmark[]=[],unmatched:string[]=[],belowCutoff:string[]=[];
  const rows=$('tbody tr');
  const rankOf=(cells:ReturnType<typeof $>)=>Number(agent?cells.eq(0).find('span').first().text():cells.eq(0).text());
  const ranks=rows.map((_,row)=>rankOf($(row).find('td'))).get().filter(n=>Number.isInteger(n)&&n>0);
  if(!ranks.length)throw new Error('Arena rank data missing');
  const cohortSize=Math.max(...ranks);
  rows.each((_,row)=>{
    const cells=$(row).find('td');if(cells.length!==(agent?12:7))throw new Error('Arena row shape changed');
    const variant=cells.eq(agent?1:2).find('a').first().text().trim();
    const rank=rankOf(cells);if(!Number.isInteger(rank)||rank<=0){unmatched.push(variant+' [unranked]');return;}
    const alias=agent?`arena-agent:${variant}`:variant;
    const matches=catalog.models.filter(m=>!agent&&m.aliases.some(a=>a.startsWith('arena-webdev:'))?m.aliases.includes(`arena-webdev:${variant}`):m.aliases.includes(alias));
    if(matches.length>1)throw new Error('Ambiguous Arena aliases');
    const model=matches[0];if(!model){unmatched.push(variant);return;}
    const scoreText=cells.eq(agent?2:3).text();
    const match=agent?scoreText.match(/^(-?\d+(?:\.\d+)?)%±(\d+(?:\.\d+)?)%/):scoreText.match(/^(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)\/-(\d+(?:\.\d+)?)/);
    if(!match)throw new Error(`Arena score shape changed: ${variant}`);
    const score=Number(match[1]);
    const spread=(agent?cells.eq(0).find('span').slice(1):cells.eq(1).find('span')).map((_,e)=>Number($(e).text())).get();
    const [rankLow,rankHigh]=spread.length===2&&spread.every(n=>Number.isInteger(n)&&n>0)?spread:[null,null];
    parsed.push(BenchmarkSchema.parse({id:`arena-${category}-${model.id}`,modelId:model.id,source:'arena',category,
      benchmarkName:agent?`Agent Arena ${category==='coding'?'Code':'Overall'}`:`Code Arena WebDev ${category==='frontend'?'Frontend':'Overall'}`,
      benchmarkVersion:agent?`agent-${category}-net-improvement`:`webdev-${category==='frontend'?'frontend':'overall'}`,variant,
      harness:agent?'arena-agent':variant.includes('codex-harness')?'codex-harness':'arena-webdev',score,rank,cohortSize,rankLow,rankHigh,
      sampleSize:Number(cells.eq(agent?8:4).text().replaceAll(',','')),confidenceLow:score-Number(agent?match[2]:match[3]),confidenceHigh:score+Number(match[2]),outputTokensPerSecond:null,measuredAt,
      freshness:{verifiedAt:evidence.fetchedAt,validUntil:new Date(aged?Date.parse(evidence.fetchedAt)+86400000:Math.min(Date.parse(evidence.fetchedAt)+7*86400000,Date.parse(measuredAt)+7*86400000)).toISOString(),effectiveFrom:null,expiresAt:null,evidenceIds:[evidence.id],status:aged?'pending':'verified'}}));
  });
  if(parsed.length<2)throw new Error('Arena returned insufficient mapped rows');
  if(new Set(parsed.map(x=>x.id)).size!==parsed.length)throw new Error('Ambiguous Arena aliases');
  return {benchmarks:parsed,unmatched,belowCutoff};
}
const AAEnvelope=z.object({intelligence_index_version:z.number(),pagination:z.object({page:z.number(),total_pages:z.number(),has_more:z.boolean()}),data:z.array(z.object({id:z.string(),name:z.string(),slug:z.string(),evaluations:z.object({artificial_analysis_intelligence_index:z.number().nullable(),artificial_analysis_coding_index:z.number().nullable()}),performance:z.object({median_output_tokens_per_second:z.number().nullable()})}))});
export function parseArtificialAnalysis(body:unknown,catalog:Catalog,evidence:Evidence) {
  const parsed=AAEnvelope.parse(body),benchmarks:Benchmark[]=[];
  const unmatched=new Set<string>();
  // Keep every exact model mapping; rank must not determine data coverage.
  for(const [category,key] of [['coding','artificial_analysis_coding_index'],['general','artificial_analysis_intelligence_index']] as const) {
    const ranked=parsed.data.filter(m=>m.evaluations[key]!==null).sort((a,b)=>b.evaluations[key]!-a.evaluations[key]!);
    for(const m of ranked) {
      const model=catalog.models.find(x=>x.aliases.includes(`aa:${m.slug}`));
      if(!model){unmatched.add(m.slug);continue;}
      benchmarks.push(BenchmarkSchema.parse({id:`aa-${category}-${model.id}`,modelId:model.id,source:'artificial-analysis',category,benchmarkName:key,benchmarkVersion:`v${parsed.intelligence_index_version}`,variant:m.name,harness:'artificial-analysis',score:m.evaluations[key]!,rank:null,sampleSize:null,confidenceLow:null,confidenceHigh:null,outputTokensPerSecond:m.performance.median_output_tokens_per_second,measuredAt:evidence.fetchedAt,freshness:{verifiedAt:evidence.fetchedAt,validUntil:new Date(Date.parse(evidence.fetchedAt)+7*86400000).toISOString(),effectiveFrom:null,expiresAt:null,evidenceIds:[evidence.id],status:'verified'}}));
    }
  }
  return {benchmarks,unmatched:[...unmatched],pagination:parsed.pagination};
}
