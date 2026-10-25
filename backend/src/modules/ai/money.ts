import { stripPhones } from './privacy.ts';

// `tr` is shorthand for triệu only at a word boundary; do not parse words such as "trệt".
const unitPattern = '(?:tỷ|tỉ|ty|triệu|tr(?![\\p{L}_])|nghìn|ngàn|k|vnd|đồng)';
const numberPattern = '(\\d{1,3}(?:[., ]\\d{3})+(?:[,.]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
const words: Record<string, number> = { 'một': 1, hai: 2, ba: 3, 'bốn': 4, 'năm': 5, 'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9, 'mười': 10 };

function numeric(raw: string) {
  const grouped = /^\d{1,3}(?:[., ]\d{3})+$/.test(raw);
  const decimalGroups = raw.match(/^(\d{1,3}(?:[., ]\d{3})+)([,.]\d{1,2})$/);
  const value = grouped ? raw.replace(/[., ]/g, '') : decimalGroups ? decimalGroups[1].replace(/[., ]/g, '') + '.' + decimalGroups[2].slice(1) : raw.replace(/ /g, '').replace(',', '.');
  return Number(value);
}
function multiplier(unit: string) {
  if (/^(tỷ|tỉ|ty)$/i.test(unit)) return 1e9;
  if (/^(triệu|tr)$/i.test(unit)) return 1e6;
  if (/^(nghìn|ngàn|k)$/i.test(unit)) return 1e3;
  return 1;
}

export function moneyAmounts(text: string): number[] {
  const amounts: number[] = [], consumed: [number, number][] = [];
  const wordPattern = '(' + Object.keys(words).join('|') + ')\\s+(' + unitPattern + ')';
  const source = stripPhones(text).replace(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi, '').replace(new RegExp(wordPattern, 'giu'), (_, word: string, unit: string) => words[word.toLowerCase()] + ' ' + unit);
  const add = (start: number, end: number, value: number) => { if (Number.isFinite(value)) { amounts.push(Math.round(value * 100) / 100); consumed.push([start, end]); } };
  const billion = new RegExp('(?<![\\p{L}\\p{N}_])(' + numberPattern + ')\\s*(tỷ|tỉ|ty)(?:\\s*(' + numberPattern + ')\\s*(triệu|tr)|\\s+(' + numberPattern + ')(?=\\s|$))?', 'giu');
  for (const match of source.matchAll(billion)) add(match.index!, match.index! + match[0].length, numeric(match[1]) * 1e9 + (match[4] ? numeric(match[4]) * 1e6 : match[7] ? numeric(match[7]) * 1e8 : 0));
  const million = new RegExp('(?<![\\p{L}\\p{N}_])(' + numberPattern + ')\\s*(triệu|tr(?![\\p{L}_]))\\s*(' + numberPattern + ')\\s*(nghìn|ngàn|k)?(?![\\p{L}\\p{N}_])', 'giu');
  for (const match of source.matchAll(million)) if (!consumed.some(([start, end]) => match.index! >= start && match.index! < end)) add(match.index!, match.index! + match[0].length, numeric(match[1]) * 1e6 + numeric(match[4]) * (match[6] ? multiplier(match[6]) : 1e5));
  const pattern = new RegExp('(?<![A-Za-z0-9_])(' + numberPattern + ')\\s*(' + unitPattern + ')?(?![\\p{L}\\p{N}_])', 'giu');
  for (const match of source.matchAll(pattern)) {
    if (consumed.some(([start, end]) => match.index! >= start && match.index! < end)) continue;
    const raw = match[1], unit = match[3]?.toLowerCase();
    if (!unit && !/[., ]\d{3}/.test(raw) && raw.length < 7) continue;
    add(match.index!, match.index! + match[0].length, numeric(raw) * (unit ? multiplier(unit) : 1));
  }
  return amounts;
}

export function priceLabel(price: number | null | undefined, monthly = false) {
  if (price === null || price === undefined) return 'chưa công bố';
  const short = (value: number) => String(value).replace('.', ',');
  const text = price >= 1e9 && price % 1e7 === 0 ? `${short(price / 1e9)} tỷ đồng`
    : price >= 1e9 && price % 1e6 === 0 ? `${Math.floor(price / 1e9)} tỷ ${(price % 1e9) / 1e6} triệu đồng`
    : price >= 1e6 && price < 1e9 && price % 1e4 === 0 ? `${short(price / 1e6)} triệu đồng`
    : `${Number(price).toLocaleString('vi-VN')} đồng`;
  return monthly ? `${text}/tháng` : text;
}
