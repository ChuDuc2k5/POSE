import { priceLabel } from './money.js';
const normalize = (value: string) => value.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const criteria: [string, RegExp][] = [
  ['khoảng cách / thời gian di chuyển', /(?:\bkm\b|\bphut\b|gan\s+(?:quan|q\.?|trung tam))/iu],
  // Word edges: "ngân hàng" folds to "ngan hang", which contains "ngan han".
  ['hợp đồng ngắn hạn', /(?:\bngan han\b|\bthue\s+(?:nha\s+|can\s+)?(?:trong\s+)?\d+\s+thang\b)/iu],
  ['tiền cọc / thời hạn hợp đồng', /(?:tien coc|dat coc|mat coc|thoi han hop dong|tra nha truoc han)/iu],
  ['khả năng thương lượng / giá chốt', /(?:giam gia|thuong luong|gia chot)/iu],
  ['khoản vay ngân hàng', /\bvay\b/iu],
  ['doanh thu / lợi suất cho thuê', /(?:thu ve|loi suat|cho thue(?:\s+can)? duoc bao nhieu)/iu],
  ['mức giá thị trường hợp lý', /(?:gia do co hop ly|dinh gia)/iu],
  ['dịch vụ quản lý cho thuê', /(?:quan ly khach thue|khong muon tu quan ly)/iu],
  ['pháp lý chi tiết', /(?:so hong|the chap|tranh chap|tho cu|quy hoach)/iu],
  ['chủ đầu tư / tiến độ', /(?:chu dau tu|tien do)/iu],
  ['dự báo / tiềm năng tăng giá', /(?:tiem nang tang gia|tang gia|du bao|tuong lai gia)/iu],
  ['thời gian bán', /(?:ban (?:nha|can|dat)?\s*trong (?:vong )?\d+\s*(?:thang|tuan|ngay)|bao lau (?:thi )?ban duoc)/iu],
];

export function unsupportedCriteria(text: string): string[] {
  const normalized = normalize(text);
  return criteria.filter(([label, pattern]) => label === 'khoản vay ngân hàng' ? loanWords(text) : pattern.test(normalized)).map(([label]) => label);
}

// Accent folding turns "vậy" into "vay", so loan wording is matched on the accented text.
export function loanWords(text: string): boolean {
  const source = text.normalize('NFC');
  for (const match of source.matchAll(/(?<![\p{L}])(?:vay|khoản vay|trả góp)(?![\p{L}])/giu)) {
    const index = match.index || 0;
    const before = source.slice(Math.max(0, index - 24), index);
    if (!/(?:không|chẳng|chưa)\s*(?:muốn|cần|phải)?\s*$/iu.test(before)) return true;
  }
  return false;
}

export function noLoanWords(text: string): boolean {
  return /(?:không|chẳng|chưa)\s*(?:muốn|cần|phải)?\s*(?:vay|khoản vay|trả góp)/iu.test(text.normalize('NFC'));
}

/** Cash creates a 60%-loan budget only when no purchase price is already stated. */
export function loanBudget(text: string): number | null {
  if (!loanWords(text)) return null;
  const purchasePrice = /(?:căn(?:\s+hộ)?|nhà|đất|giá)[^\d]{0,20}[\d.,]+\s*(?:tỷ|tỉ|ty|triệu|tr)(?![\p{L}])/iu.test(text);
  if (purchasePrice) return null;
  const cash = text.match(/(?:có|sẵn|tiền mặt|tự có|trong tay|vốn|tài chính)[^\d]{0,24}([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|tr))(?![\p{L}])/iu)?.[1];
  if (!cash) return null;
  const value = Number(cash.replace(/\s/g, '').replace(',', '.').replace(/(tỷ|tỉ|ty)$/iu, ''));
  const amount = /(?:tỷ|tỉ|ty)$/iu.test(cash) ? value * 1e9 : value * 1e6;
  return Number.isFinite(amount) ? Math.round(amount / 0.4 / 100_000_000) * 100_000_000 : null;
}

export function contactRequest(text: string): boolean {
  return /(?:liên hệ(?: lại)?|gọi lại|nhân viên tư vấn|chuyên viên tư vấn|gặp chuyên viên|tư vấn trực tiếp|để lại số|số điện thoại|liên hệ tư vấn)/iu.test(text);
}

