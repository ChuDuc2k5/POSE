// Copies the photos of imported listings into the private `property-files` bucket
// and links them in property_media, using the same rules as an Admin upload.
// Usage: node scripts/import-listing-images.mjs <file.json>... [--apply] [--internal]
// Run after import-listings.mjs. Without --apply nothing is downloaded or written.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import sharp from 'sharp';

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
async function download(imageUrl) {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'TERAVA listing import' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // Some CDNs send a generic type; the real format is verified by sharp below.
  if (!/^(image\/|application\/octet-stream|binary\/octet-stream)/.test(response.headers.get('content-type') || '')) throw new Error('máy chủ không trả về ảnh');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 15 * 1024 * 1024) throw new Error('ảnh quá lớn');
  return bytes;
}
// Same conversion as the Admin media upload: verified format, single frame, ≤2400px, WebP q85, ≤10 MB.
async function toWebp(bytes) {
  const image = sharp(bytes, { limitInputPixels: 40000000 });
  const meta = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) throw new Error('định dạng ảnh không hợp lệ');
  const content = await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  if (content.length > 10 * 1024 * 1024) throw new Error('ảnh sau chuyển đổi quá lớn');
  return content;
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
      const content = await toWebp(await download(imageUrl));
      const upload = await fetch(`${url}/storage/v1/object/property-files/${objectKey}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'image/webp', 'x-upsert': 'true' }, body: content });
      if (!upload.ok) throw new Error(`upload ${upload.status}: ${(await upload.text()).slice(0, 200)}`);
      const [media] = await rest('property_media?on_conflict=object_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify([{
        property_id: product.id, object_key: objectKey, name: `Ảnh tin đăng · nguồn ${record.source_website}`.slice(0, 160),
        media_type: 'Image', mime_type: 'image/webp', size_bytes: content.length, checksum: createHash('sha256').update(content).digest('hex'),
        visibility, visible: true, sort_order: index, removed: false,
      }]) });
      // Media changes bump the product version so cached search results refresh, like an Admin upload.
      const [current] = await rest(`property_products?select=version&id=eq.${product.id}`);
      await rest(`property_products?id=eq.${product.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ version: current.version + 1, updated_at: new Date().toISOString() }) });
      await rest('property_history', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ entity_kind: 'properties', entity_id: product.id, actor_id: admin.auth_user_id, action: 'media_imported', reason: `Ảnh từ ${record.source_website}`, before_data: null, after_data: media, source: 'Import' }]) });
      done++;
    } catch (error) { failures.push(`${record.external_id}: ${error.message}`); }
  }
}
console.log(apply ? `Đã nhập ${done} ảnh (${visibility}), lỗi ${failures.length}, đã có sẵn ${present}, bỏ qua ${skipped} tin chưa có trong Supabase.` : `Chạy thử: sẽ xử lý ${done} ảnh (${visibility}); đã có sẵn ${present}; bỏ qua ${skipped} tin chưa nhập. Thêm --apply để thực hiện.`);
for (const failure of failures) console.log(`  Lỗi: ${failure}`);
