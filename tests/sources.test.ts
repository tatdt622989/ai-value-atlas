import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {CatalogSchema} from '../shared/schema';import {parseArena,parseArtificialAnalysis,fetchSource} from '../server/sources';
const cat=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8')));
const ev=cat.evidence.find(e=>e.id==='arena-20260910')!;
const table=(date='Sep 8, 2026')=>`<body><h1>Code Arena | WebDev Overall</h1><p>${date}</p><table><thead><tr><th>Rank Score Votes</th></tr></thead><tbody>${[['gpt-6-astra-max',1796],['claude-fable-5.1-max',1764]].map(([name,score],i)=>`<tr><td>${i+1}</td><td>1 2</td><td><a>${name}</a></td><td>${score}+19/-19</td><td>1,810</td><td>$10 / $50</td><td>1M</td></tr>`).join('')}</tbody></table></body>`;
test('Arena preserves exact variants, confidence and date',()=>{const r=parseArena(table(),cat,ev);assert.equal(r.benchmarks[0].score,1796);assert.equal(r.benchmarks[0].confidenceLow,1777);assert.equal(r.benchmarks[0].variant,'gpt-6-astra-max');});
test('stale Arena or changed markup fails without freshness refresh',()=>{
 assert.throws(()=>parseArena(table('Aug 1, 2026'),cat,ev),/stale/);assert.throws(()=>parseArena('<div>blocked</div>',cat,ev),/schema changed/);
});
test('AA free endpoint schema handles null scores without inventing them',()=>{
 const current=structuredClone(cat);current.models[0].aliases.push('aa:astra');
 const result=parseArtificialAnalysis({intelligence_index_version:4.3,pagination:{page:1,total_pages:1,has_more:false},data:[{id:'x',slug:'astra',name:'Astra (max)',evaluations:{artificial_analysis_intelligence_index:71,artificial_analysis_coding_index:null},performance:{median_output_tokens_per_second:100}}]},current,ev);
 assert.equal(result.benchmarks.length,1);assert.equal(result.benchmarks[0].benchmarkVersion,'v4.3');assert.equal(result.benchmarks[0].category,'general');
});
test('unapproved origins cannot be fetched by data-update proposals',async()=>{
 await assert.rejects(fetchSource('http://127.0.0.1:27017',new Set(['127.0.0.1'])),/approved HTTPS/);
 await assert.rejects(fetchSource('https://example.com',new Set(['arena.ai'])),/approved HTTPS/);
});
test('Frontend adapter rejects an Overall page instead of relabeling it',()=>{
 assert.throws(()=>parseArena(table().replace('<body>','<body><h1>Code Arena | WebDev Overall</h1>'),cat,ev,'frontend'),/category mismatch/);
 const r=parseArena(table().replace('<body>','<body><h1>Code Arena | WebDev Frontend</h1>'),cat,ev,'frontend');
 assert.ok(r.benchmarks.every(b=>b.category==='frontend'));assert.equal(r.benchmarks[0].cohortSize,2);
});
test('Arena keeps mapped models beyond rank 20',()=>{
 const rows:[string,number][]=[['gpt-6-astra-max',1796],['claude-fable-5.1-max',1764]];
 for(let i=0;i<18;i++)rows.push([`unknown-${i}`,1600-i]);rows.push(['glm-5.1',1400]);
 const raw=`<body><h1>Code Arena | WebDev Overall</h1><p>Sep 8, 2026</p><table><thead><tr><th>Rank Score Votes</th></tr></thead><tbody>${rows.map(([name,score],i)=>`<tr><td>${i+1}</td><td>1 2</td><td><a>${name}</a></td><td>${score}+19/-19</td><td>1,810</td><td>$10 / $50</td><td>1M</td></tr>`).join('')}</tbody></table></body>`;
 const r=parseArena(raw,cat,ev);assert.equal(r.benchmarks.length,3);assert.deepEqual(r.belowCutoff,[]);assert.equal(r.benchmarks.find(b=>b.modelId==='glm51')?.rank,21);assert.equal(r.benchmarks[0].cohortSize,21);
});
test('AA keeps exact mappings beyond rank 20',()=>{
 const current=structuredClone(cat);current.models.find(m=>m.id==='glm51')!.aliases.push('aa:low-scorer');current.models.find(m=>m.id==='glm52')!.aliases.push('aa:top-0');
 const data=[{id:'low',slug:'low-scorer',name:'Low Scorer',evaluations:{artificial_analysis_intelligence_index:1,artificial_analysis_coding_index:1},performance:{median_output_tokens_per_second:10}},
  ...Array.from({length:20},(_,i)=>({id:'m'+i,slug:'top-'+i,name:`Top ${i}`,evaluations:{artificial_analysis_intelligence_index:90-i,artificial_analysis_coding_index:90-i},performance:{median_output_tokens_per_second:50}}))];
 const r=parseArtificialAnalysis({intelligence_index_version:4.3,pagination:{page:1,total_pages:1,has_more:false},data},current,ev);
 assert.equal(r.benchmarks.length,4);assert.ok(r.benchmarks.some(b=>b.modelId==='glm51'));assert.equal(r.unmatched.length,19);
});
test('Agent Code extracts primary rank separately from rank range and exact variant',()=>{
 const current=structuredClone(cat);current.models.find(m=>m.id==='astra')!.aliases.push('arena-agent:GPT 6 Astra (Max)');current.models.find(m=>m.id==='fable51')!.aliases.push('arena-agent:Claude Fable 5.1 (Max)');
 const raw='<body><h1>Agent Arena Code</h1><p>Sep 8, 2026</p><table><thead><tr><th>Rank Model Net Improvement Sessions</th></tr></thead><tbody>'+['Claude Fable 5.1 (Max)','GPT 6 Astra (Max)'].map((name,i)=>`<tr><td><span>${i+1}</span><div><span>1</span><span>2</span></div></td><td><a>${name}</a></td><td>${17-i}%±2.5%</td>${'<td>0%</td>'.repeat(5)}<td>3,785</td><td>$11</td><td>158K</td><td>$10/$50</td></tr>`).join('')+'</tbody></table></body>';
 const r=parseArena(raw,current,ev,'coding');assert.equal(r.benchmarks[0].rank,1);assert.equal(r.benchmarks[1].rank,2);assert.equal(r.benchmarks[0].rankHigh,2);assert.equal(r.benchmarks[0].score,17);assert.equal(r.benchmarks[0].confidenceLow,14.5);
});

test('an explicitly retained published snapshot preserves its measurement date and stays pending',()=>{
 const evidence={...ev,fetchedAt:'2026-09-20T08:00:00Z'};
 const result=parseArena(table(),cat,evidence,'webdev',{retainPublishedSnapshot:true});
 assert.equal(result.benchmarks[0].measuredAt,'2026-09-08T00:00:00.000Z');
 assert.equal(result.benchmarks[0].freshness.status,'pending');
});
