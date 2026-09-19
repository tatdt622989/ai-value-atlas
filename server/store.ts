import { MongoClient } from 'mongodb';
import { createHash, randomUUID } from 'node:crypto';
import { CatalogSchema, type Catalog } from '../shared/schema';
import {assertCatalogPreserved,type PreservationDecision} from '../shared/preservation';

export const hash = (value: unknown) => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const uid = (prefix:string) => `${prefix}-${randomUUID()}`;
export async function connectStore() {
  const uri=process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
  const name=process.env.MONGODB_DB ?? 'ai_value_atlas';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid MongoDB database name');
  const client=new MongoClient(uri,{serverSelectionTimeoutMS:5000});
  await client.connect();
  const db=client.db(name);
  await Promise.all([
    db.collection('snapshots').createIndex({version:1},{unique:true}),
    db.collection('proposals').createIndex({id:1},{unique:true}),
    db.collection('runs').createIndex({startedAt:-1}),
    db.collection('evidence').createIndex({url:1,contentHash:1}),
  ]);
  return new AtlasStore(client,name);
}
export class AtlasStore {
  db;
  constructor(public client: MongoClient, name: string) { this.db=client.db(name); }
  async catalog(): Promise<Catalog> {
    const pointer=await this.db.collection<{_id:string;version:string}>('pointers').findOne({_id:'published'});
    if (!pointer) throw new Error('Catalog is not initialized. Run pnpm atlas seed.');
    const snapshot=await this.db.collection('snapshots').findOne({version:pointer.version});
    return CatalogSchema.parse(snapshot?.catalog);
  }
  async seed(catalog: Catalog) {
    CatalogSchema.parse(catalog);
    await this.db.collection('snapshots').updateOne({version:catalog.version},{$setOnInsert:{version:catalog.version,catalog,createdAt:new Date()}},{upsert:true});
    const result=await this.db.collection<{_id:string;version:string}>('pointers').updateOne({_id:'published'},{$setOnInsert:{version:catalog.version}},{upsert:true});
    return {initialized:result.upsertedCount===1,version:(await this.catalog()).version};
  }
  async publish(catalog: Catalog, baseVersion: string, actor: string, reason: string, preservationDecisions:PreservationDecision[]=[]) {
    const current=await this.catalog();
    if(current.version!==baseVersion)throw new Error('CONFLICT: published version changed; review against current version');
    assertCatalogPreserved(current,catalog,preservationDecisions);
    const next=CatalogSchema.parse({...catalog,version:uid('v'),publishedAt:new Date().toISOString()});
    await this.db.collection('snapshots').insertOne({version:next.version,catalog:next,createdAt:new Date(),actor,reason,baseVersion,preservationDecisions});
    const changed=await this.db.collection<{_id:string;version:string}>('pointers').updateOne({_id:'published',version:baseVersion},{$set:{version:next.version}});
    if (!changed.modifiedCount) throw new Error('CONFLICT: published version changed; review against current version');
    return next;
  }
  async claimLease(key: string, minutes=15) {
    const owner=uid('lease');
    try {
      const result=await this.db.collection<{_id:string;expiresAt:Date;owner:string}>('leases').findOneAndUpdate(
        {_id:key,expiresAt:{$lt:new Date()}},{$set:{owner,expiresAt:new Date(Date.now()+minutes*60000)}},{upsert:true,returnDocument:'after'});
      return result?.owner===owner?owner:null;
    } catch (e:any) { if(e.code===11000) return null;throw e; }
  }
  async releaseLease(key:string,owner:string) {await this.db.collection('leases').updateOne({_id:key as any,owner},{$set:{expiresAt:new Date(0)}});}
  async close() {await this.client.close();}
}
