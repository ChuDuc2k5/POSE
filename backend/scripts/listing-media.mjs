import { createHash } from 'node:crypto';
import sharp from 'sharp';

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

export async function importListingImage({ imageUrl, product, objectKey, index, sourceWebsite, visibility, url, headers, rest, actorId }) {
  const content = await toWebp(await download(imageUrl));
  const upload = await fetch(`${url}/storage/v1/object/property-files/${objectKey}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'image/webp', 'x-upsert': 'true' }, body: content });
  if (!upload.ok) throw new Error(`upload ${upload.status}: ${(await upload.text()).slice(0, 200)}`);
  const [media] = await rest('property_media?on_conflict=object_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify([{
    property_id: product.id, object_key: objectKey, name: `Ảnh tin đăng · nguồn ${sourceWebsite}`.slice(0, 160),
    media_type: 'Image', mime_type: 'image/webp', size_bytes: content.length, checksum: createHash('sha256').update(content).digest('hex'),
    visibility, visible: true, sort_order: index, removed: false,
  }]) });
  // Media changes bump the product version so cached search results refresh, like an Admin upload.
  const [current] = await rest(`property_products?select=version&id=eq.${product.id}`);
  await rest(`property_products?id=eq.${product.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ version: current.version + 1, updated_at: new Date().toISOString() }) });
  await rest('property_history', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ entity_kind: 'properties', entity_id: product.id, actor_id: actorId, action: 'media_imported', reason: `Ảnh từ ${sourceWebsite}`, before_data: null, after_data: media, source: 'Import' }]) });
}
