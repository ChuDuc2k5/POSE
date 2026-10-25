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
  return /thuê/iu.test(message)
    ? 'Ngân sách thuê của bạn khoảng bao nhiêu mỗi tháng? Có thêm tên đường hay phường mong muốn thì mình lọc sát hơn nhé.'
    : 'Bạn dự kiến ngân sách khoảng bao nhiêu? Có thêm tên đường hay phường mong muốn thì mình lọc sát hơn nhé.';
}
type HistorySource = { price?: number | null };
type HistoryTurn = { role: string; content: string; sources?: HistorySource[] };
export type BudgetFollowUp = { filters: ReturnType<typeof inferSearch> & { location?: string; locations?: string[] }; direction: 'cheaper' | 'higher' };
const cheaperBudget = /(?:rẻ hơn|giá thấp hơn|mềm hơn|thấp hơn|bớt tiền|tiết kiệm hơn|có căn nào rẻ hơn)/iu;
const higherBudget = /(?:đắt hơn|cao hơn|cao cấp hơn|tăng ngân sách|ngân sách cao hơn|xịn hơn)/iu;
const previousSearch = (history: { role: string; content: string }[]) => {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role !== 'user') continue;
    const inferred = inferSearch(history[i].content);
    if (inferred) return inferred;
  }
  return {};
};
export function budgetFollowUp(message: string, history: HistoryTurn[]): BudgetFollowUp | null {
  const explicit = inferSearch(message);
  const cheaper = cheaperBudget.test(message);
  const higher = higherBudget.test(message);
  if (!cheaper && !higher && !explicit?.minPrice && !explicit?.maxPrice) return null;
  const prior = previousSearch(history);
  if (!Object.keys(prior).length) return null;
  const filters = { ...prior, ...(explicit || {}) } as BudgetFollowUp['filters'];
  // Assistant prose echoes customer budgets and contains other numbers. Only
  // structured catalogue prices are authoritative for a budget adjustment.
  const previousSources = [...history].reverse().find(turn => turn.role === 'assistant' && Array.isArray(turn.sources))?.sources || [];
  const shownPrices = previousSources.map(source => source.price).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (cheaper) {
    const candidates = (shownPrices.length ? shownPrices : [prior.maxPrice]).filter((value): value is number => Number.isFinite(value));
    if (candidates.length) filters.maxPrice = Math.max(0, Math.floor(Math.min(...candidates) * 0.9));
    delete filters.minPrice;
  } else if (higher) {
    const candidates = (shownPrices.length ? shownPrices : [prior.maxPrice, prior.minPrice]).filter((value): value is number => Number.isFinite(value));
    if (candidates.length) filters.minPrice = Math.max(...candidates) + 1;
    delete filters.maxPrice;
  }
  return { filters, direction: cheaper ? 'cheaper' : 'higher' };
}
export function clarificationFor(message: string, history: { role: string; content: string }[]): Clarification {
  const ownerText=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
  if (/(?:cho\s+thue\s+(?:nha|can)|dang\s+tin|tim\s+nguoi\s+thue|ky\s+gui|ban\s+nha\s+cua\s+toi|muon\s+cho\s+thue|ban\s+nha\s+qua|nho\s+ban|phi\s+moi\s+gioi|hoa\s+hong)/u.test(ownerText)) return { needed: false, question: null, options: [] };
  // A named listing ("Đặt lịch xem căn RVL-…") or a booking/saving request is never a new search.
  // A question about the listing just discussed ("Tiền cọc mấy tháng?") is answered from that listing.
  if (referencedListingCodes(message, history).codes.length) return { needed: false, question: null, options: [] };
  if (!searchIntent.test(message) || budgetFollowUp(message, history) || locationPattern.test(message) || namesPlace(message) || isFollowUp(message) || listingCodes(message).length || /(?<![\p{L}])(?:đặt\s+lịch|hẹn\s+xem|lưu\s+căn|yêu\s+thích|liên\s+hệ|chuyên\s+viên)(?![\p{L}])/iu.test(message)) return { needed: false, question: null, options: [] };
  const location = previousSearchLocation(history);
  const inferred = inferSearch(message) || {};
  const hasBudget = inferred.minPrice !== undefined || inferred.maxPrice !== undefined;
  const concrete = /(?:\d+\s*(?:m²|m2|m\s*2|phòng|pn)|diện\s+tích|nội\s+thất|đầy\s+đủ|nguyên\s+căn|kinh\s+doanh|trong\s+\d+\s+tháng|hợp\s+đồng(?:\s+ngắn)?\s+hạn|dự\s+án|tên\s+(?:dự\s+án|khu)|khoảng\s+\d+)/iu.test(message);
  // A new search must establish the two fields that make a catalogue search useful.
  const previousAssistant = [...history].reverse().find(turn => turn.role === 'assistant')?.content || '';
  const previousWasClarification = /khu vực nào|ngân sách.*(?:tháng|triệu|tỷ)|chưa rõ,? gợi ý/iu.test(previousAssistant);
  const kind = /chung\s+cư|căn\s+hộ/iu.test(message) ? 'chung cư' : /đất/iu.test(message) ? 'đất' : 'nhà';
  if (!location && !hasBudget && !concrete && (!history.length || !previousWasClarification)) return {
    needed: true,
    question: /thuê/iu.test(message) ? `Bạn đang tìm ${kind} thuê ở khu vực nào (quận, phường hay tuyến đường) và ngân sách khoảng bao nhiêu mỗi tháng ạ? Nếu chưa chắc, mình gợi ý vài khu phù hợp nhé.` : `Bạn đang tìm mua ${kind} ở khu vực nào (quận, phường hay tuyến đường) và ngân sách khoảng bao nhiêu ạ? Nếu chưa chắc, mình gợi ý vài khu phù hợp nhé.`,
    options: /thuê/iu.test(message) ? ['Dưới 10 triệu', '10–20 triệu', 'Chưa rõ, gợi ý giúp tôi'] : ['Dưới 3 tỷ', '3–6 tỷ', 'Chưa rõ, gợi ý giúp tôi'],
  };
  // A budget alone is concrete enough to search; the area question can follow the results.
  if (!location && hasBudget) return { needed: false, question: null, options: [] };
  if (!location) return { needed: false, question: null, options: [] };
  if (!hasBudget && !locationPattern.test(message) && !namesPlace(message)) {
    const action = /thuê/iu.test(message) ? 'thuê' : /mua/iu.test(message) ? 'mua' : 'tìm';
    return { needed: true, question: `Bạn muốn ${action} ở ${location} như trước hay khu vực khác?`, options: [location, 'Khu vực khác', 'Không giới hạn khu vực'] };
  }
  if (!hasBudget) return { needed: false, question: null, options: [] };
  const action = /thuê/iu.test(message) ? 'thuê' : /mua/iu.test(message) ? 'mua' : 'tìm';
  return { needed: true, question: `Bạn muốn ${action} ở ${location} như trước hay khu vực khác?`, options: [location, 'Khu vực khác', 'Không giới hạn khu vực'] };
}
