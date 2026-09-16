import fs from 'node:fs/promises';
import {z} from 'zod';
import {CatalogSchema} from '../shared/schema';
await fs.writeFile('docs/catalog.schema.json',JSON.stringify(z.toJSONSchema(CatalogSchema),null,2)+'\n');
