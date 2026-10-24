import { hcmWards } from './hcm-wards.js';

export type Clarification = { needed: boolean; question: string | null; options: string[] };
const listingCodePattern = /(?<![\p{L}\d])[A-Z][A-Z\d]{0,7}-[A-Z\d]{4,40}(?![\p{L}\d])/gu;
const searchIntent = /(?:c\u0103n|nh\u00e0|\u0111\u1ea5t|ph\u00f2ng|mua|thu\u00ea|t\u00ecm|b\u1ea5t \u0111\u1ed9ng s\u1ea3n|gi\u00e1|chung c\u01b0|villa|shop|office)/iu;
const locationPattern = /(?:qu\u1eadn|q\.?\s*\d{1,2}|huy\u1ec7n|th\u1ee7\s*\u0111\u1ee9c|ph\u01b0\u1eddng|x\u00e3|th\u00e0nh ph\u1ed1|tp\.?\s*h\u1ed3\s*ch\u00ed\s*minh|hcm|s\u00e0i\s*g\u00f2n)/iu;
const district = (value: string) => {
  const match = value.normalize('NFC').match(/(?:qu\u1eadn|q\.?|district)\s*(\d{1,2})/iu);
  return match ? `Qu\u1eadn ${match[1]}` : /th\u1ee7\s*\u0111\u1ee9c/iu.test(value) ? 'Th\u1ee7 \u0110\u1ee9c' : null;
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
  for (let i = history.length - 1; i >= 0; i--) {
    const codes = listingCodes(history[i]?.content || '');
    if (!codes.length) continue;
    if (codes.length > 1 && /(?:c\u0103n|nh\u00e0|\u0111\u1ea5t)\s+(?:n\u00e0y|nay)/iu.test(message)) return { codes, ambiguous: true };
    const ambiguous = codes.length > 1 && /\b(?:cÄƒn|can|nhÃ |nha|Ä‘áº¥t|dat)\s+(?:nÃ y|nay)/iu.test(message);
    return { codes, ambiguous };
  }
  return { codes: [] as string[], ambiguous: false };
}
export function clarificationFor(message: string, history: { role: string; content: string }[]): Clarification {
  if (!searchIntent.test(message) || locationPattern.test(message)) return { needed: false, question: null, options: [] };
  const location = previousSearchLocation(history);
  if (!location) return { needed: false, question: null, options: [] };
  const action = /thu\u00ea/iu.test(message) ? 'thu\u00ea' : /mua/iu.test(message) ? 'mua' : 't\u00ecm';
  return { needed: true, question: `B\u1ea1n mu\u1ed1n ${action} \u1edf ${location} nh\u01b0 tr\u01b0\u1edbc hay khu v\u1ef1c kh\u00e1c?`, options: [location, 'Khu v\u1ef1c kh\u00e1c', 'Kh\u00f4ng gi\u1edbi h\u1ea1n khu v\u1ef1c'] };
}
