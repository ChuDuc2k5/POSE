// Usage: node scripts/import-revoland.mjs <file.json> [--apply] [--images] [--internal]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { importListingImage } from './listing-media.mjs';
import { assertListingPrivacy, hasListingContactData, scrubListingText } from './listing-privacy.mjs';

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
  'propertyDetails.apartmentOrientation', 'propertyDetails.furnished',
  'publishedAt', 'publishedAt.$date', 'submittedAt', 'submittedAt.$date',
  ...Object.keys(amenities).map(key => `amenities.${key}`),
];
const types = { House: 'House', Townhouse: 'House', Motel: 'House', Apartment: 'Apartment', MiniServiceApartment: 'Apartment', SocialHousing: 'Apartment', LandPlot: 'Land', ProjectLand: 'Land', Factory: 'Shop', Warehouse: 'Shop', Office: 'Office', Other: 'House' };
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

function valueAt(record, path) {
  return path.split('.').reduce((value, key) => value == null ? undefined : value[key], record);
}

function recordToColumns(record) {
  const row = {};
  for (const column of columns) {
    const value = valueAt(record, column);
    if (value !== undefined) row[column] = value;
  }
  for (const column of ['_id.$oid', 'publishedAt.$date', 'submittedAt.$date', 'priceDetails.salePrice.$numberLong', 'priceDetails.rentalPrice.$numberLong']) {
    const parent = column.slice(0, column.lastIndexOf('.'));
    const leaf = column.slice(column.lastIndexOf('.') + 1);
    const source = valueAt(record, parent);
    if (source && typeof source === 'object' && source[leaf] !== undefined) row[column] = source[leaf];
  }
  return row;
}

export function prepareInput(input) {
  return Array.isArray(input) ? input.map(recordToColumns) : transposeColumns(input);
}

const directions = { North: 'Bắc', South: 'Nam', East: 'Đông', West: 'Tây', NorthEast: 'Đông Bắc', NorthWest: 'Tây Bắc', SouthEast: 'Đông Nam', SouthWest: 'Tây Nam' };

