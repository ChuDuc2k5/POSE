import { readFile } from 'node:fs/promises';
import { createCampaignDatabase } from './campaign-test-db.mjs';
const db=await createCampaignDatabase();
try{
 for(const file of ['automated-calling.sql','browser-voice.sql'])await db.exec(await readFile(new URL('../../supabase/'+file,import.meta.url),'utf8'));
 const results=await db.exec(await readFile(new URL('../../supabase/test-browser-voice.sql',import.meta.url),'utf8'));
 for(const result of results)for(const row of result.rows||[])if(row.result?.startsWith('PASS:'))console.log(row.result);
}finally{await db.close();}
