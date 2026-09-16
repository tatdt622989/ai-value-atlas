import { serve } from '@hono/node-server';
import {serveStatic} from '@hono/node-server/serve-static';
import { connectStore } from './store';
import {createApp} from './app';
import {startScheduler} from './loop';
import fs from 'node:fs/promises';
import {CatalogSchema} from '../shared/schema';

const store=await connectStore();
await store.seed(CatalogSchema.parse(JSON.parse(await fs.readFile(new URL('../data/catalog.json',import.meta.url),'utf8'))));
const app=createApp(store);
app.get('/brand/*',serveStatic({root:'./dist'}));
app.get('/assets/*',serveStatic({root:'./dist'}));
app.get('/',serveStatic({path:'./dist/index.html'}));
const stopScheduler=startScheduler(store);
const server=serve({fetch:app.fetch,port:Number(process.env.PORT??4318),hostname:process.env.HOST??'127.0.0.1'},info=>console.log(`Atlas ready at http://${info.address}:${info.port}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{stopScheduler();server.close(async()=>{await store.close();process.exit(0);});});
