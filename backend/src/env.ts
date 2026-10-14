import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}
// Local monorepo development can share server-only Supabase configuration.
const frontendEnvPath = resolve(process.cwd(), '../frontend/.env.local');
if ((!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) && existsSync(frontendEnvPath)) {
  loadEnvFile(frontendEnvPath);
}

export const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
export const observeEnabled = Boolean(
  process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET,
);
