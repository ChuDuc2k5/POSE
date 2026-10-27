import { hcmWards, type HcmWard } from './hcm-wards.js';

const prefix = /^(?:quận|q\.?|huyện|thị xã|thành phố|tp\.?|phường|xã)\s+/iu;

function normalizeArea(value: string) {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/\b(?:q\.?|quận|district)\s*(\d{1,2})\b/giu, '$1')
    .replace(/\b(?:huyện|thị xã|thành phố|tp\.?|phường|xã|đặc khu)\s+/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function cleanAreaText(value: string) {
  return value.normalize('NFC').split(',')[0].trim();
}

function addWardAliases(rows: HcmWard[]) {
  const aliases: string[] = [];
  const add = (value: string) => { if (value && !aliases.includes(value)) aliases.push(value); };
  for (const row of rows) {
    add(row.ward);
    add(`${row.kind === 'xã' ? 'Xã' : row.kind === 'đặc khu' ? 'Đặc khu' : 'Phường'} ${row.ward}`);
    for (const formerWard of row.formerWards) if (!/^\d+$/u.test(formerWard.trim())) add(formerWard);
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
  const explicitKind = clean.match(/^(phường|xã|đặc khu)\s+(.+)$/iu)?.[1]?.toLocaleLowerCase('vi');

  if (normalized === 'phú mỹ hưng') {
    return ['Tân Mỹ', 'Phường Tân Mỹ', 'Tân Hưng', 'Phường Tân Hưng', 'Tân Phong', 'Phường Tân Phong', 'Phú Mỹ Hưng'];
  }
  if (normalized === 'bình dương') return addWardAliases(rowsForFormerProvince('Bình Dương'));
  if (normalized === 'vũng tàu') return addWardAliases(rowsForDistrict('vũng tàu'));
  if (normalized === 'bà rịa') return addWardAliases(rowsForDistrict('bà rịa'));
  if (normalized === 'thủ đức' && explicitKind !== 'phường') {
    return addWardAliases(hcmWards.filter(row => row.formerDistricts.some(district => ['Quận 2', 'Quận 9', 'Thủ Đức'].includes(district))));
  }

  const districtRows = rowsForDistrict(normalized);
  if (!explicitKind && districtRows.some(row => row.formerProvince === 'TP.HCM')) return addWardAliases(districtRows);

  const ward = hcmWards.find(row => normalizeArea(row.ward) === normalized && (!explicitKind || explicitKind === row.kind));
  if (ward) return addWardAliases([ward]);

  if (districtRows.length) return addWardAliases(districtRows);
  return [];
}
