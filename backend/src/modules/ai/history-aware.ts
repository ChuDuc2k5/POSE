import { hcmWards } from './hcm-wards.js';
import { inferSearch } from './infer-search.js';

export type Clarification = { needed: boolean; question: string | null; options: string[] };
const listingCodePattern = /(?<![\p{L}\d])[A-Z][A-Z\d]{0,7}-[A-Z\d]{4,40}(?![\p{L}\d])/gu;
const searchIntent = /(?:căn|nhà|đất|phòng|mua|thuê|tìm|bất động sản|giá|chung cư|villa|shop|office)/iu;
const locationPattern = /(?:quận|q\.?\s*\d{1,2}|huyện|thủ\s*đức|phường|xã|thành phố|tp\.?\s*hồ\s*chí\s*minh|hcm|sài\s*gòn)/iu;
// "căn hộ này", "nhà đó", "dự án này"… point back at the listing discussed in the previous turn.
// "quan tâm căn …", "chọn căn …" pick one of the listings just shown.
const backReference = /(?<![\p{L}])(?:(?:căn(?:\s+hộ)?|can(?:\s+ho)?|nhà|nha|đất|dat|lô\s+đất|dự\s+án|du\s+an)\s+(?:này|nay|đó|vừa\s+rồi|trên|kia)|quan\s+tâm|quan\s+tam|(?:chọn|lấy|thích)\s+căn)(?![\p{L}])/iu;
export function isFollowUp(message: string) { return backReference.test(message); }
// A message that starts a new search is not a follow-up even without new location or price words.
const newSearch = /(?<![\p{L}])(?:tìm|kiếm|có\s+căn\s+nào|còn\s+căn|gợi\s+ý|(?:muốn|cần)\s+(?:mua|thuê))(?![\p{L}])/iu;
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
  if (newSearch.test(message)) return { codes: [] as string[], ambiguous: false };
  // Right after one listing was discussed, a question without a new search ("Tiền cọc mấy tháng?",
  // "Khu này có ngập không?") is about that listing.
  const last = listingCodes(history[history.length - 1]?.content || '');
  if (!backReference.test(message)) return last.length === 1 ? { codes: last, ambiguous: false } : { codes: [] as string[], ambiguous: false };
  for (let i = history.length - 1; i >= 0; i--) {
    const codes = listingCodes(history[i]?.content || '');
    if (codes.length) return { codes, ambiguous: codes.length > 1 };
  }
  return { codes: [] as string[], ambiguous: false };
}
// A project, area or new ward name is a location too ("Vinhomes Grand Park", "Phú Mỹ Hưng", "Phường Long Bình").
const placeNames = /(?<![\p{L}])(?:vinhomes|grand\s+park|masteri|midtown|sunrise|sky\s+garden|phú\s+mỹ\s+hưng|thảo\s+điền|thủ\s+thiêm|landmark|vạn\s+phúc|celadon|eco\s*green|gò\s+vấp|bình\s+thạnh|tân\s+bình|tân\s+phú|phú\s+nhuận|bình\s+tân|nhà\s+bè|củ\s+chi|hóc\s+môn|bình\s+chánh|cần\s+giờ|vũng\s+tàu|bình\s+dương|khu\s+đô\s+thị|dự\s+án)(?![\p{L}])/iu;
function namesPlace(message: string) {
  const text = message.normalize('NFC').toLocaleLowerCase('vi');
  return placeNames.test(message.normalize('NFC')) || hcmWards.some(row => text.includes(row.ward.normalize('NFC').toLocaleLowerCase('vi')));
}
export function missingBudgetQuestion(message: string, history: { role: string; content: string }[]) {
  if (!searchIntent.test(message) || isFollowUp(message) || listingCodes(message).length) return null;
  const directLocation = locationPattern.test(message) || namesPlace(message);
  if (!directLocation) return null;
  const inferred = inferSearch(message) || {};
  if (inferred.minPrice !== undefined || inferred.maxPrice !== undefined) return null;
  return 'Bạn dự kiến ngân sách khoảng bao nhiêu? Nếu thuê, bạn có thể cho biết mức thuê mỗi tháng; nếu muốn, tôi cũng có thể gợi ý thêm tuyến đường phù hợp.';
}
export function clarificationFor(message: string, history: { role: string; content: string }[]): Clarification {
  // A named listing ("Đặt lịch xem căn RVL-…") or a booking/saving request is never a new search.
  if (!searchIntent.test(message) || locationPattern.test(message) || namesPlace(message) || isFollowUp(message) || listingCodes(message).length || /(?<![\p{L}])(?:đặt\s+lịch|hẹn\s+xem|lưu\s+căn|yêu\s+thích|liên\s+hệ|chuyên\s+viên)(?![\p{L}])/iu.test(message)) return { needed: false, question: null, options: [] };
  const location = previousSearchLocation(history);
  const inferred = inferSearch(message) || {};
  const hasBudget = inferred.minPrice !== undefined || inferred.maxPrice !== undefined;
  // A new search must establish the two fields that make a catalogue search useful.
  // Vague follow-ups are deliberately handled by the normal search path so they do not loop.
  if (!location && !hasBudget && history.length === 0) return {
    needed: true,
    question: 'Bạn muốn tìm ở khu vực nào và ngân sách khoảng bao nhiêu? Bạn có thể chọn khu vực phổ biến hoặc nói “Chưa rõ, gợi ý giúp tôi”.',
    options: ['Thủ Đức', 'Quận 7', 'Chưa rõ, gợi ý giúp tôi'],
  };
  if (!location && !hasBudget && history.length > 0) return { needed: false, question: null, options: [] };
  if (!location && hasBudget) return {
    needed: true,
    question: 'Bạn muốn tìm ở khu vực nào? Bạn có thể chọn khu vực phổ biến hoặc nói “Chưa rõ, gợi ý giúp tôi”.',
    options: ['Thủ Đức', 'Quận 7', 'Chưa rõ, gợi ý giúp tôi'],
  };
  if (!location) return { needed: false, question: null, options: [] };
  if (!hasBudget && !locationPattern.test(message) && !namesPlace(message)) {
    const action = /thuê/iu.test(message) ? 'thuê' : /mua/iu.test(message) ? 'mua' : 'tìm';
    return { needed: true, question: `Bạn muốn ${action} ở ${location} như trước hay khu vực khác?`, options: [location, 'Khu vực khác', 'Không giới hạn khu vực'] };
  }
  if (!hasBudget) return { needed: false, question: null, options: [] };
  const action = /thuê/iu.test(message) ? 'thuê' : /mua/iu.test(message) ? 'mua' : 'tìm';
  return { needed: true, question: `Bạn muốn ${action} ở ${location} như trước hay khu vực khác?`, options: [location, 'Khu vực khác', 'Không giới hạn khu vực'] };
}
