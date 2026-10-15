// Copies the photos of imported listings into the private `property-files` bucket
// and links them in property_media, using the same rules as an Admin upload.
// Usage: node scripts/import-listing-images.mjs <file.json>... [--apply] [--internal]
// Run after import-listings.mjs. Without --apply nothing is downloaded or written.
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { importListingImage } from './listing-media.mjs';

for (const file of ['.env', '../frontend/.env.local']) if (existsSync(resolve(file))) loadEnvFile(resolve(file));
const apply = process.argv.includes('--apply');
const visibility = process.argv.includes('--internal') ? 'Internal' : 'Public';
const files = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (!files.length) throw new Error('Truyền ít nhất một file JSON.');
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY.');
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, 'Content-Type': 'application/json', ...init.headers } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

const records = files.flatMap(file => JSON.parse(readFileSync(resolve(file), 'utf8')));
const products = await rest('property_products?select=id,version,source_external_id,source_website&source_website=eq.nhadat.cafeland.vn');
const byExternalId = new Map(products.map(product => [product.source_external_id, product]));
// Re-runs only fetch photos that are not stored yet.
const existing = new Set((await rest('property_media?select=object_key&object_key=like.*%2Fcafeland-*')).map(media => media.object_key));
const [admin] = await rest('users?select=auth_user_id&role=eq.Admin&auth_user_id=not.is.null&limit=1');
if (!admin) throw new Error('Không tìm thấy tài khoản Admin để ghi lịch sử.');

let done = 0, skipped = 0, present = 0;
const failures = [];
for (const record of records) {
  const product = byExternalId.get(String(record.external_id));
  if (!product) { skipped++; continue; }
  for (const [index, imageUrl] of (record.image_urls || []).entries()) {
    const objectKey = `${product.id}/cafeland-${index}.webp`;
    if (existing.has(objectKey)) { present++; continue; }
    if (!apply) { done++; continue; }
    try {
      await importListingImage({ imageUrl, product, objectKey, index, sourceWebsite: record.source_website, visibility, url, headers, rest, actorId: admin.auth_user_id });
      done++;
    } catch (error) { failures.push(`${record.external_id}: ${error.message}`); }
  }
}
console.log(apply ? `Đã nhập ${done} ảnh (${visibility}), lỗi ${failures.length}, đã có sẵn ${present}, bỏ qua ${skipped} tin chưa có trong Supabase.` : `Chạy thử: sẽ xử lý ${done} ảnh (${visibility}); đã có sẵn ${present}; bỏ qua ${skipped} tin chưa nhập. Thêm --apply để thực hiện.`);
for (const failure of failures) console.log(`  Lỗi: ${failure}`);
