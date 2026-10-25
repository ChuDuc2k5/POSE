// M07 audience SQL checks. Run from frontend/ with:
// $env:PGLITE_PATH='C:/Users/Admin/AppData/Local/Temp/pose-m06-pg/node_modules/@electric-sql/pglite'
// node scripts/test-campaign-audience-sql.mjs
import { readFile } from 'node:fs/promises';
import { createCampaignDatabase } from './campaign-test-db.mjs';
const db=await createCampaignDatabase();
try {
  await db.exec(await readFile(new URL('../../supabase/campaign-audience.sql',import.meta.url),'utf8'));
  const base=await readFile(new URL('../../supabase/test-campaign-management.sql',import.meta.url),'utf8');
  await db.exec(base.slice(base.indexOf('-- Fixtures begin'),base.indexOf('-- Fixtures end.')+17));
  await db.exec(await readFile(new URL('../../supabase/test-campaign-audience.sql',import.meta.url),'utf8'));
  console.log('PASS: M07 audience score, inquiry bridge, contact settings, filters and frozen snapshot checks.');
} catch(error) { console.error(`FAIL: M07 audience SQL: ${error.message}`); process.exitCode=1; }
finally { await db.close(); }
