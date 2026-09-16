import fs from 'node:fs/promises';
import {connectStore,hash,uid} from './store';
import {CatalogSchema} from '../shared/schema';
import {ProposalSchema,evaluateProposal,publishProposal,getField,editorialReview} from './policy';
import {updateLoop} from './loop';

const [command,...args]=process.argv.slice(2);
if(!command||command==='help'){
  console.log('atlas seed | status | export <file> | import-legacy <html> | update | proposals | source-reviews | discoveries | stages | show-stage <id> <file> | submit <proposal.json> | check <id> | publish <id> --actor <name> --manual [--lock] | stage <catalog.json> --reason <text> | publish-stage <id> --actor <name> | unlock <path> --reason <text> --actor <name> | rollback <version> --reason <text> --actor <name>');
  process.exit(0);
}
const option=(key:string)=>{const i=args.indexOf(key);return i>=0?args[i+1]:undefined;};
const actor=option('--actor');const reason=option('--reason');
const store=await connectStore();
try {
  let result:unknown;
  switch(command){
    case 'seed': result=await store.seed(CatalogSchema.parse(JSON.parse(await fs.readFile(new URL('../data/catalog.json',import.meta.url),'utf8'))));break;
    case 'status':{const cat=await store.catalog();result={version:cat.version,plans:cat.plans.length,benchmarks:cat.benchmarks.length,locks:cat.locks,lastRun:await store.db.collection('runs').findOne({}, {sort:{startedAt:-1},projection:{_id:0}})};break;}
    case 'export':await fs.writeFile(args[0],JSON.stringify(await store.catalog(),null,2));result={path:args[0]};break;
    case 'import-legacy':{
      const text=await fs.readFile(args[0],'utf8');const match=text.match(/<script\s+id="data"\s+type="application\/json">([\s\S]*?)<\/script>/);if(!match)throw new Error('Embedded JSON not found');
      const data=JSON.parse(match[1]);const checksum=hash(text);let count=0;
      for(const type of ['plans','subscriptions','offers','models'])for(const record of data[type]??[]){await store.db.collection('legacy_records').updateOne({importHash:checksum,type,legacyId:record.id},{$setOnInsert:{importHash:checksum,type,legacyId:record.id,status:'pending',raw:record,importedAt:new Date().toISOString(),reason:'Imported source assertions are unverified; computed scores and estimated quotas are not published.'}},{upsert:true});count++;}
      result={count,importHash:checksum,status:'pending',published:false};break;
    }
    case 'update':result=await updateLoop(store);break;
    case 'proposals':result=await store.db.collection('proposals').find({status:{$ne:'published'}},{projection:{_id:0}}).limit(100).toArray();break;
    case 'source-reviews':result=await store.db.collection('source_reviews').find({status:'needs-review'},{projection:{_id:0}}).sort({createdAt:-1}).limit(100).toArray();break;
    case 'discoveries':result=await store.db.collection('discoveries').find({},{projection:{_id:0}}).sort({createdAt:-1}).limit(50).toArray();break;
    case 'stages':result=await store.db.collection('staged_catalogs').find({status:'pending'},{projection:{_id:0,catalog:0}}).limit(100).toArray();break;
    case 'show-stage':{const stage=await store.db.collection('staged_catalogs').findOne({id:args[0]},{projection:{_id:0}});if(!stage)throw new Error('Stage not found');if(args[1])await fs.writeFile(args[1],JSON.stringify(stage,null,2));result=args[1]?{path:args[1]}:stage;break;}
    case 'submit':{
      const p=ProposalSchema.parse(JSON.parse(await fs.readFile(args[0],'utf8')));const verdict=evaluateProposal(await store.catalog(),p);await store.db.collection('proposals').insertOne(p);result={id:p.id,canPublish:verdict.canPublish,problems:verdict.problems,requiresHuman:verdict.requiresHuman};break;
    }
    case 'check':{const doc=await store.db.collection('proposals').findOne({id:args[0]});if(!doc)throw new Error('Proposal not found');const {_id,...p}=doc;const r=evaluateProposal(await store.catalog(),p);result={id:p.id,canPublish:r.canPublish,problems:r.problems,requiresHuman:r.requiresHuman};break;}
    case 'publish':if(!actor)throw new Error('--actor required');result=await publishProposal(store,args[0],actor,args.includes('--manual'),args.includes('--lock'));break;
    case 'review':{
      const decision=option('--decision');
      if(!actor||!reason||reason.length<8||!['approve','reject','needs-human'].includes(decision??''))throw new Error('--actor, --reason and --decision approve|reject|needs-human required');
      result=await editorialReview(store,args[0],actor,decision as 'approve'|'reject'|'needs-human',reason);break;
    }
    case 'stage':{
      if(!reason||reason.length<8)throw new Error('--reason with 8+ characters required');
      const current=await store.catalog(),candidate=CatalogSchema.parse(JSON.parse(await fs.readFile(args[0],'utf8')));
      for(const lock of current.locks)if((!lock.expiresAt||Date.parse(lock.expiresAt)>Date.now())&&JSON.stringify(getField(current,lock.path))!==JSON.stringify(getField(candidate,lock.path)))throw new Error(`Locked field: ${lock.path}`);
      candidate.locks=current.locks;
      const id=uid('stage');await store.db.collection('staged_catalogs').insertOne({id,baseVersion:current.version,catalog:candidate,reason,status:'pending',createdAt:new Date().toISOString()});result={id,status:'pending',plans:candidate.plans.length,benchmarks:candidate.benchmarks.length};break;
    }
    case 'publish-stage':{
      if(!actor)throw new Error('--actor required');const staged=await store.db.collection('staged_catalogs').findOne({id:args[0],status:'pending'});if(!staged)throw new Error('Stage not found');
      if(Date.now()-Date.parse(staged.createdAt)>86400000)throw new Error('Stage is older than 24h; re-verify');
      const current=await store.catalog();if(current.version!==staged.baseVersion)throw new Error('CONFLICT: stage base changed');
      const next=CatalogSchema.parse(staged.catalog);
      for(const lock of current.locks)if((!lock.expiresAt||Date.parse(lock.expiresAt)>Date.now())&&JSON.stringify(getField(current,lock.path))!==JSON.stringify(getField(next,lock.path)))throw new Error(`Locked field: ${lock.path}`);
      next.locks=current.locks;
      const published=await store.publish(next,current.version,actor,staged.reason??'Manually reviewed structured benchmark import');
      await store.db.collection('staged_catalogs').updateOne({id:args[0]},{$set:{status:'published',publishedVersion:published.version}});result={version:published.version};break;
    }
    case 'unlock':{
      if(!actor||!reason||reason.length<8)throw new Error('--actor and --reason required');const current=await store.catalog();
      const next={...current,locks:current.locks.filter(l=>l.path!==args[0])};if(next.locks.length===current.locks.length)throw new Error('Lock not found');result={version:(await store.publish(next,current.version,actor,`Unlock ${args[0]}: ${reason}`)).version};break;
    }
    case 'rollback':{
      if(!actor||!reason||reason.length<8)throw new Error('--actor and --reason required');const doc=await store.db.collection('snapshots').findOne({version:args[0]});if(!doc)throw new Error('Version not found');const current=await store.catalog();
      // Dates are preserved: restoring a snapshot cannot make expired facts fresh.
      const restored=CatalogSchema.parse(doc.catalog);
      for(const lock of current.locks)if((!lock.expiresAt||Date.parse(lock.expiresAt)>Date.now())&&JSON.stringify(getField(current,lock.path))!==JSON.stringify(getField(restored,lock.path)))throw new Error(`Rollback would change locked field: ${lock.path}`);
      restored.locks=current.locks;
      result={version:(await store.publish(restored,current.version,actor,`Rollback: ${reason}`)).version};break;
    }
    default:throw new Error(`Unknown command: ${command}`);
  }
  console.log(JSON.stringify(result,null,2));
}catch(e){console.error((e as Error).message);process.exitCode=1;}finally{await store.close();}
