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
  return /(?:toi\s+co\s+(?:can|nha|bat dong san).*(?:muon\s+(?:ban|cho thue))|muon\s+cho\s+thue\s+nha|ky gui|dang ban|phi moi gioi)/iu.test(normalized);
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
