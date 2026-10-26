import { hcmWards } from './hcm-wards.js';
import { inferSearch } from './infer-search.js';

export type Clarification = { needed: boolean; question: string | null; options: string[] };
const listingCodePattern = /(?<![\p{L}\d])[A-Z][A-Z\d]{0,7}-[A-Z\d]{4,40}(?![\p{L}\d])/gu;
const searchIntent = /(?:căn|nhà|đất|phòng|mua|thuê|tìm|bất động sản|giá|chung cư|villa|shop|office)/iu;
const locationPattern = /(?:quận|q\.?\s*\d{1,2}|huyện|thủ\s*đức|phường|xã|thành phố|tp\.?\s*hồ\s*chí\s*minh|hcm|sài\s*gòn)/iu;
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLocaleLowerCase('vi');
const outsideCataloguePlaces = ['Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng', 'Nha Trang', 'Đà Lạt', 'Huế', 'Quy Nhơn', 'Vinh', 'Phan Thiết', 'Hạ Long'];
const areaName = /(?:quận\s*\d{1,2}|q\.?\s*\d{1,2}|huyện\s+[\p{L}\d -]+|phường\s+[\p{L}\d -]+|xã\s+[\p{L}\d -]+|thủ\s*đức|gò\s*vấp|bình\s*thạnh|tân\s*bình|tân\s*phú|phú\s*nhuận|bình\s*tân|nhà\s*bè|củ\s*chi|hóc\s*môn|bình\s*chánh|cần\s*giờ|vũng\s*tàu|bình\s*dương|biên\s*hòa|đồng\s*nai)/iu;
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
export function outsideCataloguePlace(message: string) {
  const normalized = fold(message);
  return outsideCataloguePlaces.find(place => {
    const value = fold(place).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}])${value}(?![\\p{L}])`, 'u').test(normalized);
  }) || null;
}
export function historyReferenceQuestion(message: string, history: { role: string; content: string }[]) {
  const text = fold(message);
  const explicitListing = listingCodes(message).length > 0 || /(?:căn|can)(?:\s+hộ|\s+ho)?\s*(?:số|so)?\s*\d+|(?:căn|can)(?:\s+hộ|\s+ho)?\s+(?:này|nay|đó|do|kia|trên|vừa rồi|vua roi)|(?:căn|can)\s+(?:đầu tiên|dau tien|rẻ nhất|re nhat)/iu.test(message);
  if (areaName.test(message) && !explicitListing) return false;
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
  const specificAmount = /\d[\d.,]*\s*(?:ty|trieu|tr|m2|m\s*2)/iu.test(text);
  const comparison = /(?:so sanh|giua|cai nao|hieu qua hon|khac nhau|cao hon|re hon)/iu.test(text);
  const hypothetical = /(?:neu|gia su|n?eu ma)/iu.test(text);
  const listingReference = /(?:tin dang|tin rao|cung dia chi|can nay|nha nay|hai tin|dien tich)/iu.test(text);
  if (specificAmount || comparison || hypothetical || listingReference) return null;
  if (/(?:nhung|cac)\s+(?:du an|khu do thi)/iu.test(text)) return 'projects';
  if (/(?:nhung\s+loai|cac\s+loai|loai nao|bat dong san nao.*(?:ban|thue|dang)|co cho thue khong)/iu.test(text)) return 'types';
  if (/(?:nhung khu vuc nao|bat dong san.*nhung khu vuc nao|o dau.*bat dong san)/iu.test(text)) return 'areas';
  if (/(?:gia|muc gia)\s+khoang\s+bao nhieu|(?:gia|muc gia).*bao nhieu/iu.test(text)) return 'prices';
  return null;
}
export function isMoreRequest(message: string) {
  const folded=fold(message);
  if(/(?:so\s+sanh|dua\s+vao\s+dau|khang\s+dinh|cung\s+khu\s+vuc|gia\s+tot)/iu.test(folded))return false;
  return /(?:co\s+can\s+nao\s+khac|con\s+can\s+nao\s+(?:khac|nua)|con\s+nua|xem\s+them|can\s+khac|them\s+(?:vai\s+)?can\s+nua)/iu.test(folded);
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
  const turns = history as HistoryTurn[];
  const listed = [...turns].reverse().find(turn => turn.role === 'assistant' && Array.isArray(turn.sources) && turn.sources.length)?.sources || [];
  const sourceCodes = listed.map(source => source.code).filter((code): code is string => typeof code === 'string');
  // A multi-listing follow-up such as "ba căn bạn vừa giới thiệu" refers to
  // the complete previous card set, in its original numbering. Do not reduce
  // it to the last card or try to reconstruct criteria from assistant prose.
  if (sourceCodes.length && historyReferenceQuestion(message, history)) {
    return { codes: [...new Set(sourceCodes)], ambiguous: false };
  }
  const numbered = [...message.matchAll(/(?:căn|can)(?:\s+hộ|\s+ho)?\s*(?:số|so)?\s*(\d+)(?![\p{L}\d])/giu)].map(match => Number(match[1]) - 1).filter(index => index >= 0 && index < sourceCodes.length);
  const wantsFirst = /(?:căn|can)\s+(?:đầu\s+tiên|dau\s+tien)/iu.test(message);
  const wantsCheapest = /(?:căn|can)\s+(?:rẻ\s+nhất|re\s+nhat)(?:\s+vừa\s+rồi|\s+vua\s+roi)?/iu.test(message);
  if (sourceCodes.length && (numbered.length || wantsFirst || wantsCheapest)) {
    const selected = wantsCheapest
      ? [...listed].sort((left, right) => (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY)).slice(0, 1)
      : wantsFirst ? listed.slice(0, 1) : numbered.map(index => listed[index]).filter(Boolean);
    return { codes: [...new Set(selected.map(source => source.code).filter((code): code is string => typeof code === 'string'))], ambiguous: false };
  }
  // A named new area switches the active search. A single previous card must
  // not leak into that search just because the message is short ("Gò Vấp
  // được không", "thôi Quận 9"). Explicit card references were resolved above.
  if (areaName.test(message) && !backReference.test(message)) return { codes: [] as string[], ambiguous: false };
  // Right after one listing was discussed, a question without a new search ("Tiền cọc mấy tháng?",
  // "Khu này có ngập không?") is about that listing.
  const lastTurn = history[history.length - 1] as HistoryTurn | undefined;
  const last = [...listingCodes(lastTurn?.content || ''), ...(lastTurn?.sources || []).map(source => source.code).filter((code): code is string => typeof code === 'string')];
  if (!backReference.test(message)) return last.length === 1 ? { codes: last, ambiguous: false } : { codes: [] as string[], ambiguous: false };
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i] as HistoryTurn;
    const codes = [...listingCodes(turn?.content || ''), ...(turn?.sources || []).map(source => source.code).filter((code): code is string => typeof code === 'string')];
    if (codes.length) return { codes, ambiguous: codes.length > 1 };
  }
  return { codes: [] as string[], ambiguous: false };
}
// A project, area or new ward name is a location too ("Vinhomes Grand Park", "Phú Mỹ Hưng", "Phường Long Bình").
const placeNames = /(?<![\p{L}])(?:vinhomes|grand\s+park|masteri|midtown|sunrise|sky\s+garden|biên\s+hòa|đồng\s+nai|phú\s+mỹ\s+hưng|thảo\s+điền|thủ\s+thiêm|landmark|vạn\s+phúc|celadon|eco\s*green|gò\s+vấp|bình\s+thạnh|tân\s+bình|tân\s+phú|phú\s+nhuận|bình\s+tân|nhà\s+bè|củ\s+chi|hóc\s+môn|bình\s+chánh|cần\s+giờ|vũng\s+tàu|bình\s+dương|khu\s+đô\s+thị|dự\s+án)(?![\p{L}])/iu;
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
type HistorySource = { id?: string; code?: string; price?: number | null };
type HistoryTurn = { role: string; content: string; sources?: HistorySource[] };
export type BudgetFollowUp = { filters: ReturnType<typeof inferSearch> & { location?: string; locations?: string[] }; direction: 'cheaper' | 'higher' };
const cheaperBudget = /(?:rẻ hơn|giá thấp hơn|mềm hơn|thấp hơn|bớt tiền|tiết kiệm hơn|có căn nào rẻ hơn)/iu;
const higherBudget = /(?:đắt hơn|cao hơn|cao cấp hơn|tăng(?: lên| ngân sách)|ngân sách cao hơn|nâng(?: lên| ngân sách)|xịn hơn)/iu;
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
    if (turn.role === 'assistant') {
      const deterministic = turn.content.match(/(?:^|\n)Tiêu chí:\s*([^\n]+)/iu)?.[1];
      if (deterministic) Object.assign(criteria, inferredCriteria(deterministic));
      continue;
    }
    if (explicitNewSearch.test(turn.content) && Object.keys(criteria).length) {
      for (const key of Object.keys(criteria)) delete criteria[key];
    }
    const turnCriteria = inferredCriteria(turn.content);
    const areaOnly = (turnCriteria.location !== undefined || turnCriteria.locations !== undefined)
      && turnCriteria.transaction_type === undefined && turnCriteria.type === undefined
      && turnCriteria.minPrice === undefined && turnCriteria.maxPrice === undefined
      && turnCriteria.minArea === undefined && turnCriteria.maxArea === undefined
      && turnCriteria.bedrooms === undefined;
    if (areaOnly) {
      // An area-only refinement replaces location while preserving the active
      // transaction, type, budget, area and room criteria.
      delete criteria.location;
      delete criteria.locations;
      delete criteria.location_aliases;
    }
    Object.assign(criteria, turnCriteria);
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
export function isAreaOnlyRefinement(message: string, history: { role: string; content: string; sources?: HistorySource[] }[]) {
  const current = inferredCriteria(message);
  const hasLocation = current.location !== undefined || current.locations !== undefined;
  if (!hasLocation || isMoreRequest(message)) return false;
  const nonLocationKeys = ['type', 'transaction_type', 'minPrice', 'maxPrice', 'maxPriceExclusive', 'minArea', 'maxArea', 'bedrooms', 'keywords'];
  if (nonLocationKeys.some(key => current[key as keyof typeof current] !== undefined)) return false;
  const active = searchCriteriaFromHistory('', history);
  return Boolean(active.transaction_type || active.type || active.minPrice !== undefined || active.maxPrice !== undefined || active.minArea !== undefined || active.maxArea !== undefined || active.bedrooms !== undefined);
}
export function budgetFollowUp(message: string, history: HistoryTurn[]): BudgetFollowUp | null {
  const explicit = inferSearch(message);
  if (explicitNewSearch.test(message)) return null;
  const cheaper = cheaperBudget.test(message);
  const higher = higherBudget.test(message);
  const cheaperKeepsCeiling = /rẻ\s+hơn\s+nữa/iu.test(message);
  if (!cheaper && !higher && !explicit?.minPrice && !explicit?.maxPrice) return null;
  const prior = (searchCriteriaFromHistory('', history) || {}) as ReturnType<typeof inferSearch> & Record<string, unknown>;
  if (!Object.keys(prior).length) return null;
  const filters = { ...prior, ...(explicit || {}) } as BudgetFollowUp['filters'];
  if (explicit?.minPrice !== undefined || explicit?.maxPrice !== undefined) {
    if (explicit.maxPrice !== undefined && explicit.minPrice === undefined) delete filters.minPrice;
    if (explicit.minPrice !== undefined && explicit.maxPrice === undefined) delete filters.maxPrice;
    if (explicit.maxPriceExclusive === undefined) delete filters.maxPriceExclusive;
  }
  // Assistant prose echoes customer budgets and contains other numbers. Only
  // structured catalogue prices are authoritative for a budget adjustment.
  const previousSources = [...history].reverse().find(turn => turn.role === 'assistant' && Array.isArray(turn.sources))?.sources || [];
  const shownPrices = previousSources.map(source => source.price).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (cheaper && !cheaperKeepsCeiling) {
    const candidates = (shownPrices.length ? shownPrices : [prior.maxPrice]).filter((value): value is number => Number.isFinite(value));
    if (candidates.length) filters.maxPrice = Math.max(0, Math.floor(Math.min(...candidates) * 0.9));
    delete filters.minPrice;
  } else if (cheaper) {
    // "Rẻ hơn nữa" changes ordering, not the remembered ceiling. A page may
    // contain a cheap outlier, so deriving a new max from source-card prices
    // silently narrows the customer's request on the next turn.
    const rememberedMax = typeof prior.maxPrice === 'number' ? prior.maxPrice : shownPrices.length ? Math.max(...shownPrices) : undefined;
    if (rememberedMax !== undefined) filters.maxPrice = rememberedMax;
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
  const bareFirstMessageBudget = hasBudget && criteria.minPrice === undefined && typeof criteria.maxPrice === 'number' && /[\d.,]+\s*(?:tỷ|tỉ|ty|triệu|tr)/iu.test(message) && !/(?:dưới|tối đa|không quá|tầm|khoảng|ngân sách|<=?)/iu.test(message);
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
  const extremePriceRequest = /(?:đắt|cao|rẻ|thấp)\s+nhất/iu.test(message);
  if (!location && !hasBudget && !concrete && !extremePriceRequest && (!history.length || !previousWasClarification)) return {
    needed: true,
    question: /thuê/iu.test(message) ? `${addressStart} đang tìm ${kind} thuê ở khu vực nào (quận, phường hay tuyến đường) và ngân sách khoảng bao nhiêu mỗi tháng ạ? Nếu chưa chắc, mình gợi ý vài khu phù hợp nhé.` : `${addressStart} đang tìm mua ${kind} ở khu vực nào (quận, phường hay tuyến đường) và ngân sách khoảng bao nhiêu ạ? Nếu chưa chắc, mình gợi ý vài khu phù hợp nhé.`,
    options: /thuê/iu.test(message) ? ['Dưới 10 triệu', '10–20 triệu', 'Chưa rõ, gợi ý giúp tôi'] : ['Dưới 3 tỷ', '3–6 tỷ', '6–10 tỷ', 'Trên 10 tỷ', 'Chưa rõ, gợi ý giúp tôi'],
  };
  const anywhereRequest = /(?:ở đâu cũng được|khu nào cũng được|không giới hạn khu vực|không giới hạn)/iu.test(message);
  const suggestionRequest = vagueCriteriaAnswer.test(message) || /(?:gợi ý\s+giúp|chưa\s+rõ)/iu.test(message);
  // An ordinary transaction + type + budget request is still staged: the owner
  // rule asks for an area before mixing listings from unrelated districts.
  // Extreme-price, suggestion-chip, and explicit-anywhere requests remain broad.
  if (!location && hasBudget && !extremePriceRequest && !suggestionRequest && !anywhereRequest && (criteria.transaction_type || criteria.type)) return {
    needed: true,
    question: `${addressStart} muốn ${action} ở khu vực nào (quận/phường)? Nếu chưa chắc, mình gợi ý vài khu nhé.`,
    options: ['Quận 7', 'Bình Thạnh', 'Thủ Đức', 'Chưa rõ, gợi ý giúp tôi'],
  };
  // Explicit anywhere/suggestion requests keep the broad-search behaviour; every clarification answer still asks for area first.
  if (!location && hasBudget) return { needed: false, question: null, options: [] };
  if (!location) return { needed: false, question: null, options: [] };
  if (location && /(?:khu vực khác|khu vuc khac|đổi khu vực|doi khu vuc|nơi khác|noi khac|chỗ khác|cho khac)/iu.test(message)) {
    return { needed: true, question: `${addressStart} muốn ${action} ở khu vực nào khác?`, options: ['Quận 9', 'Thủ Đức', 'Bình Thạnh', 'Chưa rõ, gợi ý giúp tôi'] };
  }
  const hasSourceCards = history.some(turn => Array.isArray((turn as { sources?: unknown[] }).sources) && (turn as { sources?: unknown[] }).sources!.length > 0);
  if (!hasSourceCards && location && !locationPattern.test(message) && !namesPlace(message)) {
    return { needed: true, question: `${addressStart} muốn ${action} ở ${location} như trước hay khu vực khác?`, options: [location, 'Khu vực khác', 'Không giới hạn khu vực'] };
  }
  return { needed: false, question: null, options: [] };
}
