import { readFile } from 'node:fs/promises';

const input =
  process.argv.find((arg) => !arg.startsWith('-') && arg.endsWith('.json')) ||
  'C:/Users/Admin/POSE-tasks/rag-real-snapshot.json';
const rechunk = process.argv.includes('--rechunk');
const rows = JSON.parse(await readFile(input, 'utf8'));
if (!Array.isArray(rows)) throw new Error('Expected a JSON array');
const money =
  /(?:\d[\d., ]*\s*(?:ty|t\u1ef7|t\u00e1\u00bb\u00b7|t\u00e1\u00bb\u0089|trieu|tri\u1ec7u|tri\u00e1\u00bb\u0087u|tr\.?(?!\p{L})|nghin|ngh\u00ecn|k(?!m\b)(?!\p{L})|vnd\b|dong|\u0111ong|\u0111\u1ed3ng|\u00c4\u0091\u00c3\u00b2ng|\u0111(?!\p{L})|\u00c4\u0091(?!\p{L})|\u20ab)(?:\s*\/\s*(?:thang|th\u00e1ng|nam|n\u0103m))?|(?:gia|gi\u00e1|gi\u00c3\u00a1|muc\s*gia|m\u1ee9c\s*gi\u00e1|thuong\s*luong|th\u01b0\u01a1ng\s*l\u01b0\u1ee3ng)\s*(?:[:：-]?\s*)?(?:thoa\s*thuan|th\u1ecfa\s*thu\u1eadn|lien\s*he|li\u00ean\s*h\u1ec7))/iu;
const clean = (value) =>
  String(value || '')
    .split(/(?<=[.!?;])\s+|\n|,/u)
    .filter((part) => !money.test(part))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
const audited = rows.map((row) => ({ ...row, content: rechunk ? clean(row.content) : row.content }));
const offenders = audited.flatMap((row) => {
  const text = String(row.content || '');
  const match = text.match(money);
  return match ? [{ code: row.code || row.id || '(unknown)', snippet: match[0] }] : [];
});
console.log(`price-audit: ${offenders.length} chunks still contain money amounts`);
for (const offender of offenders) console.log(`${offender.code}: ${offender.snippet}`);
