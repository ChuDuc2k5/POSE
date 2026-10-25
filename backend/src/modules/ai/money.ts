import { stripPhones } from './privacy.ts';

const unitPattern = '(?:t\u1ef7|t\u1ec9|ty|tri\u1ec7u|tr|ngh\u00ecn|ng\u00e0n|k|vnd|\u0111\u1ed3ng)';
const numberPattern = '(\\d{1,3}(?:[., ]\\d{3})+(?:[,.]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
const words: Record<string, number> = { 'm\u1ed9t': 1, hai: 2, ba: 3, 'b\u1ed1n': 4, 'n\u0103m': 5, 's\u00e1u': 6, 'b\u1ea3y': 7, 't\u00e1m': 8, 'ch\u00edn': 9, 'm\u01b0\u1eddi': 10 };

function numeric(raw: string) {
  const grouped = /^\d{1,3}(?:[., ]\d{3})+$/.test(raw);
  const decimalGroups = raw.match(/^(\d{1,3}(?:[., ]\d{3})+)([,.]\d{1,2})$/);
  const value = grouped ? raw.replace(/[., ]/g, '') : decimalGroups ? decimalGroups[1].replace(/[., ]/g, '') + '.' + decimalGroups[2].slice(1) : raw.replace(/ /g, '').replace(',', '.');
  return Number(value);
}
function multiplier(unit: string) {
  if (/^(t\u1ef7|t\u1ec9|ty)$/i.test(unit)) return 1e9;
  if (/^(tri\u1ec7u|tr)$/i.test(unit)) return 1e6;
  if (/^(ngh\u00ecn|ng\u00e0n|k)$/i.test(unit)) return 1e3;
  return 1;
}

export function moneyAmounts(text: string): number[] {
  const amounts: number[] = [], consumed: [number, number][] = [];
  const wordPattern = '(' + Object.keys(words).join('|') + ')\\s+(' + unitPattern + ')';
  const source = stripPhones(text).replace(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi, '').replace(new RegExp(wordPattern, 'giu'), (_, word: string, unit: string) => words[word.toLowerCase()] + ' ' + unit);
  const add = (start: number, end: number, value: number) => { if (Number.isFinite(value)) { amounts.push(Math.round(value * 100) / 100); consumed.push([start, end]); } };
  const billion = new RegExp('(?<![a-z\\d_])(' + numberPattern + ')\\s*(t\u1ef7|t\u1ec9|ty)(?:\\s*(' + numberPattern + ')\\s*(tri\u1ec7u|tr)|\\s+(' + numberPattern + ')(?=\\s|$))?', 'giu');
  for (const match of source.matchAll(billion)) add(match.index!, match.index! + match[0].length, numeric(match[1]) * 1e9 + (match[4] ? numeric(match[4]) * 1e6 : match[7] ? numeric(match[7]) * 1e8 : 0));
  const million = new RegExp('(?<![a-z\\d_])(' + numberPattern + ')\\s*(tri\u1ec7u|tr)\\s*(' + numberPattern + ')\\s*(ngh\u00ecn|ng\u00e0n|k)?(?![a-z\\d])', 'giu');
  for (const match of source.matchAll(million)) if (!consumed.some(([start, end]) => match.index! >= start && match.index! < end)) add(match.index!, match.index! + match[0].length, numeric(match[1]) * 1e6 + numeric(match[4]) * (match[6] ? multiplier(match[6]) : 1e5));
  const pattern = new RegExp('(?<![a-z\\d_])(' + numberPattern + ')\\s*(' + unitPattern + ')?(?![a-z\\d])', 'giu');
  for (const match of source.matchAll(pattern)) {
    if (consumed.some(([start, end]) => match.index! >= start && match.index! < end)) continue;
    const raw = match[1], unit = match[3]?.toLowerCase();
    if (!unit && !/[., ]\\d{3}/.test(raw) && raw.length < 7) continue;
    add(match.index!, match.index! + match[0].length, numeric(raw) * (unit ? multiplier(unit) : 1));
  }
  return amounts;
}