export function prepareRevoland(input, now = new Date().toISOString()) {
  const records = prepareInput(input).filter(row => row.isDeleted !== true);
  const titles = new Map();
  for (const record of records) {
    const title = titleCase(scrubListingText(record.title, { title: true })).toLocaleLowerCase('vi');
    titles.set(title, (titles.get(title) ?? 0) + 1);
  }
  const prepared = records.map(record => {
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
    const safeTitle = scrubListingText(record.title, { title: true });
    const safeDescription = scrubListingText(record.description);
    const name = titleCase(safeTitle).slice(0, 160) || 'Bất động sản Revoland';
    if ((titles.get(titleCase(safeTitle).toLocaleLowerCase('vi')) ?? 0) > 1) notes.push('Tiêu đề trùng với tin khác');
    const labels = [...new Set(Object.entries(amenities).filter(([key]) => record[`amenities.${key}`] === true).map(([, label]) => label))];
    const details = [];
    if (labels.length) details.push(`Tiện ích: ${labels.join(', ')}.`);
    const bathrooms = positive(record['propertyDetails.bathrooms']);
    const floors = positive(record['propertyDetails.numberOfFloors']);
    if (bathrooms) details.push(`${bathrooms} phòng tắm.`);
    if (floors) details.push(`${floors} tầng.`);
    const orientation = directions[record['propertyDetails.apartmentOrientation']];
    if (orientation) details.push(`Hướng ${orientation}.`);
    if (record['propertyDetails.furnished'] === true) details.push('Có nội thất.');
    details.push('Nguồn: dữ liệu Revoland.');
    const suffix = details.join(' ');
    const original = safeDescription.slice(0, Math.max(0, 10000 - suffix.length - 1));
    const location = [clean(record['location.ward']) || clean(record['location.address']), clean(record['location.city'])].filter(Boolean).join(', ');
    let scrapedAt = now;
    for (const key of ['publishedAt.$date', 'publishedAt', 'submittedAt.$date', 'submittedAt']) {
      const raw = record[key];
      const date = raw ? new Date(typeof raw === 'object' ? raw.$date : raw) : null;
      if (date && Number.isFinite(date.getTime())) { scrapedAt = date.toISOString(); break; }
    }
    return {
      project: projects[transaction].code,
      text_scrubbed: safeTitle !== clean(record.title) || safeDescription !== clean(record.description),
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
  assertListingPrivacy(prepared);
  return prepared;
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
    rowsChangedByScrubbing: prepared.filter(p => p.text_scrubbed).length,
    rowsWithDetectorHits: prepared.filter(({ row }) => ['name', 'description', 'location', 'quality_notes'].some(key => hasListingContactData(row[key]))).length,
  };
}

export function normalizeDedupeTitle(value) {
  return clean(scrubListingText(value, { title: true })).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/[đĐ]/gu, 'd').toLocaleLowerCase('en').replace(/[^a-z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

function normalizedWard(value) {
  return normalizeDedupeTitle(String(value ?? '').split(',')[0]);
}

function duplicateKey(row) {
  return [row.transaction_type, row.price ?? '', row.area == null ? '' : Math.round(Number(row.area)), normalizedWard(row.location)].join('|');
}

// The generated suffix (amenities, rooms, source) is shared by most listings; compare the original text only.
const ownText = value => String(value ?? '').replace(/Tiện ích: [^.]*\.|\d+ phòng tắm\.|\d+ tầng\.|Hướng [^.]*\.|Có nội thất\.|Nguồn: dữ liệu Revoland\./gu, ' ');
const words = value => new Set(normalizeDedupeTitle(ownText(value)).split(' ').filter(word => word.length > 2));
const floors = value => new Set([...normalizeDedupeTitle(value).matchAll(/\btang (\d{1,3})\b/gu)].map(match => match[1]));
// Same price, area and ward is common for different units of one project (Vinhomes towers);
// such rows are duplicates only when their text is alike and they do not name different floors.
export function sameListing(a, b) {
  const left = `${a.name ?? ''} ${a.description ?? ''}`, right = `${b.name ?? ''} ${b.description ?? ''}`;
  const fa = floors(left), fb = floors(right);
  if (fa.size && fb.size && ![...fa].some(floor => fb.has(floor))) return false;
  const wa = words(left), wb = words(right);
  let shared = 0;
  for (const word of wa) if (wb.has(word)) shared++;
  return shared / (wa.size + wb.size - shared || 1) >= 0.45;
}

export function dedupeRevoland(prepared, existing = []) {
  const existingById = new Map(existing.filter(row => row.source_external_id).map(row => [row.source_external_id, row]));
  const existingByTitle = new Map(existing.map(row => [normalizeDedupeTitle(row.name), row]).filter(([title]) => title));
  const existingByKey = new Map();
  for (const row of existing) existingByKey.set(duplicateKey(row), [...(existingByKey.get(duplicateKey(row)) ?? []), row]);
  const seenTitlePrice = new Map();
  const seenKey = new Map();
  const counts = { a: 0, b: 0, c: 0, d: 0, conflicts: 0, totalSkipped: 0 };
  const skipped = [];
  const kept = [];
  for (const preparedRow of prepared) {
    const row = preparedRow.row;
    const titlePrice = `${normalizeDedupeTitle(row.name)}|${row.price ?? ''}`;
    const key = duplicateKey(row);
    let reason = null;
    let matched = null;
    if (existingById.has(row.source_external_id)) { reason = 'a'; matched = existingById.get(row.source_external_id); }
    else if (normalizeDedupeTitle(row.name) && existingByTitle.has(normalizeDedupeTitle(row.name))) { reason = 'b'; matched = existingByTitle.get(normalizeDedupeTitle(row.name)); }
    else if ((matched = (existingByKey.get(key) ?? []).find(other => sameListing(row, other)))) reason = 'c';
    else if (seenTitlePrice.has(titlePrice)) { reason = 'd'; matched = seenTitlePrice.get(titlePrice); }
    else if ((matched = (seenKey.get(key) ?? []).find(other => sameListing(row, other)))) reason = 'd';
    if (reason) {
      counts[reason]++;
      counts.totalSkipped++;
      skipped.push({ oid: row.source_external_id, reason, matchedCode: matched?.code ?? null });
      continue;
    }
    seenTitlePrice.set(titlePrice, row);
    seenKey.set(key, [...(seenKey.get(key) ?? []), row]);
    kept.push(preparedRow);
  }
  return { kept, skipped, counts };
}

async function legacyMain() {
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

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter(arg => !arg.startsWith('--'));
  if (files.length !== 1 || args.some(arg => arg.startsWith('--') && !['--apply', '--images', '--internal', '--skip-duplicates'].includes(arg))) throw new Error('Usage: node scripts/import-revoland.mjs <file.json> [--apply] [--images] [--internal] [--skip-duplicates]');
  const input = JSON.parse(readFileSync(resolve(files[0]), 'utf8'));
  const prepared = prepareRevoland(input);
  const shouldDedupe = Array.isArray(input) || args.includes('--skip-duplicates');
  let dedupe = { kept: prepared, skipped: [], counts: { a: 0, b: 0, c: 0, d: 0, conflicts: 0, totalSkipped: 0 } };
  let url, key, headers, rest;
  if (shouldDedupe || args.includes('--apply')) {
    for (const file of ['.env', '../frontend/.env.local']) if (existsSync(resolve(file))) loadEnvFile(resolve(file));
    url = process.env.SUPABASE_URL;
    key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY.');
    headers = { apikey: key, Authorization: `Bearer ${key}` };
    rest = async (path, init = {}) => {
      const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, 'Content-Type': 'application/json', ...init.headers } });
      const body = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${path}: ${body.slice(0, 300)}`);
      return body ? JSON.parse(body) : null;
    };
  }
  if (shouldDedupe) dedupe = dedupeRevoland(prepared, await rest('property_products?select=id,code,name,description,price,area,transaction_type,location,source_website,source_external_id'));
  const preview = join(tmpdir(), 'import-revoland-preview.json');
  writeFileSync(preview, JSON.stringify(prepared, null, 2));
  console.log(JSON.stringify(summarizeRevoland(prepared)));
  if (shouldDedupe) {
    for (const skipped of dedupe.skipped) console.log(`${skipped.oid} -> ${skipped.reason} -> ${skipped.matchedCode ?? ''}`);
    console.log(`Duplicate counts: a=${dedupe.counts.a}, b=${dedupe.counts.b}, c=${dedupe.counts.c}, d=${dedupe.counts.d}, conflicts=${dedupe.counts.conflicts}, skipped=${dedupe.counts.totalSkipped}`);
  }
  if (!args.includes('--apply')) { console.log(`Dry run: no data written. Preview: ${preview}`); return; }
  const [admin] = await rest('users?select=auth_user_id&role=eq.Admin&auth_user_id=not.is.null&limit=1');
  if (!admin) throw new Error('No Admin account found for import history.');
  const projectPost = { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' } };
  const projectIds = {};
  for (const project of Object.values(projects)) {
    const [saved] = await rest('property_projects?on_conflict=code', { ...projectPost, body: JSON.stringify([{ ...project, location: 'Vietnam', description: 'Revoland imported listing group.' }]) });
    projectIds[project.code] = saved.id;
  }
  const rows = dedupe.kept.map(({ project, row }) => ({ ...row, project_id: projectIds[project] }));
  const saved = [];
  for (const row of rows) {
    try { saved.push(...(await rest('property_products', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) }) ?? [])); }
    catch (error) { if (String(error.message).startsWith('409 ')) { dedupe.counts.conflicts++; dedupe.counts.totalSkipped++; } else throw error; }
  }
  if (saved.length) await rest('property_history', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(saved.map(row => ({ entity_kind: 'properties', entity_id: row.id, actor_id: admin.auth_user_id, action: 'properties_imported', reason: 'Revoland import', before_data: null, after_data: row, source: 'Import' }))) });
  console.log(`Imported ${saved.length} listings.`);
  if (!args.includes('--images')) return;
  const products = new Map(saved.map(product => [product.source_external_id, product]));
  const existingMedia = new Set((await rest('property_media?select=object_key&object_key=like.*%2Frevoland-*')).map(media => media.object_key));
  const visibility = args.includes('--internal') ? 'Internal' : 'Public';
  let done = 0, present = 0;
  const failures = [];
  for (const { row, image_urls } of dedupe.kept) {
    const product = products.get(row.source_external_id);
    if (!product) continue;
    for (const [index, imageUrl] of image_urls.entries()) {
      const objectKey = `${product.id}/revoland-${index}.webp`;
      if (existingMedia.has(objectKey)) { present++; continue; }
      try { await importListingImage({ imageUrl, product, objectKey, index, sourceWebsite: 'revoland', visibility, url, headers, rest, actorId: admin.auth_user_id }); existingMedia.add(objectKey); done++; }
      catch (error) { failures.push(`${row.source_external_id}, image ${index + 1}: ${error.message}`); }
    }
  }
  console.log(`Imported ${done} images (${visibility}), failures ${failures.length}, already present ${present}.`);
  for (const failure of failures) console.log(`  Failure: ${failure}`);
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
