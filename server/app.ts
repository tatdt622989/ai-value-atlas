import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CatalogSchema,PreferencesSchema,ValuePreferencesSchema } from '../shared/schema';
import {isFresh,recommend} from '../shared/recommend';
import { type AtlasStore, uid } from './store';
import {ProposalSchema,evaluateProposal,publishProposal,editorialReview,getField} from './policy';
import {updateLoop} from './loop';
import {rankValues} from '../shared/value';
import {aiReady} from './ai';
import {assertCatalogPreserved,PreservationDecisionSchema} from '../shared/preservation';

export function createApp(store:AtlasStore) {
  const app=new Hono();
  app.use('*',secureHeaders({contentSecurityPolicy:{defaultSrc:["'self'"],scriptSrc:["'self'",'https://www.googletagmanager.com'],styleSrc:["'self'","'unsafe-inline'",'https://fonts.googleapis.com'],fontSrc:["'self'",'https://fonts.gstatic.com'],imgSrc:["'self'",'data:','https://*.google-analytics.com','https://*.googletagmanager.com'],connectSrc:["'self'",'https://*.google-analytics.com','https://*.analytics.google.com','https://*.googletagmanager.com'],frameAncestors:["'none'"],baseUri:["'self'"]},referrerPolicy:'strict-origin-when-cross-origin'}));
  const smallBody=bodyLimit({maxSize:256000,onError:c=>c.json({error:'Request too large'},413)});
  app.use('/api/*',async(c,next)=>c.req.path.startsWith('/api/admin/stages')?next():smallBody(c,next));
  app.use('/api/admin/stages',bodyLimit({maxSize:16_000_000,onError:c=>c.json({error:'Request too large'},413)}));
  app.use('/api/*',async(c,next)=>{c.header('Cache-Control','no-store');await next();});
  app.get('/healthz',async c=>{try{await store.db.command({ping:1});await store.catalog();return c.json({status:'ok'});}catch{return c.json({status:'unavailable'},503);}});
  app.get('/api/v1/catalog',async c=>{
    const cat=await store.catalog();const all=c.req.query('includeExpired')==='true';
    const plans=all?cat.plans:cat.plans.filter(p=>isFresh(p.freshness));
    const rateCards=all?cat.rateCards:cat.rateCards.filter(r=>isFresh(r.freshness));
    const offers=all?cat.offers:cat.offers.filter(o=>isFresh(o.freshness)&&plans.some(p=>p.id===o.planId)&&[o.rateCardId,o.referenceRateCardId].every(id=>rateCards.some(r=>r.id===id)));
    // Internal field-lock reasons and actor identities are editorial data.
    return c.json({...cat,locks:[],plans,rateCards,offers,research:all?cat.research:cat.research.filter(r=>isFresh(r.freshness)),benchmarks:all?cat.benchmarks:cat.benchmarks.filter(b=>isFresh(b.freshness)),evidence:cat.evidence.map(e=>({...e,excerpt:''}))});
  });
  app.get('/api/v1/benchmarks',async c=>{const cat=await store.catalog();return c.json({version:cat.version,data:cat.benchmarks.filter(b=>isFresh(b.freshness)&&(!c.req.query('category')||b.category===c.req.query('category')))});});
  app.post('/api/v1/recommend',async c=>{const parsed=PreferencesSchema.safeParse(await c.req.json());if(!parsed.success)return c.json({error:'Invalid preferences',issues:parsed.error.issues},400);return c.json(recommend(await store.catalog(),parsed.data));});
  app.post('/api/v1/value',async c=>{const parsed=ValuePreferencesSchema.safeParse(await c.req.json());if(!parsed.success)return c.json({error:'Invalid preferences',issues:parsed.error.issues},400);return c.json(rankValues(await store.catalog(),parsed.data));});
  app.get('/api/v1/value',async c=>c.json(rankValues(await store.catalog(),ValuePreferencesSchema.parse({}))));
  app.get('/api/v1/schema',c=>c.json(z.toJSONSchema(CatalogSchema)));
  app.get('/api/v1/status',async c=>{
    const [legacyCount,proposalCount,stageCount,sourceReviewCount,lastRun]=await Promise.all([
      store.db.collection('legacy_records').countDocuments({status:'pending'}),
      store.db.collection('proposals').countDocuments({status:{$in:['pending','approved']}}),
      store.db.collection('staged_catalogs').countDocuments({status:'pending'}),
      store.db.collection('source_reviews').countDocuments({status:'needs-review'}),
      store.db.collection('runs').findOne({}, {sort:{startedAt:-1},projection:{_id:0,id:1,status:1,startedAt:1,finishedAt:1,notes:1,success:1,failures:1}}),
    ]);
    return c.json({legacyCount,pendingCount:proposalCount+stageCount,proposalCount,stageCount,sourceReviewCount,lastRun,scheduleEnabled:process.env.UPDATE_SCHEDULE_ENABLED==='true',updateHourUtc:Number(process.env.UPDATE_HOUR_UTC??1),aiConfigured:aiReady(),aaConfigured:Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY),autoPublish:process.env.AUTO_PUBLISH==='true'});
  });
  app.use('/api/admin/*',async(c,next)=>{
    const expected=process.env.ADMIN_TOKEN??'',given=c.req.header('Authorization')?.replace(/^Bearer /,'')??'';
    if(expected.length<32||given.length!==expected.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(given)))return c.json({error:'Unauthorized'},401);
    await next();
  });
  app.get('/api/admin/proposals',async c=>c.json(await store.db.collection('proposals').find({status:{$ne:'published'}},{projection:{_id:0}}).limit(100).toArray()));
  app.post('/api/admin/proposals',async c=>{
    const proposal=ProposalSchema.parse(await c.req.json());
    const evaluation=evaluateProposal(await store.catalog(),proposal);
    // Proposals may be stored with unmet review requirements, but cannot bypass publication policy.
    await store.db.collection('proposals').insertOne({...proposal,status:'pending'});
    return c.json({id:proposal.id,problems:evaluation.problems,requiresHuman:evaluation.requiresHuman},201);
  });
  app.post('/api/admin/proposals/:id/publish',async c=>{
    const body=z.object({actor:z.string().min(1),manual:z.boolean(),lock:z.boolean().default(false)}).strict().parse(await c.req.json());
    return c.json(await publishProposal(store,c.req.param('id'),body.actor,body.manual,body.lock));
  });
  app.post('/api/admin/proposals/:id/review',async c=>{
    const body=z.object({actor:z.string().min(1),decision:z.enum(['approve','reject','needs-human']),reason:z.string().min(8)}).strict().parse(await c.req.json());
    return c.json(await editorialReview(store,c.req.param('id'),body.actor,body.decision,body.reason));
  });
  app.get('/api/admin/stages',async c=>c.json(await store.db.collection('staged_catalogs').find({status:'pending'},{projection:{_id:0,catalog:0}}).limit(100).toArray()));
  app.post('/api/admin/stages',async c=>{
    const body=z.object({catalog:z.unknown(),reason:z.string().min(8),preservationDecisions:z.array(PreservationDecisionSchema).default([])}).strict().parse(await c.req.json());
    const current=await store.catalog(),candidate=CatalogSchema.parse(body.catalog);
    assertCatalogPreserved(current,candidate,body.preservationDecisions);
    for(const lock of current.locks)if((!lock.expiresAt||Date.parse(lock.expiresAt)>Date.now())&&JSON.stringify(getField(current,lock.path))!==JSON.stringify(getField(candidate,lock.path)))return c.json({error:`Locked field: ${lock.path}`},409);
    candidate.locks=current.locks;
    const id=uid('stage');
    await store.db.collection('staged_catalogs').insertOne({id,baseVersion:current.version,catalog:candidate,reason:body.reason,preservationDecisions:body.preservationDecisions,status:'pending',createdAt:new Date().toISOString()});
    return c.json({id,status:'pending',plans:candidate.plans.length,benchmarks:candidate.benchmarks.length},201);
  });
  app.post('/api/admin/stages/:id/publish',async c=>{
    const body=z.object({actor:z.string().min(1)}).strict().parse(await c.req.json());
    const staged=await store.db.collection('staged_catalogs').findOne({id:c.req.param('id'),status:'pending'});
    if(!staged)return c.json({error:'Stage not found'},404);
    if(Date.now()-Date.parse(staged.createdAt)>86400000)return c.json({error:'Stage is older than 24h; re-verify'},400);
    const current=await store.catalog();
    if(current.version!==staged.baseVersion)return c.json({error:'Stage base changed; re-stage against current version'},409);
    const next=CatalogSchema.parse(staged.catalog);
    for(const lock of current.locks)if((!lock.expiresAt||Date.parse(lock.expiresAt)>Date.now())&&JSON.stringify(getField(current,lock.path))!==JSON.stringify(getField(next,lock.path)))return c.json({error:`Locked field: ${lock.path}`},409);
    next.locks=current.locks;
    const published=await store.publish(next,current.version,body.actor,staged.reason??'Manually reviewed structured benchmark import',staged.preservationDecisions??[]);
    await store.db.collection('staged_catalogs').updateOne({id:staged.id},{$set:{status:'published',publishedVersion:published.version}});
    return c.json({version:published.version});
  });
  app.post('/api/admin/update',async c=>{
    // Keep this awaited: server shutdown cannot silently abandon an untracked job.
    return c.json(await updateLoop(store,'authenticated-api'));
  });
  app.notFound(c=>c.json({error:'Not found'},404));
  app.onError((e,c)=>{
    if(e instanceof z.ZodError)return c.json({error:'Validation failed',issues:e.issues},400);
    if(e instanceof SyntaxError)return c.json({error:'Invalid JSON'},400);
    if(e.message.startsWith('Catalog preservation failed'))return c.json({error:e.message},409);
    const conflict=e.message.startsWith('CONFLICT:');
    console.error('Request failed:',e.message);
    return c.json({error:conflict?'Concurrent edit; reload and review again':'Request failed; see server log'},conflict?409:500);
  });
  return app;
}
