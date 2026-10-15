// Usage: node scripts/import-revoland.mjs <file.json> [--apply] [--images] [--internal]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { importListingImage } from './listing-media.mjs';

const amenities = {
  parking: 'chỗ đậu xe', elevator: 'thang máy', swimmingPool: 'hồ bơi', gym: 'phòng gym',
  securitySystem: 'an ninh/camera', cctv: 'an ninh/camera', balcony: 'ban công', garden: 'sân vườn',
  airConditioning: 'máy lạnh', furnished: 'nội thất', nearSchool: 'gần trường học',
  nearHospital: 'gần bệnh viện', nearShopping: 'gần trung tâm mua sắm', nearPark: 'gần công viên',
  nearPublicTransport: 'gần phương tiện công cộng', petFriendly: 'cho nuôi thú cưng',
  riverView: 'view sông', cityView: 'view thành phố',
};
const columns = [
  '_id.$oid', 'isDeleted', 'title', 'description', 'type', 'transactionType', 'images',
  'location.ward', 'location.city', 'location.address',
  'priceDetails.salePrice', 'priceDetails.salePrice.$numberLong',
  'priceDetails.rentalPrice', 'priceDetails.rentalPrice.$numberLong',
  'propertyDetails.landArea', 'propertyDetails.usableArea', 'propertyDetails.buildingArea',
  'propertyDetails.bedrooms', 'propertyDetails.bathrooms', 'propertyDetails.numberOfFloors',
  'publishedAt', 'publishedAt.$date', 'submittedAt', 'submittedAt.$date',
  ...Object.keys(amenities).map(key => `amenities.${key}`),
];
const types = { House: 'House', Townhouse: 'House', Motel: 'House', Apartment: 'Apartment', MiniServiceApartment: 'Apartment', LandPlot: 'Land', Factory: 'Shop', Warehouse: 'Shop', Other: 'House' };
const projects = {
  Sale: { code: 'REVOLAND-BAN', name: 'Bất động sản bán · dữ liệu Revoland' },
  Rent: { code: 'REVOLAND-THUE', name: 'Cho thuê · dữ liệu Revoland' },
};
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const positive = value => {
  const number = Number(value && typeof value === 'object' ? value.$numberLong : value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
function titleCase(value) {
  const text = clean(value).normalize('NFKC');
  const letters = text.replace(/[^\p{L}]/gu, '');
  return letters && letters === letters.toUpperCase()
    ? text.toLocaleLowerCase('vi').replace(/(^|[\s([–-])(\p{L})/gu, (_, gap, letter) => gap + letter.toLocaleUpperCase('vi')) : text;
}

export function transposeColumns(input) {
  // Only access allowed columns; never enumerate or copy source records wholesale.
  const rows = new Map();
  for (const column of columns) {
    for (const [index, value] of Object.entries(input[column] ?? {})) {
      if (!rows.has(index)) rows.set(index, {});
      rows.get(index)[column] = value;
    }
  }
  return [...rows].sort(([a], [b]) => Number(a) - Number(b)).map(([, row]) => row);
}

export function prepareRevoland(input, now = new Date().toISOString()) {
  const records = transposeColumns(input).filter(row => row.isDeleted !== true);
  const titles = new Map();
  for (const record of records) {
    const title = titleCase(record.title).toLocaleLowerCase('vi');
    titles.set(title, (titles.get(title) ?? 0) + 1);
  }
  return records.map(record => {
    const externalId = record['_id.$oid'];
    if (typeof externalId !== 'string' || !/^[a-f\d]{24}$/i.test(externalId)) throw new Error('Mã nguồn Revoland không hợp lệ.');
    const type = types[record.type];
    if (!type) throw new Error(`Loại bất động sản chưa hỗ trợ: ${clean(record.type)}`);
    if (!['ForSale', 'ForRent'].includes(record.transactionType)) throw new Error('Loại giao dịch chưa hỗ trợ.');
    const rent = record.transactionType === 'ForRent';
    const transaction = rent ? 'Rent' : 'Sale';
    const notes = [];
    if (record.type === 'Other') notes.push('Loại gốc: Other');
    const priceKey = `priceDetails.${rent ? 'rentalPrice' : 'salePrice'}`;
    const price = positive(record[`${priceKey}.$numberLong`] ?? record[priceKey]);
    if (!price) notes.push('Thiếu giá hoặc giá không hợp lệ');
    const area = ['landArea', 'usableArea', 'buildingArea'].map(key => positive(record[`propertyDetails.${key}`])).find(Boolean) ?? null;
    if (!area) notes.push('Thiếu diện tích');
    const name = titleCase(record.title).slice(0, 160);
    if ((titles.get(titleCase(record.title).toLocaleLowerCase('vi')) ?? 0) > 1) notes.push('Tiêu đề trùng với tin khác');
    const labels = [...new Set(Object.entries(amenities).filter(([key]) => record[`amenities.${key}`] === true).map(([, label]) => label))];
    const details = [];
    if (labels.length) details.push(`Tiện ích: ${labels.join(', ')}.`);
    const bathrooms = positive(record['propertyDetails.bathrooms']);
    const floors = positive(record['propertyDetails.numberOfFloors']);
    if (bathrooms) details.push(`${bathrooms} phòng tắm.`);
    if (floors) details.push(`${floors} tầng.`);
    details.push('Nguồn: dữ liệu Revoland.');
    const suffix = details.join(' ');
    const original = clean(record.description).slice(0, Math.max(0, 10000 - suffix.length - 1));
    const location = [clean(record['location.ward']) || clean(record['location.address']), clean(record['location.city'])].filter(Boolean).join(', ');
    let scrapedAt = now;
    for (const key of ['publishedAt.$date', 'publishedAt', 'submittedAt.$date', 'submittedAt']) {
      const raw = record[key];
      const date = raw ? new Date(typeof raw === 'object' ? raw.$date : raw) : null;
      if (date && Number.isFinite(date.getTime())) { scrapedAt = date.toISOString(); break; }
    }
    return {
      project: projects[transaction].code,
      image_urls: (Array.isArray(record.images) ? record.images : []).slice(0, 5).filter(image => typeof image === 'string' && /^https?:\/\//i.test(image)),
      row: {
        code: `RVL-${externalId.slice(0, 16).toUpperCase()}`, name, location,
        description: [original, suffix].filter(Boolean).join(' '), property_type: type, area,
        bedrooms: positive(record['propertyDetails.bedrooms']), price, currency: 'VND',
        transaction_type: transaction, price_period: rent ? 'Month' : 'Total',
        publication: area && price ? 'Published' : 'Draft', availability: 'Available',
        source_website: 'revoland', source_url: null, source_external_id: externalId,
        scraped_at: scrapedAt, data_quality: 'NeedsReview', quality_notes: notes.join('; '),
      },
    };
  });
}

export function summarizeRevoland(prepared) {
  const countBy = key => prepared.reduce((counts, { row }) => { counts[row[key]] = (counts[row[key]] ?? 0) + 1; return counts; }, {});
  return {
    total: prepared.length, published: prepared.filter(p => p.row.publication === 'Published').length,
    draft: prepared.filter(p => p.row.publication === 'Draft').length,
    byType: countBy('property_type'), byTransaction: countBy('transaction_type'),
    withNotes: prepared.filter(p => p.row.quality_notes).length,
    notesCount: prepared.reduce((count, p) => count + (p.row.quality_notes ? p.row.quality_notes.split('; ').length : 0), 0),
    imagesPlanned: prepared.reduce((count, p) => count + p.image_urls.length, 0),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter(arg => !arg.startsWith('--'));
  if (files.length !== 1 || args.some(arg => arg.startsWith('--') && !['--apply', '--images', '--internal'].includes(arg))) throw new Error('Dùng: node scripts/import-revoland.mjs <file.json> [--apply] [--images] [--internal]');
  const prepared = prepareRevoland(JSON.parse(readFileSync(resolve(files[0]), 'utf8')));
  const preview = join(tmpdir(), 'import-revoland-preview.json');
  writeFileSync(preview, JSON.stringify(prepared, null, 2));
  console.log(JSON.stringify(summarizeRevoland(prepared)));
  if (!args.includes('--apply')) { console.log(`Chạy thử: chưa ghi dữ liệu. Xem ${preview}; thêm --apply để nhập.`); return; }
  for (const file of ['.env', '../frontend/.env.local']) if (existsSync(resolve(file))) loadEnvFile(resolve(file));
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY.');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function rest(path, init = {}) {
    const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, 'Content-Type': 'application/json', ...init.headers } });
    const body = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${path}: ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : null;
  }
  const [admin] = await rest('users?select=auth_user_id&role=eq.Admin&auth_user_id=not.is.null&limit=1');
  if (!admin) throw new Error('Không tìm thấy tài khoản Admin để ghi lịch sử nhập.');
  const upsert = { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' } };
  const projectIds = {};
  for (const project of Object.values(projects)) {
    const [saved] = await rest('property_projects?on_conflict=code', { ...upsert, body: JSON.stringify([{ ...project, location: 'Việt Nam', description: 'Nhóm tin đăng tổng hợp từ dữ liệu Revoland.' }]) });
    projectIds[project.code] = saved.id;
  }
  const rows = prepared.map(({ project, row }) => ({ ...row, project_id: projectIds[project] }));
  const saved = rows.length ? await rest('property_products?on_conflict=source_website,source_external_id', { ...upsert, body: JSON.stringify(rows) }) : [];
  if (saved.length) await rest('property_history', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(saved.map(row => ({ entity_kind: 'properties', entity_id: row.id, actor_id: admin.auth_user_id, action: 'properties_imported', reason: 'Nhập từ revoland', before_data: null, after_data: row, source: 'Import' }))) });
  console.log(`Đã nhập ${saved.length} tin.`);
  if (!args.includes('--images')) return;
  const products = new Map(saved.map(product => [product.source_external_id, product]));
  const existing = new Set((await rest('property_media?select=object_key&object_key=like.*%2Frevoland-*')).map(media => media.object_key));
  const visibility = args.includes('--internal') ? 'Internal' : 'Public';
  let done = 0, present = 0;
  const failures = [];
  for (const { row, image_urls } of prepared) {
    const product = products.get(row.source_external_id);
    if (!product) throw new Error('Không tìm thấy tin vừa nhập.');
    for (const [index, imageUrl] of image_urls.entries()) {
      const objectKey = `${product.id}/revoland-${index}.webp`;
      if (existing.has(objectKey)) { present++; continue; }
      try {
        await importListingImage({ imageUrl, product, objectKey, index, sourceWebsite: 'revoland', visibility, url, headers, rest, actorId: admin.auth_user_id });
        existing.add(objectKey);
        done++;
      } catch (error) { failures.push(`${row.source_external_id}, ảnh ${index + 1}: ${error.message}`); }
    }
  }
  console.log(`Đã nhập ${done} ảnh (${visibility}), lỗi ${failures.length}, đã có sẵn ${present}.`);
  for (const failure of failures) console.log(`  Lỗi: ${failure}`);
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
