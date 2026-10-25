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
];

export function unsupportedCriteria(text: string): string[] {
  const normalized = normalize(text);
  return criteria.filter(([, pattern]) => pattern.test(normalized)).map(([label]) => label);
}

export function ownerRequest(text: string): boolean {
  const normalized = normalize(text);
  if (/mu.{0,30}b.{0,20}nh/i.test(normalized)) return true;
  return /(?:toi\s+co\s+(?:can|nha|bat dong san).*(?:muon\s+(?:ban|cho thue))|muon[\s\S]{0,30}(?:ban|cho thue)[\s\S]{0,20}(?:nha|can|dat)|can\s+(?:ban|cho thue)[\s\S]{0,20}(?:nha|can|dat)\s+cua\s+(?:toi|minh)|ky gui|dang tin|dang ban|tim nguoi thue|khong muon tu quan ly|phi moi gioi|ban nha cua toi)/iu.test(normalized);
}

export function ownerValuationQuestion(text: string): boolean {
  const normalized = normalize(text);
  if (/gi.{0,40}l/i.test(normalized)) return true;
  return /(?:gia.*hop ly|hop ly.*gia|dinh gia|gia thi truong|danh gia.*gia|gia cho thue)/iu.test(normalized);
}

export function unsupportedLine(labels: string[]): string {
  return `Hiện chưa có thông tin về ${labels.join(', ')} trong dữ liệu; chuyên viên tư vấn có thể hỗ trợ bạn phần này.`;
}

export const loanAssumption = 'Giả định vay khoảng 60% giá trị căn; điều kiện vay cụ thể cần chuyên viên tư vấn xác nhận.';

export function noMatchReply(text: string): string {
  // Quote the customer's own words (with accents), not the accent-folded form.
  const original = text.normalize('NFC');
  const district = original.match(/(?<![\p{L}])(?:quận\s+\d{1,2}|thủ đức|bình thạnh|phú nhuận|gò vấp|tân bình|tân phú|bình tân)(?![\p{L}\d])/iu)?.[0];
  const budget = original.match(/\d+(?:[.,]\d+)?\s*(?:tỷ|tỉ|triệu)(?:\s*\/\s*tháng)?/iu)?.[0];
  const criteriaText = [district && `ở ${district}`, budget && `trong khoảng ${budget}`].filter(Boolean).join(' ');
  return `Hiện chưa có căn phù hợp ${criteriaText || 'với các tiêu chí bạn nêu'} trong dữ liệu đã công bố. Bạn có thể nới ngân sách/khu vực, hoặc để chuyên viên tư vấn tìm thêm giúp bạn.`;
}

export function hasNoMatchReply(text: string): boolean {
  return /(?:chưa\s+(?:tìm\s+thấy|có)|không\s+có\s+(?:căn|bất động sản)|không\s+tìm\s+thấy|no\s+match)/iu.test(text);
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
