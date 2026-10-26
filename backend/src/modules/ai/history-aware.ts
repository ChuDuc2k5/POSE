import { hcmWards } from './hcm-wards.js';
import { inferSearch } from './infer-search.js';

export type Clarification = { needed: boolean; question: string | null; options: string[] };
const listingCodePattern = /(?<![\p{L}\d])[A-Z][A-Z\d]{0,7}-[A-Z\d]{4,40}(?![\p{L}\d])/gu;
const searchIntent = /(?:căn|nhà|đất|phòng|mua|thuê|tìm|bất động sản|giá|chung cư|villa|shop|office)/iu;
const locationPattern = /(?:quận|q\.?\s*\d{1,2}|huyện|thủ\s*đức|phường|xã|thành phố|tp\.?\s*hồ\s*chí\s*minh|hcm|sài\s*gòn)/iu;
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLocaleLowerCase('vi');
const concreteFeatures: [RegExp, string][] = [
  [/nhan nha ngay|don vao o ngay/iu, 'nhận nhà ngay'],
  [/khu dan cu/iu, 'khu dân cư'],
  [/nho/iu, 'nhỏ'],
  [/vo chong/iu, 'vợ chồng'],
  [/truong hoc/iu, 'trường học'],
  [/benh vien/iu, 'bệnh viện'],
  [/cho(?! thue)/iu, 'chợ'],
  [/sieu thi/iu, 'siêu thị'],
  [/trung tam thuong mai/iu, 'trung tâm thương mại'],
  [/hem/iu, 'hẻm'],
  [/yen tinh/iu, 'yên tĩnh'],
  [/may lanh/iu, 'máy lạnh'],
  [/may giat/iu, 'máy giặt'],
  [/noi that/iu, 'nội thất'],
  [/dau o to|gara/iu, 'đậu ô tô'],
  [/tang thap/iu, 'tầng thấp'],
  [/tang cao/iu, 'tầng cao'],
  [/ban cong/iu, 'ban công'],
  [/\bview\b/iu, 'view'],
  [/ho boi/iu, 'hồ bơi'],
  [/\bgym\b/iu, 'gym'],
  [/thang may/iu, 'thang máy'],
  [/giam gia|ngop|cat lo|ha gia|chiet khau|gia tot|chi con/iu, 'giảm giá'],
];
concreteFeatures.push([/o to vao|xe hoi|hem xe hoi/iu, 'đậu ô tô']);
export function concreteSearchKeywords(message: string) {
  const text = fold(message);
  return [...new Set(concreteFeatures.filter(([pattern]) => pattern.test(text)).map(([, keyword]) => keyword))];
}
const informationQuestion = (text: string) => {
  const listingRequest = /(?:tim|kiem|muon mua|can mua|muon thue|can thue|goi y mua|goi y thue|co (?:can|nha|dat|bat dong san) nao)/iu.test(text);
  if (listingRequest) return false;
  return /(?:neu[\s\S]{0,80}thi|co chac|co dam|ban se[\s\S]{0,40}the nao|dua vao dau|nen tin|co phai[\s\S]{0,80}khong|khong muon[\s\S]{0,30}rui ro|chac chan sinh loi|tinh[\s\S]{0,40}(?:tien|chi phi|lai suat|khoan vay)|bao nhieu[\s\S]{0,40}(?:tien|chi phi|lai suat|khoan vay)|quy hoach|the chap|chu so huu|dat coc|hoan lai|dien tich[\s\S]{0,40}(?:hop dong|thuc te)|thue phi|con trong|cap nhat|du lieu[\s\S]{0,40}(?:kiem tra|thuc te)|xu ly[\s\S]{0,40}(?:the nao|ra sao))/iu.test(text);
};
export function adviceOrServiceQuestion(message: string) {
  const text = fold(message);
  if (/^hien tai ben minh co nhung (?:can|can ho|nha|bat dong san) nao dang (?:cho thue|ban)\s*\??$/iu.test(text)) return true;
  if (informationQuestion(text)) return true;
  // Process or advice wording is advice even when it mentions buying ("mua nhà lần đầu thì bắt đầu từ đâu").
  if (/tu van(?: giup)?|bat dau tu dau|thu tuc|giay to|lam (?:the nao|sao)|nen .+ hay .+/iu.test(text)
    && !/(?:co can|(?:can|can ho|chung cu|nha|nha pho|dat|dat nen|lo|lo dat|phong|phong tro|biet thu|van phong|bat dong san) nao)/iu.test(text)) return true;
  return /co ho tro|duoc khong/iu.test(text)
    // "Có đất nền nào ở Hóc Môn, đường ô tô vào được không?" asks for listings, not advice.
    && !/(?:co can|(?:can|can ho|chung cu|nha|nha pho|dat|dat nen|lo|lo dat|phong|phong tro|biet thu|van phong|bat dong san) nao|tim|mua|thue).*(?:duoc khong|co khong)/iu.test(text)
    // "Tôi muốn thuê nhà trong 6 tháng, có hỗ trợ hợp đồng ngắn hạn không?" also wants listings, with the FAQ.
    && !/(?:muon|can|dang tim) (?:thue|mua) (?:nha|can|chung cu|phong|dat|mat bang|van phong)/iu.test(text);
}
export function historyReferenceQuestion(message: string, history: { role: string; content: string }[]) {
  const text = fold(message);
  if (!history.some(turn => turn.role === 'assistant' && /(?:can|nha|lo|danh sach|gioi thieu|\[\d+\])/iu.test(fold(turn.content)))) return false;
  return /(?:can vua gioi thieu|ba can|bon can|cac can tren|nhung can tren|c[aă]n phia tren|nhung can vua)/iu.test(text);
}
export function genericSearchQuestion(message: string) {
  const text = fold(message);
  if (adviceOrServiceQuestion(message) || concreteSearchKeywords(message).length || /(?:\d+\s*(?:ty|trieu|tr)|quan\s*\d+|phuong|thu duc|binh thanh|tan phu|go vap)/iu.test(text)) return false;
  return /(?:gioi thieu|goi y|nhung|vai|co .*(?:can|nha|bat dong san)|can nao|nha nao|bat dong san nao)/iu.test(text);
}
export type CatalogueOverviewKind = 'areas' | 'types' | 'projects' | 'prices';
export function catalogueOverviewIntent(message: string): CatalogueOverviewKind | null {
  const text = fold(message);
  if (/(?:nhung|cac)\s+(?:du an|khu do thi)/iu.test(text)) return 'projects';
  if (/(?:gia|muc gia).*(?:nha|can|bat dong san)|(?:nha|can|bat dong san).*gia.*(?:bao nhieu|khoang)/iu.test(text)) return 'prices';
  if (/(?:khu vuc|o dau|nhung dau|nhung khu).*(?:bat dong san|bds|nha|can)|bat dong san.*(?:khu vuc|o dau)/iu.test(text)) return 'areas';
  if (/cho\s+thue/iu.test(text) || /(?:loai|bds|bat dong san)/iu.test(text) && /(?:ban|thue|cho thue|dang)/iu.test(text) || /bat dong san nao/iu.test(text)) return 'types';
  return null;
}
export function isMoreRequest(message: string) {
  return /(?:co\s+can\s+nao\s+khac|con\s+can\s+nao\s+nua|xem\s+them|can\s+khac|them\s+(?:vai\s+)?can\s+nua)/iu.test(fold(message));
}
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
  const name = customerNameFromHistory(message, history);
  return /thuê/iu.test(message)
    ? `Ngân sách thuê của ${name || 'bạn'} khoảng bao nhiêu mỗi tháng? Có thêm tên đường hay phường mong muốn thì mình lọc sát hơn nhé.`
    : `${name || 'Bạn'} dự kiến ngân sách khoảng bao nhiêu? Có thêm tên đường hay phường mong muốn thì mình lọc sát hơn nhé.`;
}
type HistorySource = { price?: number | null };
type HistoryTurn = { role: string; content: string; sources?: HistorySource[] };
export type BudgetFollowUp = { filters: ReturnType<typeof inferSearch> & { location?: string; locations?: string[] }; direction: 'cheaper' | 'higher' };
const cheaperBudget = /(?:rẻ hơn|giá thấp hơn|mềm hơn|thấp hơn|bớt tiền|tiết kiệm hơn|có căn nào rẻ hơn)/iu;
const higherBudget = /(?:đắt hơn|cao hơn|cao cấp hơn|tăng ngân sách|ngân sách cao hơn|xịn hơn)/iu;
const nameStopWords = new Set(['sinh', 'viên', 'người', 'mua', 'bán', 'thuê', 'nhà', 'căn', 'hộ', 'lần', 'đầu', 'khách', 'hàng', 'tư', 'vấn', 'chủ', 'nhà', 'môi', 'giới', 'sale', 'sales', 'admin', 'bạn', 'mình', 'tôi']);
const namePhrase = /(?:tôi\s+(?:(?:là\s+)?tên\s+là\s+|là\s+)|tên\s+tôi\s+là\s+|gọi\s+tôi\s+là\s+|mình\s+là\s+)/iu;
function statedName(text: string) {
  const match = text.match(namePhrase);
  if (!match || match.index === undefined) return null;
  const tail = text.slice(match.index + match[0].length).split(/[\n,.;:!?()[\]]/u)[0].trim();
  const words = tail.match(/[\p{L}][\p{L}'’-]*/gu) || [];
  if (!words.length || words.length > 4 || words.some(word => nameStopWords.has(word.normalize('NFC').toLocaleLowerCase('vi')))) return null;
  return words.map(word => `${word.charAt(0).toLocaleUpperCase('vi-VN')}${word.slice(1).toLocaleLowerCase('vi-VN')}`).join(' ');
}
export function customerNameFromHistory(message: string, history: { role: string; content: string }[]) {
  let name: string | null = null;
  for (const turn of [...history, { role: 'user', content: message }]) if (turn.role === 'user') name = statedName(turn.content) || name;
  return name;
}
const vagueCriteriaAnswer = /^(?:chưa rõ|không rõ|chưa biết|tùy|gợi ý|không giới hạn)(?:[\s,.:;-].*)?$/iu;
const explicitNewSearch = /(?:tìm|kiếm)\s+(?:[^\n]{0,40}\s+)?(?:mua|thuê|nhà|căn|đất|phòng)|(?:muốn|cần|thuê|mua)\s+(?:mua|thuê|nhà|căn|đất|phòng)|(?:gợi ý|tư vấn)\s+(?:mua|thuê|nhà|căn)|khác\s+hoàn\s+toàn/iu;
const bedroomCount = (text: string) => {
  const match = text.match(/(?<!\d)(\d+)\s*(?:phòng\s*ngủ|pn|phòng)(?!\p{L})/iu);
  return match ? Number(match[1]) : undefined;
};
const inferredCriteria = (text: string) => {
  const inferred = inferSearch(text) || {};
  const bedrooms = bedroomCount(text);
  return bedrooms === undefined ? inferred : { ...inferred, bedrooms };
};
export function searchCriteriaFromHistory(message: string, history: { role: string; content: string }[]) {
  const criteria: Record<string, unknown> = {};
  const current = inferredCriteria(message);
  if (message && !Object.keys(current).length && !vagueCriteriaAnswer.test(message) && !isMoreRequest(message) && !/(?:rẻ hơn|cao hơn|tăng ngân sách|ngân sách cao hơn)/iu.test(message)) return current as ReturnType<typeof inferSearch> & { bedrooms?: number };
  for (const turn of [...history, { role: 'user', content: message }]) {
    if (turn.role !== 'user') continue;
    if (explicitNewSearch.test(turn.content) && Object.keys(criteria).length) {
      for (const key of Object.keys(criteria)) delete criteria[key];
    }
    Object.assign(criteria, inferredCriteria(turn.content));
  }
  if (current.minPrice !== undefined || current.maxPrice !== undefined) {
    if (current.maxPriceExclusive === undefined) delete criteria.maxPriceExclusive;
  }
  const previousAssistant = [...history].reverse().find(turn => turn.role === 'assistant')?.content || '';
  if (vagueCriteriaAnswer.test(message)) {
    if (/khu vực|quận|phường/iu.test(previousAssistant)) {
      delete criteria.location;
      delete criteria.locations;
    }
    if (/ngân sách|triệu|tỷ/iu.test(previousAssistant)) {
      delete criteria.minPrice;
      delete criteria.maxPrice;
      delete criteria.maxPriceExclusive;
    }
  }
  return criteria as ReturnType<typeof inferSearch> & { bedrooms?: number };
}
export function budgetFollowUp(message: string, history: HistoryTurn[]): BudgetFollowUp | null {
  const explicit = inferSearch(message);
  if (explicitNewSearch.test(message)) return null;
  const cheaper = cheaperBudget.test(message);
  const higher = higherBudget.test(message);
  if (!cheaper && !higher && !explicit?.minPrice && !explicit?.maxPrice) return null;
  const prior = (searchCriteriaFromHistory('', history) || {}) as ReturnType<typeof inferSearch> & Record<string, unknown>;
  if (!Object.keys(prior).length) return null;
  const filters = { ...prior, ...(explicit || {}) } as BudgetFollowUp['filters'];
  if (explicit?.minPrice !== undefined || explicit?.maxPrice !== undefined) {
    if (explicit.maxPriceExclusive === undefined) delete filters.maxPriceExclusive;
  }
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
  if (/(?:cho\s+thue\s+(?:nha|can)|dang\s+tin|tim\s+nguoi\s+thue|ky\s+gui|ban\s+nha\s+cua\s+toi|muon\s+cho\s+thue|(?:muon|can)\s+ban\s+(?:nha|can|dat|lo)|ban\s+nha\s+qua|nho\s+ban|phi\s+moi\s+gioi|hoa\s+hong)/u.test(ownerText)) return { needed: false, question: null, options: [] };
  if (adviceOrServiceQuestion(message)) return { needed: false, question: null, options: [] };
  if (historyReferenceQuestion(message, history)) return { needed: false, question: null, options: [] };
  if (isMoreRequest(message)) return { needed: false, question: null, options: [] };
  // A named listing ("Đặt lịch xem căn RVL-…") or a booking/saving request is never a new search.
  // A question about the listing just discussed ("Tiền cọc mấy tháng?") is answered from that listing.
  if (referencedListingCodes(message, history).codes.length) return { needed: false, question: null, options: [] };
  const inferred = inferSearch(message) || {};
  const criteria = searchCriteriaFromHistory(message, history);
  const budgetAdjustment = budgetFollowUp(message, history);
  const customerName = customerNameFromHistory(message, history);
  const addressStart = customerName || 'Bạn';
  const previousAssistant = [...history].reverse().find(turn => turn.role === 'assistant')?.content || '';
  const previousWasClarification = /khu vực nào|ngân sách.*(?:tháng|triệu|tỷ)|chưa rõ,? gợi ý/iu.test(previousAssistant);
  const criteriaReply = history.length > 0 && !explicitNewSearch.test(message) && (Object.keys(inferred).length > 0 || vagueCriteriaAnswer.test(message) || !!budgetAdjustment) && previousWasClarification;
  if ((!searchIntent.test(message) && !criteriaReply) || (budgetAdjustment && !criteriaReply) || (!criteriaReply && (locationPattern.test(message) || namesPlace(message) || !!(inferred.location || inferred.locations?.length))) || isFollowUp(message) || listingCodes(message).length || /(?<![\p{L}])(?:đặt\s+lịch|hẹn\s+xem|lưu\s+căn|yêu\s+thích|liên\s+hệ|chuyên\s+viên)(?![\p{L}])/iu.test(message)) return { needed: false, question: null, options: [] };
  const location = typeof criteria.location === 'string' ? criteria.location : criteria.locations?.[0] || previousSearchLocation(history);
  const hasBudget = criteria.minPrice !== undefined || criteria.maxPrice !== undefined;
  const concrete = concreteSearchKeywords(message).length > 0 || /(?:\d+\s*(?:m²|m2|m\s*2|phòng|pn)|diện\s+tích|nội\s+thất|đầy\s+đủ|nguyên\s+căn|kinh\s+doanh|trong\s+\d+\s+tháng|hợp\s+đồng(?:\s+ngắn)?\s+hạn|dự\s+án|tên\s+(?:dự\s+án|khu)|khoảng\s+\d+)/iu.test(message);
  // A new search must establish the two fields that make a catalogue search useful.
  const kind = /chung\s+cư|căn\s+hộ/iu.test(message) ? 'chung cư' : /đất/iu.test(message) ? 'đất' : 'nhà';
  const action = criteria.transaction_type === 'Rent' ? 'thuê' : criteria.transaction_type === 'Sale' ? 'mua' : /thuê/iu.test(message) ? 'thuê' : 'tìm';
  if (criteriaReply && vagueCriteriaAnswer.test(message)) return { needed: false, question: null, options: [] };
  const bareFirstMessageBudget = hasBudget && criteria.minPrice === criteria.maxPrice && /[\d.,]+\s*(?:tỷ|tỉ|ty|triệu|tr)/iu.test(message) && !/(?:dưới|tối đa|không quá|tầm|khoảng|ngân sách|<=?)/iu.test(message);
  if ((criteriaReply || bareFirstMessageBudget) && !location && hasBudget) return {
    needed: true,
    question: `${addressStart} muốn ${action} ở khu vực nào (quận/phường)? Nếu chưa chắc, mình gợi ý vài khu nhé.`,
    options: ['Quận 7', 'Bình Thạnh', 'Thủ Đức', 'Chưa rõ, gợi ý giúp tôi'],
  };
  if (criteriaReply && location && !hasBudget) return {
    needed: true,
    question: `${addressStart} muốn ${action} ở ${location}; ngân sách khoảng bao nhiêu${action === 'thuê' ? ' mỗi tháng' : ''}?`,
    options: action === 'thuê' ? ['Dưới 10 triệu', '10–20 triệu', 'Chưa rõ, gợi ý giúp tôi'] : ['Dưới 3 tỷ', '3–6 tỷ', '6–10 tỷ', 'Trên 10 tỷ', 'Chưa rõ, gợi ý giúp tôi'],
  };
  if (!location && !hasBudget && !concrete && (!history.length || !previousWasClarification)) return {
    needed: true,
    question: /thuê/iu.test(message) ? `${addressStart} đang tìm ${kind} thuê ở khu vực nào (quận, phường hay tuyến đường) và ngân sách khoảng bao nhiêu mỗi tháng ạ? Nếu chưa chắc, mình gợi ý vài khu phù hợp nhé.` : `${addressStart} đang tìm mua ${kind} ở khu vực nào (quận, phường hay tuyến đường) và ngân sách khoảng bao nhiêu ạ? Nếu chưa chắc, mình gợi ý vài khu phù hợp nhé.`,
    options: /thuê/iu.test(message) ? ['Dưới 10 triệu', '10–20 triệu', 'Chưa rõ, gợi ý giúp tôi'] : ['Dưới 3 tỷ', '3–6 tỷ', '6–10 tỷ', 'Trên 10 tỷ', 'Chưa rõ, gợi ý giúp tôi'],
  };
  // Explicit budget searches keep the legacy direct-search behaviour; a bare first-message amount and every clarification answer ask for area first.
  if (!location && hasBudget) return { needed: false, question: null, options: [] };
  if (!location) return { needed: false, question: null, options: [] };
  if (!hasBudget && !locationPattern.test(message) && !namesPlace(message)) {
    const action = /thuê/iu.test(message) ? 'thuê' : /mua/iu.test(message) ? 'mua' : 'tìm';
    return { needed: true, question: `${addressStart} muốn ${action} ở ${location} như trước hay khu vực khác?`, options: [location, 'Khu vực khác', 'Không giới hạn khu vực'] };
  }
  if (!hasBudget) return { needed: false, question: null, options: [] };
  if (criteriaReply) return { needed: false, question: null, options: [] };
  return { needed: true, question: `${addressStart} muốn ${action} ở ${location} như trước hay khu vực khác?`, options: [location, 'Khu vực khác', 'Không giới hạn khu vực'] };
}
