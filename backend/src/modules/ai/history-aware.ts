import { hcmWards } from './hcm-wards.js';

export type Clarification = { needed: boolean; question: string | null; options: string[] };
const listingCodePattern = /(?<![\p{L}\d])[A-Z][A-Z\d]{0,7}-[A-Z\d]{4,40}(?![\p{L}\d])/gu;
const searchIntent = /(?:căn|nhà|đất|phòng|mua|thuê|tìm|bất động sản|giá|chung cư|villa|shop|office)/iu;
const locationPattern = /(?:quận|q\.?\s*\d{1,2}|huyện|thủ\s*đức|phường|xã|thành phố|tp\.?\s*hồ\s*chí\s*minh|hcm|sài\s*gòn)/iu;
const backReference = /(?<![\p{L}])(?:căn|nhà|đất|dự án)\s+(?:này|nay|đó|vừa rồi|trên)|(?<![\p{L}])(?:đất|dự án)\s+này/iu;
const newCriteria = /(?:quận|q\.?\s*\d|huyện|thủ\s*đức|phường|xã|dưới|trên|từ|tối đa|ngân sách|triệu|tỷ|tỉ|mua|thuê|bán|phòng ngủ|diện tích)/iu;
const district = (value: string) => {
  const match = value.normalize('NFC').match(/(?:quận|q\.?|district)\s*(\d{1,2})/iu);
  return match ? `Quận ${match[1]}` : /thủ\s*đức/iu.test(value) ? 'Thủ Đức' : null;
};
export function previousSearchLocation(history: { role: string; content: string }[]) {
  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i]?.content || '';
    const direct = district(content);
    if (direct) return direct;
    for (const row of hcmWards) if (content.toLocaleLowerCase('vi').includes(row.ward.toLocaleLowerCase('vi'))) return row.ward;
  }
  return null;
}
export function listingCodes(text: string) { return [...new Set(text.match(listingCodePattern) || [])]; }
export function referencedListingCodes(message: string, history: { role: string; content: string }[]) {
  const direct = listingCodes(message);
  if (direct.length) return { codes: direct, ambiguous: false };
  if (!backReference.test(message) || newCriteria.test(message)) return { codes: [] as string[], ambiguous: false };
  for (let i = history.length - 1; i >= 0; i--) {
    const codes = listingCodes(history[i]?.content || '');
    if (codes.length) return { codes, ambiguous: codes.length > 1 };
  }
  return { codes: [] as string[], ambiguous: false };
}
export function clarificationFor(message: string, history: { role: string; content: string }[]): Clarification {
  if (!searchIntent.test(message) || locationPattern.test(message)) return { needed: false, question: null, options: [] };
  const location = previousSearchLocation(history);
  if (!location) return { needed: false, question: null, options: [] };
  const action = /thuê/iu.test(message) ? 'thuê' : /mua/iu.test(message) ? 'mua' : 'tìm';
  return { needed: true, question: `Bạn muốn ${action} ở ${location} như trước hay khu vực khác?`, options: [location, 'Khu vực khác', 'Không giới hạn khu vực'] };
}
