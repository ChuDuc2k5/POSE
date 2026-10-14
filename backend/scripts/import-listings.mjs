// Imports crawled listings (nhadat.cafeland.vn JSON export) into property_products.
// Usage: node scripts/import-listings.mjs <file.json>... [--apply]
// Without --apply it only prints what would be written. Requires SUPABASE_URL and
// SUPABASE_SECRET_KEY (backend/.env or frontend/.env.local) and supabase/property-listing-source.sql.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

for (const file of ['.env', '../frontend/.env.local']) if (existsSync(resolve(file))) loadEnvFile(resolve(file));
const apply = process.argv.includes('--apply');
const files = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (!files.length) throw new Error('Truyền ít nhất một file JSON.');

const projects = {
  land_sale: { code: 'CAFELAND-DAT', name: 'Đất nền TP.HCM · tin đăng Cafeland', transaction: 'Sale' },
  rental: { code: 'CAFELAND-THUE', name: 'Cho thuê TP.HCM · tin đăng Cafeland', transaction: 'Rent' },
};
const districts = ['Thủ Đức', 'Bình Thạnh', 'Gò Vấp', 'Tân Bình', 'Tân Phú', 'Phú Nhuận', 'Bình Tân', 'Nhà Bè', 'Củ Chi', 'Hóc Môn', 'Bình Chánh', 'Cần Giờ', 'Thảo Điền', 'An Phú', 'Phú Mỹ Hưng', 'Thủ Thiêm'];