export function ownerRequest(text: string): boolean {
  const normalized = normalize(text);
  // A buyer or renter ("muốn tìm", "mua", "thuê", comparing options) is never an owner unless they name their own property.
  const ownProperty = /(?:cua\s+(?:toi|minh|em|nha minh)|ky gui|dang tin|tim nguoi thue|toi\s+co\s+(?:mot\s+|1\s+)?(?:can|nha|lo|dat|bat dong san))/i.test(normalized);
  const ownerSignal = /(?:toi\s+co\s+(?:mot\s+|1\s+)?(?:can|nha|lo|dat|bat dong san).*(?:muon\s+(?:ban|cho thue)|dang ban)|muon[\s\S]{0,30}(?:ban|cho thue)[\s\S]{0,20}(?:nha|can|dat)|can\s+(?:ban|cho thue)[\s\S]{0,20}(?:nha|can|dat)\s+cua\s+(?:toi|minh)|ky gui|dang tin|tim nguoi thue|khong muon tu quan ly|ban nha cua toi|ban (?:nha|can|dat) qua (?:ben|terava)|nho (?:ben ban|terava) ban)/iu.test(normalized);
  // "đang bán" and "bên mình có bán" describe catalogue availability unless
  // the customer also identifies a property they own.
  if (!ownProperty && /(?:dang ban|ben minh co|ben ban co|co\s+(?:ban|cho thue)\s+(?:nha|can|dat)|tim|mua|so sanh|nen chon|phuong an|dau tu|muon\s+thue|can\s+thue|(?<!cho\s)thue\s+(?:nha|can|phong|chung cu))/i.test(normalized)) return false;
  return ownerSignal || ownProperty && /phi moi gioi|hoa hong/i.test(normalized);
}

export function ownerValuationQuestion(text: string): boolean {
  const normalized = normalize(text);
  return /(?:gia.*hop ly|hop ly.*gia|dinh gia|gia thi truong|danh gia.*gia|gia cho thue)/iu.test(normalized);
}

export function unsupportedLine(labels: string[], general: 'listing' | 'general' | false = false): string {
  // After an answer built from general FAQ knowledge, say plainly that the specific facts are not in the data.
  if (general === 'listing') return `Lưu ý: tin đăng chưa có thông tin về ${labels.join(', ')} của căn này, phần trên là thông lệ chung; chuyên viên tư vấn sẽ xác nhận cụ thể giúp bạn.`;
  if (general === 'general') return `Lưu ý: phần trên là thông lệ chung, hiện chưa có thông tin về ${labels.join(', ')} cho trường hợp cụ thể của bạn; chuyên viên tư vấn sẽ xác nhận giúp bạn.`;
  return `Hiện chưa có thông tin về ${labels.join(', ')} trong dữ liệu; chuyên viên tư vấn có thể hỗ trợ bạn phần này.`;
}

export const loanAssumption = 'Giả định vay khoảng 60% giá trị căn; điều kiện vay cụ thể cần chuyên viên tư vấn xác nhận.';

export function noMatchReply(text: string): string {
  // Quote the customer's own words (with accents), not the accent-folded form.
  const original = text.normalize('NFC');
  const district = original.match(/(?<![\p{L}])(?:quận\s+\d{1,2}|biên hòa|đồng nai|thủ đức|bình thạnh|phú nhuận|gò vấp|tân bình|tân phú|bình tân)(?![\p{L}\d])/iu)?.[0];
  const budget = original.match(/(?:mua|giá|ngân\s+sách|dưới|tối\s+đa|khoảng|trong\s+khoảng)[^\d]{0,30}(\d+(?:[.,]\d+)?\s*(?:tỷ|tỉ|triệu)(?:\s*\/\s*tháng)?)/iu)?.[1]
    || original.match(/\d+(?:[.,]\d+)?\s*(?:tỷ|tỉ|triệu)(?:\s*\/\s*tháng)?/iu)?.[0];
  const criteriaText = [district && `ở ${district}`, budget && `trong khoảng ${budget}`].filter(Boolean).join(' ');
  return `Hiện chưa có căn phù hợp ${criteriaText || 'với các tiêu chí bạn nêu'} trong dữ liệu đã công bố. Bạn có thể nới ngân sách/khu vực, hoặc để chuyên viên tư vấn tìm thêm giúp bạn.`;
}

