import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MongoClient} from 'mongodb';
import {AtlasStore,uid} from '../server/store';
import {createApp} from '../server/app';
import {CatalogSchema} from '../shared/schema';
const enabled=process.env.ATLAS_INTEGRATION==='true';
test('Mongo snapshots, CAS, lease and public API work together', {skip:!enabled},async()=>{
 const client=new MongoClient(process.env.MONGODB_URI??'mongodb://127.0.0.1:27017');await client.connect();
 const name='atlas_test_'+uid('case').replaceAll('-','_');const store=new AtlasStore(client,name);
 try{
  const seed=CatalogSchema.parse(JSON.parse(fs.readFileSync('data/catalog.json','utf8')));
  // This integration case exercises publication, not the fixture's calendar date.
  for(const x of [...seed.plans,...seed.research,...seed.rateCards,...seed.offers,...seed.benchmarks])x.freshness={...x.freshness,verifiedAt:new Date(Date.now()-86400000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),effectiveFrom:null,expiresAt:null};
  await store.seed(seed);
  assert.equal((await store.seed(seed)).initialized,false);
  const first=await store.publish(seed,seed.version,'test','CAS first write');
  await assert.rejects(()=>store.publish(seed,seed.version,'test','Stale write must fail'),/CONFLICT/);
  assert.equal((await store.catalog()).version,first.version);
  const reduced=structuredClone(first);reduced.research.shift();
  await assert.rejects(()=>store.publish(reduced,first.version,'test','An unexplained reduction must fail'),/Catalog preservation failed/);
  assert.equal((await store.catalog()).version,first.version);
  const lease=await store.claimLease('test');assert.ok(lease);assert.equal(await store.claimLease('test'),null);await store.releaseLease('test',lease!);assert.ok(await store.claimLease('test'));
  const app=createApp(store);
  assert.equal((await app.request('/healthz')).status,200);
  assert.equal((await app.request('/api/admin/proposals')).status,401);
  const bad=await app.request('/api/v1/value',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"budget":-1}'});assert.equal(bad.status,400);
  const response=await app.request('/api/v1/value');assert.equal(response.status,200);const body=await response.json() as any;
  assert.ok(body.quotes.some((q:any)=>q.plan.id==='chatgpt-plus'));assert.ok(body.quotes.every((q:any)=>Number.isFinite(q.multiplier)));
  const status=await app.request('/api/v1/status');assert.equal(status.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(response.headers.get('content-security-policy'));
  const catalog=await (await app.request('/api/v1/catalog')).json() as any;assert.deepEqual(catalog.locks,[]);assert.ok(catalog.evidence.every((e:any)=>e.excerpt===''));
  const historical=structuredClone(first);historical.benchmarks[0].freshness.validUntil=new Date(Date.now()-1000).toISOString();
  await store.publish(historical,first.version,'test','Retain the original benchmark after its review deadline');
  const full=await (await app.request('/api/v1/catalog?includeExpired=true')).json() as any;
  const current=await (await app.request('/api/v1/catalog')).json() as any;
  assert.deepEqual(full.benchmarks,historical.benchmarks);
  assert.ok(!current.benchmarks.some((b:any)=>b.id===historical.benchmarks[0].id));
 }finally{await client.db(name).dropDatabase();await client.close();}
});
