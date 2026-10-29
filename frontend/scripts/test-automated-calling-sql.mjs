import { readFile } from 'node:fs/promises';
import { createCampaignDatabase } from './campaign-test-db.mjs';
const db = await createCampaignDatabase();
try {
  await db.exec(await readFile(new URL('../../supabase/automated-calling.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../supabase/campaign-finish.sql', import.meta.url), 'utf8'));
  const result = await db.exec(
    await readFile(new URL('../../supabase/test-automated-calling.sql', import.meta.url), 'utf8'),
  );
  for (const r of result) for (const row of r.rows || []) if (row.result?.startsWith('PASS:')) console.log(row.result);
} finally {
  await db.close();
}
