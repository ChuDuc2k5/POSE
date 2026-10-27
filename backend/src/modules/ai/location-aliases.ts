import { hcmWards, type HcmWard } from './hcm-wards.js';

const wardPrefix = /^(?:phường|xã|đặc khu)\s+/iu;

function normalizeArea(value: string) {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/^(?:district|quận|q\.?)\s*(\d{1,2})$/iu, '$1')
    .replace(/^(?:district|quận|q\.?|huyện|thị xã|thành phố|tp\.?|phường|xã|đặc khu)\s+/iu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function cleanAreaText(value: string) {
  return value.normalize('NFC').split(',')[0].trim();
}

const normalizedCurrentWardNames = new Set(hcmWards.map(row => normalizeArea(row.ward)));
const formerWardDistricts = hcmWards.flatMap(row => row.formerDistricts.flatMap(district => row.formerWards.map(ward => ({ district, ward }))));

function districtAliases(district: string) {
  const aliases = [district];
  const match = district.match(/^(quận|huyện)\s+(\d{1,2})$/iu);
  if (match?.[1].toLocaleLowerCase('vi') === 'quận') aliases.push(`Q.${match[2]}`);
  return aliases;
}

function formerWardCollides(ward: string, district: string) {
  const key = normalizeArea(ward);
  return normalizedCurrentWardNames.has(key) || formerWardDistricts.some(entry => entry.district !== district && normalizeArea(entry.ward) === key);
}

function addWardAliases(rows: HcmWard[], includeDistrictAliases = false) {
  const aliases: string[] = [];
  const add = (value: string) => { if (value && !aliases.includes(value)) aliases.push(value); };
  for (const row of rows) {
    add(row.ward);
    const kind = row.kind === 'xã' ? 'Xã' : row.kind === 'đặc khu' ? 'Đặc khu' : 'Phường';
    add(`${kind} ${row.ward}`);
    for (const formerWard of row.formerWards) {
      if (/^\d+$/u.test(formerWard.trim())) continue;
      const districts = row.formerDistricts.length ? row.formerDistricts : [''];
      if (districts.every(district => !formerWardCollides(formerWard, district))) {
        add(formerWard);
        add(`${kind} ${formerWard}`);
        continue;
      }
      for (const district of districts) {
        if (!district) continue;
        add(`${kind} ${formerWard}, ${district}`);
        add(`${formerWard}, ${district}`);
        add(`${kind} ${formerWard} (${district} cũ)`);
      }
    }
    if (includeDistrictAliases) for (const district of row.formerDistricts) for (const alias of districtAliases(district)) add(alias);
  }
  return aliases;
}

function rowsForDistrict(key: string) {
  return hcmWards.filter(row => row.formerDistricts.some(district => normalizeArea(district) === key));
}

function rowsForFormerProvince(province: HcmWard['formerProvince']) {
  return hcmWards.filter(row => row.formerProvince === province);
}

export function areaAliases(text: unknown): string[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const clean = cleanAreaText(text);
  const normalized = normalizeArea(clean);
  const explicitKind = clean.match(wardPrefix)?.[0]?.trim().toLocaleLowerCase('vi').split(/\s+/u)[0];

  if (normalized === 'phú mỹ hưng') {
    return ['Tân Mỹ', 'Phường Tân Mỹ', 'Tân Hưng', 'Phường Tân Hưng', 'Tân Phong', 'Phường Tân Phong', 'Phú Mỹ Hưng', 'Quận 7', 'Q.7'];
  }
  if (normalized === 'bình dương') return addWardAliases(rowsForFormerProvince('Bình Dương'), true);
  if (normalized === 'vũng tàu') return addWardAliases(rowsForDistrict('vũng tàu'), true);
  if (normalized === 'bà rịa') return addWardAliases(rowsForDistrict('bà rịa'), true);
  if (normalized === 'thủ đức' && explicitKind !== 'phường') {
    return addWardAliases(hcmWards.filter(row => row.formerDistricts.some(district => ['Quận 2', 'Quận 9', 'Thủ Đức'].includes(district))), true);
  }

  const districtRows = rowsForDistrict(normalized);
  if (!explicitKind && districtRows.some(row => row.formerProvince === 'TP.HCM')) return addWardAliases(districtRows, true);

  const ward = hcmWards.find(row => normalizeArea(row.ward) === normalized && (!explicitKind || explicitKind === row.kind));
  if (ward) return addWardAliases([ward]);

  if (districtRows.length) return addWardAliases(districtRows, true);
  return [];
}

export function withAreaAliases<T extends Record<string, unknown>>(filters: T): T & { location_aliases?: string[] } {
  const locations = [
    ...(typeof filters.location === 'string' ? [filters.location] : []),
    ...(Array.isArray(filters.locations) ? filters.locations.map(String) : []),
  ];
  const aliases = [
    ...(Array.isArray(filters.location_aliases) ? filters.location_aliases.map(String) : []),
    ...locations.flatMap(areaAliases),
  ];
  return aliases.length ? { ...filters, location_aliases: [...new Set(aliases)] } : filters;
}
