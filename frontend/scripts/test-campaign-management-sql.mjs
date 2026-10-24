// From frontend/: set PGLITE_PATH to an external @electric-sql/pglite directory;
// node scripts/test-campaign-management-sql.mjs (no build/server needed).
// PowerShell: $env:PGLITE_PATH='C:/Users/Admin/AppData/Local/Temp/pose-m06-pg/node_modules/@electric-sql/pglite'
import { readFile } from 'node:fs/promises';
import { createCampaignDatabase } from './campaign-test-db.mjs';
const db=await createCampaignDatabase();
try {
 const result=await db.exec(await readFile(new URL('../../supabase/test-campaign-management.sql',import.meta.url),'utf8'));
 const pass=result.flatMap(r=>r.rows||[]).map(row=>Object.values(row)[0]).find(value=>typeof value==='string'&&value.startsWith('PASS:'));
 if(!pass)throw Error('M07 SQL test did not produce its PASS result.');
 console.log(pass);
}catch(error){console.error(`FAIL: M07 SQL: ${error.message}`);if(error.where)console.error(error.where);process.exitCode=1;}finally{await db.close();}