// NFKC turns decorative Unicode letters (bold/italic math alphabets) back into plain text.
const clean = text => String(text ?? '').normalize('NFKC').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
function sentenceCase(title) {
  const text = clean(title);
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters && letters === letters.toUpperCase())
    return text.toLocaleLowerCase('vi').replace(/(^|[\s([–-])(\p{L})/gu, (_, gap, letter) => gap + letter.toLocaleUpperCase('vi'));
  return text;
}
function parseArea(text) {
  const labelled = text.match(/(?:dt|diện tích|dtsd)\s*:?\s*(\d+(?:[.,]\d+)?)\s*m(?![\p{L}])/iu);
  if (labelled && Number(labelled[1].replace(',', '.')) > 1) return Number(labelled[1].replace(',', '.'));
  const match = text.match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*m(?:²|2)(?![\p{L}\d])/iu);
  if (!match) return null;
  const raw = match[1];
  const value = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'));
  return value > 1 && value <= 1_000_000 ? value : null;
}
// Total price written in the title, ignoring per-m² prices; rent uses the monthly amount.
function parseTitlePrice(text, rent) {
  for (const match of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(tỷ|tỉ|ty|triệu|trieu|tr)(?![\p{L}])\s*(\/\s*(?:m2|m²|tháng|th))?/giu)) {
    const per = match[3]?.toLowerCase() ?? '';
    if (per.includes('m')) continue;
    if (!rent && per) continue;
    const amount = Number(match[1].replace(',', '.')) * (/^t[ỷỉy]/i.test(match[2]) ? 1e9 : 1e6);
    if (amount > 0) return amount;
  }
  return null;
}
function propertyType(kind, text) {
  const t = text.toLowerCase();
  if (kind === 'land_sale') return /biệt thự/.test(t) && !/đất/.test(t) ? 'Villa' : 'Land';
  if (/biệt thự/.test(t)) return 'Villa';
  if (/căn hộ|chung cư|\bcc\b|studio|penthouse|duplex|officetel|\d\s*pn\b/.test(t)) return 'Apartment';
  if (/văn phòng/.test(t)) return 'Office';
  if (/mặt bằng|shophouse|kiot|ki-ốt|cửa hàng|kho|xưởng|kinh doanh/.test(t)) return 'Shop';
  if (/đất/.test(t)) return 'Land';
  return 'House';
}
function locationOf(text) {
  const district = text.match(/\b(?:quận|q\.?)\s*(\d{1,2})\b/i);
  if (district) return `Quận ${district[1]}, TP. Hồ Chí Minh`;
  const named = districts.find(name => text.toLowerCase().includes(name.toLowerCase()));
  if (named) return `${named}, TP. Hồ Chí Minh`;
  const ward = text.match(/\b(phường|xã)\s+([\p{Lu}][\p{L}]*(?:\s+[\p{Lu}\d][\p{L}\d]*){0,3})/u);
  if (ward) return `${ward[1][0].toUpperCase()}${ward[1].slice(1)} ${ward[2]}, TP. Hồ Chí Minh`;
  return 'TP. Hồ Chí Minh';
}
const vnd = value => value.toLocaleString('vi-VN');
const priceText = (price, rent) => price === null ? 'giá chưa công bố' : rent ? `${vnd(price)} VND/tháng` : `${vnd(price)} VND`;
// Rewrites the description from facts present in the listing only; nothing is invented.
function describe(record, facts) {
  let original = clean(record.description).replace(/(\.\.\.|…)$/, '')
    .replace(/^[^\p{L}\p{N}[]*(?:[\p{L}\p{N} ]{0,20}[-–—=]{3,})?\s*/u, '').replace(/\s*[-–—=_]{3,}\s*/g, ' ').trim();
  // The crawler cut descriptions mid-sentence; keep complete sentences only.
  const lastStop = original.lastIndexOf('. ');
  if (lastStop > 40) original = original.slice(0, lastStop + 1);
  else if (original && !/[.!?]$/.test(original)) original += '.';
  const labels = { Apartment: 'Căn hộ', House: 'Nhà', Land: 'Đất', Villa: 'Biệt thự', Office: 'Văn phòng', Shop: 'Mặt bằng kinh doanh' };
  const details = [
    `${labels[facts.type]} ${facts.rent ? 'cho thuê' : 'đang rao bán'} tại ${facts.location}`,
    facts.area ? `diện tích ${vnd(facts.area)} m²` : 'diện tích chưa được ghi trong tin đăng',
    facts.bedrooms !== null ? `${facts.bedrooms} phòng ngủ` : null,
    facts.furnished ? 'nội thất đầy đủ theo tin đăng' : null,
    priceText(facts.price, facts.rent),
  ].filter(Boolean).join(', ');
  const date = new Date(record.scraped_at).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return `${original} ${details}. Thông tin tổng hợp từ tin đăng trên ${record.source_website} (cập nhật ${date}); vị trí, giá và hình ảnh chưa được TERAVA xác minh trực tiếp.`.slice(0, 10000);
}

function transform(record) {
  const rent = record.property_type === 'rental';
  const text = clean(`${record.title} ${record.description}`);
  const notes = [];
  let area = record.area_m2 > 1 ? Number(record.area_m2) : null;
  const titleArea = parseArea(clean(record.title)) ?? parseArea(clean(record.description));
  if (titleArea && (!area || Math.abs(titleArea - area) > 0.5)) { if (area) notes.push(`Diện tích tin cào ${area} m², tiêu đề ghi ${titleArea} m²`); area = titleArea; }
  if (!area) notes.push('Thiếu diện tích');
  let price = Number(record.price_vnd) > 0 && Number(record.price_vnd) < 1e12 ? Number(record.price_vnd) : null;
  if (!price && record.price_vnd) notes.push(`Giá tin cào bất thường: ${record.price_vnd}`);
  const titlePrice = parseTitlePrice(record.title, rent);
  if (titlePrice && price !== titlePrice) { if (price) notes.push(`Giá tin cào ${vnd(price)}, tiêu đề ghi ${vnd(titlePrice)}`); price = titlePrice; }
  if (/\/\s*m(?:2|²)/i.test(record.title)) notes.push('Tiêu đề nêu giá theo m²');
  // A sale price below 2 million VND per m² is almost always a per-m² price read as the total.
  if (!rent && price && area && price / area < 2_000_000) {
    notes.push(`Giá ${vnd(price)} VND cho ${vnd(area)} m² nghi là giá theo m²; để trống chờ xác minh`);
    price = null;
  }
  const bedroomMatch = text.match(/(\d{1,2})\s*(?:pn|phòng ngủ)\b/i);
  const facts = {
    rent, area, price, type: propertyType(record.property_type, text), location: locationOf(text),
    bedrooms: bedroomMatch ? Number(bedroomMatch[1]) : null,
    furnished: /full nội thất|nội thất đầy đủ|đầy đủ nội thất|full nt/i.test(text),
  };
  const project = projects[record.property_type];
  if (!project) throw new Error(`Loại tin chưa hỗ trợ: ${record.property_type}`);
  return {
    project: project.code,
    row: {
      code: `${rent ? 'CFR' : 'CFL'}-${String(record.external_id).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)}`,
      name: sentenceCase(record.title).slice(0, 160),
      location: facts.location,
      description: describe(record, facts),
      property_type: facts.type,
      area: facts.area,
      bedrooms: facts.bedrooms,
      price: facts.price,
      currency: 'VND',
      transaction_type: rent ? 'Rent' : 'Sale',
      price_period: rent ? 'Month' : 'Total',
      publication: facts.area ? 'Published' : 'Draft',
      availability: 'Available',
      source_website: record.source_website,
      source_url: record.source_url,
      source_external_id: String(record.external_id),
      scraped_at: record.scraped_at,
      data_quality: 'NeedsReview',
      quality_notes: notes.join('; ').slice(0, 1000),
    },
  };
}

const records = files.flatMap(file => JSON.parse(readFileSync(resolve(file), 'utf8')));
const prepared = records.map(transform);
const summary = { total: prepared.length, published: prepared.filter(p => p.row.publication === 'Published').length, draft: prepared.filter(p => p.row.publication === 'Draft').length, withNotes: prepared.filter(p => p.row.quality_notes).length };
const previewFile = join(tmpdir(), 'import-listings-preview.json');
writeFileSync(previewFile, JSON.stringify(prepared, null, 2));
console.log(JSON.stringify(summary));
if (!apply) { console.log(`Chạy thử: chưa ghi dữ liệu. Xem ${previewFile}; thêm --apply để nhập.`); process.exit(0); }

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY.');
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}
const [admin] = await rest('users?select=auth_user_id&role=eq.Admin&auth_user_id=not.is.null&limit=1');
if (!admin) throw new Error('Không tìm thấy tài khoản Admin để ghi lịch sử nhập.');
const projectIds = {};
for (const project of Object.values(projects)) {
  const [saved] = await rest('property_projects?on_conflict=code', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify([{ code: project.code, name: project.name, location: 'TP. Hồ Chí Minh', description: `Nhóm tin đăng ${project.transaction === 'Rent' ? 'cho thuê' : 'bán đất'} tổng hợp từ nhadat.cafeland.vn.` }]) });
  projectIds[project.code] = saved.id;
}
const rows = prepared.map(({ project, row }) => ({ ...row, project_id: projectIds[project] }));
const saved = await rest('property_products?on_conflict=source_website,source_external_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows) });
await rest('property_history', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(saved.map(row => ({ entity_kind: 'properties', entity_id: row.id, actor_id: admin.auth_user_id, action: 'properties_imported', reason: `Nhập từ ${row.source_website}`, before_data: null, after_data: row, source: 'Import' }))) });
console.log(`Đã nhập ${saved.length} tin (${rows.filter(r => r.publication === 'Published').length} công bố, ${rows.filter(r => r.publication === 'Draft').length} nháp).`);
