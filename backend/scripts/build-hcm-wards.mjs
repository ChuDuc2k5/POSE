import fs from 'node:fs';
import path from 'node:path';

const [, , sourcePath = process.env.NQ1685_SOURCE || 'C:/Users/Admin/POSE-tasks/NQ1685-dieu1.txt'] = process.argv;
const output = path.resolve('backend/src/modules/ai/hcm-wards.ts');

const province = {
  hcm: 'TP.HCM',
  binhDuong: 'Bình Dương',
  baRia: 'Bà Rịa - Vũng Tàu',
};

function titleDistrict(value) {
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return text.replace(/^(quận|huyện|thị xã|thành phố)\s+/iu, match => {
    const prefix = match.trim().toLocaleLowerCase('vi');
    return `${prefix === 'quận' ? 'Quận' : prefix === 'huyện' ? 'Huyện' : prefix === 'thị xã' ? 'Thị xã' : 'Thành phố'} `;
  });
}

function parseItems(text) {
  const items = new Map();
  for (const match of text.matchAll(/(?:^|\s)(\d+)\.\s+([\s\S]*?)(?=\s+\d+\.\s+|$)/gu)) {
    const number = Number(match[1]);
    if (number >= 1 && number <= 163 && !items.has(number)) items.set(number, match[2].trim());
  }
  return items;
}

function target(statement) {
  const match = statement.match(/có tên gọi là\s+(phường|xã|đặc khu)\s+([^.;]+?)(?:\.|$)/iu);
  if (!match) throw new Error(`Cannot parse target ward: ${statement}`);
  return { kind: match[1].toLocaleLowerCase('vi'), ward: match[2].trim().normalize('NFC') };
}

function formerWards(statement) {
  const targetIndex = statement.search(/(?:thành\s+)?(?:phường|xã|đặc khu)\s+(?:mới\s+)?có tên gọi là\s+/iu);
  const beforeTarget = statement.slice(0, targetIndex < 0 ? statement.length : targetIndex);
  const wards = [];
  const addWard = value => {
    for (const part of value.split(/\s+và\s+/giu)) {
      let ward = part.trim().normalize('NFC').replace(/\s*\([^)]*\)/gu, '').replace(/^(?:một phần|phần còn lại).*?\b(?:phường|xã|thị trấn)\s+/iu, '').replace(/^(?:phường|xã|thị trấn|huyện)\s+/iu, '').replace(/\s+sau khi\b[\s\S]*$/iu, '').replace(/^Phường\s+(\d+)$/iu, '$1').replace(/^Xã\s+(\d+)$/iu, '$1');
      if (!/(?:diện tích|quy mô|của|mới|theo quy định)/iu.test(ward) && ward && !wards.includes(ward)) wards.push(ward);
    }
  };
  for (const match of beforeTarget.matchAll(/các\s+(?:phường|xã)\s+([\s\S]*?)(?=\s+(?:thành|sau khi)\b|\s*$)/giu)) {
    for (const part of match[1].split(/,|\s+và\s+/giu)) {
      if (!/(?:một phần|phần còn lại|diện tích|quy mô| của )/iu.test(part)) addWard(part.replace(/^(?:phường|xã)\s+/iu, ''));
    }
  }
  for (const match of beforeTarget.matchAll(/(?:phường|xã|thị trấn|huyện)\s+([^,.;()]+?)(?=\s*(?:\([^)]*\))?(?:,| và | sau khi|$))/giu)) {
    addWard(match[1]);
  }
  const final = beforeTarget.match(/(?:phường|xã|thị trấn|huyện)\s+([^,.;()]+?)(?:\s*\([^)]*\))?\s*$/iu);
  if (final) addWard(final[1]);
  return wards;
}

function sourceProvince(number) {
  if ((number >= 1 && number <= 78) || (number >= 113 && number <= 135)) return province.hcm;
  if ((number >= 79 && number <= 101) || (number >= 136 && number <= 147)) return province.binhDuong;
  return province.baRia;
}

