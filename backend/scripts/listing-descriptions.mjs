// Rebuild imported listing descriptions from the original export.
// Dry-run: node scripts/listing-descriptions.mjs [source.json]
// Offline:  node scripts/listing-descriptions.mjs source.json --local-export products.json
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { prepareInput } from './import-revoland.mjs';
import { hasListingContactData, scrubListingText } from './listing-privacy.mjs';

const defaultSource = 'C:/Users/Admin/Downloads/QuinLand.Properties_TPHCM_250.json';
const args = process.argv.slice(2);
const sourceFile = args.find((arg) => !arg.startsWith('--')) || defaultSource;
const localIndex = args.indexOf('--local-export');
const localFile = localIndex >= 0 ? args[localIndex + 1] : null;
const apply = args.includes('--apply');
if (apply && localFile) throw new Error('--apply cannot be combined with --local-export.');

function readJson(file) {
  return JSON.parse(readFileSync(resolve(file), 'utf8'));
}
function productRows(value) {
  if (Array.isArray(value)) return value;
  return value.items || value.rows || value.data || [];
}
function sourceDescription(value) {
  const normalized = String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(/\t•\t/gu, '• ');
  // Blank lines are kept so paragraphs survive; each non-empty line is scrubbed on its own.
  return normalized
    .split('\n')
    .map((line) => (line.trim() ? scrubListingText(line) : ''))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
// The import appended amenity/detail sentences ("Tiện ích: …", "Nguồn: dữ liệu Revoland.") after the
// flattened description. Keep that suffix: it is whatever follows the flattened scrubbed original.
function importedSuffix(current, sourceValue) {
  const flatOriginal = scrubListingText(sourceValue).replace(/\s+/gu, ' ').trim();
  const flatCurrent = String(current ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!flatCurrent.startsWith(flatOriginal)) return null;
  return flatCurrent.slice(flatOriginal.length).trim();
}
function retry(fn, attempts = 4) {
  return (async () => {
    let last;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        last = error;
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }
    throw last;
  })();
}

const sourceRecords = prepareInput(readJson(sourceFile));
const sourceById = new Map(sourceRecords.map((record) => [record['_id.$oid'], record]));
let products;
let rest;
if (localFile) {
  products = productRows(readJson(localFile));
} else {
  for (const file of ['.env', '../frontend/.env.local']) if (existsSync(resolve(file))) loadEnvFile(resolve(file));
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Use --local-export for an offline dry-run.');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  rest = async (path, init = {}) => {
    const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    const body = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${path}: ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : null;
  };
  products = await rest(
    'property_products?select=id,code,description,version,source_external_id,source_website&source_website=eq.revoland',
  );
}

const changes = [],
  skipped = [];
let contactsScrubbed = 0;
for (const product of products) {
  if (product.source_website !== undefined && product.source_website !== 'revoland') continue;
  const source = sourceById.get(product.source_external_id);
  if (!source) continue;
  const suffix = importedSuffix(product.description, source.description);
  if (suffix === null) {
    skipped.push(product.code);
    continue;
  }
  const description = [sourceDescription(source.description), suffix].filter(Boolean).join('\n\n');
  if (description !== product.description) {
    const sourceHadContact =
      hasListingContactData(source.description) ||
      description !== String(source.description ?? '').replace(/\r\n?/gu, '\n');
    if (sourceHadContact) contactsScrubbed++;
    changes.push({ product, description });
  }
}

console.log(`Rows changed: ${changes.length}`);
console.log(`Contacts scrubbed: ${contactsScrubbed}`);
const leaking = changes
  .filter(({ description }) => hasListingContactData(description))
  .map(({ product }) => product.code);
console.log(
  `Rebuilt descriptions still holding contact data: ${leaking.length}${leaking.length ? ` ${leaking.slice(0, 10).join(', ')}` : ''}`,
);
if (apply && leaking.length) throw new Error('Refusing to write descriptions that still contain contact data.');
console.log(
  `Skipped (stored text no longer starts with the source): ${skipped.length}${skipped.length ? ` ${skipped.slice(0, 10).join(', ')}` : ''}`,
);
for (const { product, description } of changes.slice(0, 3)) {
  console.log(`\nExample ${product.code || product.source_external_id}:`);
  console.log(`BEFORE:\n${product.description || '(empty)'}`);
  console.log(`AFTER:\n${description || '(empty)'}`);
}
if (localFile) console.log(`Local mode: read source ${sourceFile} and export ${localFile}; no Supabase request made.`);
if (!apply) {
  console.log('Dry run: no data written.');
  process.exit(0);
}

const [admin] = await rest('users?select=auth_user_id&role=eq.Admin&auth_user_id=not.is.null&limit=1');
if (!admin) throw new Error('No Admin account found for description repair history.');
for (let start = 0; start < changes.length; start += 50) {
  const batch = changes.slice(start, start + 50);
  await Promise.all(
    batch.map(({ product, description }) =>
      retry(() =>
        rest(`property_products?id=eq.${product.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ description, version: product.version + 1, updated_at: new Date().toISOString() }),
        }),
      ),
    ),
  );
  await retry(() =>
    rest('property_history', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(
        batch.map(({ product, description }) => ({
          entity_kind: 'properties',
          entity_id: product.id,
          actor_id: admin.auth_user_id,
          action: 'description_repaired',
          reason: 'Restored line breaks from QuinLand export',
          before_data: { description: product.description },
          after_data: { description },
          source: 'Import',
        })),
      ),
    }),
  );
}
console.log(`Applied ${changes.length} description repairs in ${Math.ceil(changes.length / 50)} batches.`);