export type DeterministicNoMatchCard = { number?: number; name?: string; location?: string; price?: number | null; reason?: string; relaxed_reason?: string };
export function deterministicNoMatchReply(input: { criteria?: string; area?: string; blocker?: string; related?: DeterministicNoMatchCard[]; nearby?: string; consultant?: string }) {
  const cards = (input.related || []).slice(0, 3).map((item, index) => {
    const number = item.number ?? index + 1;
    const price = item.price == null ? '' : `, giá ${priceLabel(item.price, false)}`;
    const reason = item.reason || item.relaxed_reason || 'Lệch tiêu chí';
    return `[${number}] ${item.name || 'Bất động sản gần tiêu chí'}${item.location ? ` ở ${item.location}` : ''}${price} — ${reason}.`;
  });
  return [
    input.criteria?.trim(),
    `Hiện chưa có căn nào đáp ứng đủ tất cả tiêu chí của bạn${input.area ? ` ở ${input.area}` : ''}.`,
    input.blocker?.trim(),
    cards.length ? `Các lựa chọn gần tiêu chí nhất:\n${cards.join('\n')}` : '',
    input.nearby?.trim(),
    input.consultant || 'Mình có thể nhờ chuyên viên tư vấn tìm thêm giúp bạn.',
  ].filter(Boolean).join('\n');
}

export function hasNoMatchReply(text: string): boolean {
  return /(?:chưa\s+(?:tìm\s+(?:thấy|được)|có)|không\s+có\s+(?:căn|bất động sản)|không\s+tìm\s+(?:thấy|được)|no\s+match)/iu.test(text);
}

export function dedupeNoMatchReply(text: string): string {
  let seen = false;
  return text.split(/\n+/u).filter(block => {
    if (!hasNoMatchReply(block)) return true;
    if (seen) return false;
    seen = true;
    return true;
  }).join('\n');
}

export function cheaperFallbackReply(items: { number?: number; name?: string; location?: string; price?: number | null }[], area?: string, nearby: string[] = []): string {
  const label = area ? `tại ${area}` : 'trong khu vực bạn chọn';
  if (items.length) {
    const cards = items.slice(0, 3).map((item, index) => `[${item.number ?? index + 1}] ${item.name || 'Bất động sản phù hợp'} – ${item.location || area || 'khu vực lân cận'} – ${priceLabel(item.price, true)}`).join('\n');
    return `Mình chưa tìm thấy căn nào rẻ hơn mức bạn vừa xem ${label}. Mức thấp nhất hiện có trong khu vực là:\n${cards}\nBạn có thể thử ${nearby.length ? nearby.join(' hoặc ') : 'khu vực lân cận'}, giữ ${area || 'khu vực này'} và nới diện tích/phòng ngủ, hoặc gặp chuyên viên để mình tìm thêm.`;
  }
  return `Mình chưa tìm thấy căn nào rẻ hơn trong ${area || 'khu vực bạn chọn'} với dữ liệu hiện có. Bạn có thể thử ${nearby.length ? nearby.join(' hoặc ') : 'khu vực lân cận'}, giữ ${area || 'khu vực này'} và nới diện tích/phòng ngủ, hoặc gặp chuyên viên để mình tìm thêm.`;
}

export function listingFollowUpFallback(items: { number?: number; name?: string; location?: string; price?: number | null; transaction_type?: 'Sale'|'Rent'; price_period?: 'Total'|'Month' }[], missing: string): string {
  const listing = items[0];
  if (!listing) return `Hiện chưa có thông tin về ${missing}; chuyên viên tư vấn có thể kiểm tra và báo lại cho bạn.`;
  const monthly = listing.transaction_type === 'Rent' || listing.price_period === 'Month';
  return `[${listing.number ?? 1}] ${listing.name || 'Căn bất động sản'} hiện có giá ${priceLabel(listing.price, monthly)}${listing.location ? ` tại ${listing.location}` : ''}. Mình chưa có thông tin về ${missing}; mình có thể nhờ chuyên viên kiểm tra và tư vấn thêm cho bạn.`;
}