function defaultDistricts(number) {
  if (number <= 4) return ['Quận 1'];
  if (number <= 7) return ['Quận 3'];
  if (number <= 10) return ['Quận 4'];
  if (number <= 13) return ['Quận 5'];
  if (number <= 17) return ['Quận 6'];
  if (number <= 21) return ['Quận 7'];
  if (number <= 24) return ['Quận 8'];
  if (number <= 27) return ['Quận 10'];
  if (number <= 31) return ['Quận 11'];
  if (number <= 36) return ['Quận 12'];
  if (number <= 41) return ['Quận Bình Tân'];
  if (number <= 46) return ['Quận Bình Thạnh'];
  if (number <= 52) return ['Quận Gò Vấp'];
  if (number <= 55) return ['Quận Phú Nhuận'];
  if (number <= 61) return ['Quận Tân Bình'];
  if (number <= 66) return ['Quận Tân Phú'];
  if (number <= 70) return ['Thủ Đức'];
  if (number <= 74) return ['Quận 9'];
  if (number <= 78) return ['Quận 2'];
  if (number <= 80) return ['Thành phố Dĩ An'];
  if (number <= 86) return ['Thành phố Thuận An'];
  if (number <= 90) return ['Thành phố Thủ Dầu Một'];
  if (number <= 97) return ['Thành phố Bến Cát'];
  if (number <= 101) return ['Thành phố Tân Uyên'];
  if (number <= 105) return ['Thành phố Vũng Tàu'];
  if (number <= 108) return ['Thành phố Bà Rịa'];
  if (number <= 112) return ['Thành phố Phú Mỹ'];
  if (number <= 119) return ['Huyện Bình Chánh'];
  if (number <= 122) return ['Huyện Cần Giờ'];
  if (number <= 129) return ['Huyện Củ Chi'];
  if (number <= 133) return ['Huyện Hóc Môn'];
  if (number <= 135) return ['Huyện Nhà Bè'];
  if (number <= 137) return ['Huyện Bắc Tân Uyên'];
  if (number <= 140) return ['Huyện Phú Giáo'];
  if (number <= 143) return ['Huyện Bàu Bàng'];
  if (number <= 147) return ['Huyện Dầu Tiếng'];
  if (number <= 148) return ['Thành phố Phú Mỹ'];
  if (number <= 151) return ['Huyện Long Điền'];
  if (number === 152) return ['Huyện Đất Đỏ', 'Huyện Long Đất'];
  if (number <= 158) return ['Huyện Châu Đức'];
  if (number <= 162) return ['Huyện Xuyên Mộc'];
  return ['Huyện Côn Đảo'];
}

const districtOverrides = new Map([
  [16, ['Quận 6', 'Quận 8']],
  [24, ['Quận 8', 'Huyện Bình Chánh']],
  [77, ['Quận 9']],
  [81, ['Thành phố Dĩ An', 'Thành phố Tân Uyên']],
  [93, ['Thành phố Bến Cát', 'Huyện Dầu Tiếng']],
  [95, ['Thành phố Bến Cát', 'Huyện Bàu Bàng']],
  [98, ['Huyện Bắc Tân Uyên', 'Thành phố Tân Uyên']],
  [114, ['Huyện Bình Chánh', 'Quận Bình Tân']],
  [116, ['Huyện Bình Chánh', 'Quận Bình Tân', 'Quận 8']],
  [119, ['Huyện Bình Chánh', 'Quận 8']],
]);

function districts(number) {
  return [...new Set((districtOverrides.get(number) || defaultDistricts(number)).map(titleDistrict))];
}

function resolutionRows(text) {
  const entries = parseItems(text);
  const rows = [];
  for (const number of [...entries.keys()].sort((a, b) => a - b)) {
    const statement = entries.get(number);
    const { ward, kind } = target(statement);
    rows.push({ ward, kind, formerWards: formerWards(statement), formerDistricts: districts(number), formerProvince: sourceProvince(number) });
  }
  rows.push(
    { ward: 'Thới Hòa', kind: 'phường', formerWards: ['Thới Hòa'], formerDistricts: ['Thành phố Bến Cát'], formerProvince: province.binhDuong },
    { ward: 'Long Sơn', kind: 'xã', formerWards: ['Long Sơn'], formerDistricts: ['Thành phố Vũng Tàu'], formerProvince: province.baRia },
    { ward: 'Hòa Hiệp', kind: 'xã', formerWards: ['Hòa Hiệp'], formerDistricts: ['Huyện Xuyên Mộc'], formerProvince: province.baRia },
    { ward: 'Bình Châu', kind: 'xã', formerWards: ['Bình Châu'], formerDistricts: ['Huyện Xuyên Mộc'], formerProvince: province.baRia },
    { ward: 'Thạnh An', kind: 'xã', formerWards: ['Thạnh An'], formerDistricts: ['Huyện Cần Giờ'], formerProvince: province.hcm },
  );
  return rows;
}

if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error(`Official source not found: ${sourcePath}`);
const rows = resolutionRows(fs.readFileSync(sourcePath, 'utf8').normalize('NFC'));
if (rows.length !== 168) throw new Error(`Expected 168 HCMC units, parsed ${rows.length}`);
if (new Set(rows.map(row => row.ward)).size !== rows.length) throw new Error('Duplicate new ward name in official mapping');

const source = `// Generated by backend/scripts/build-hcm-wards.mjs. Do not edit by hand.\nexport type HcmWard = { ward: string; kind: 'phường'|'xã'|'đặc khu'; formerDistricts: string[]; formerWards: string[]; formerProvince: 'TP.HCM'|'Bình Dương'|'Bà Rịa - Vũng Tàu' };\nexport const hcmWards: HcmWard[] = ${JSON.stringify(rows, null, 2)};\nexport const hcmWardCount = hcmWards.length;\n`;
fs.writeFileSync(output, source, 'utf8');
const counts = Object.fromEntries(Object.entries(province).map(([, value]) => [value, rows.filter(row => row.formerProvince === value).length]));
console.log(`generated ${rows.length} wards`);
console.log(JSON.stringify(counts));
