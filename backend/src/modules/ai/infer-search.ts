import { moneyAmounts } from './money.js';

export type InferredSearch = { location?: string; locations?: string[]; type?: string; minPrice?: number; maxPrice?: number; minArea?: number; maxArea?: number; transaction_type?: 'Sale'|'Rent'; keywords?: string[] };
export const centralFormerDistricts = ['Quận 1', 'Quận 2', 'Quận 3', 'Quận 4', 'Quận 5', 'Quận 7', 'Quận 10', 'Quận Bình Thạnh', 'Phú Nhuận'];
const landmarkLocations: [RegExp, string | string[]][] = [
  [/RMIT|Tôn Đức Thắng|Phú Mỹ Hưng/i, 'Quận 7'],
  [/Landmark\s*81/i, 'Quận Bình Thạnh'],
  [/Tân Sơn Nhất/i, 'Tân Bình'],
  [/Đại học Quốc gia|Làng Đại học/i, 'Thủ Đức'],
  [/Bến Thành|Nhà thờ Đức Bà|phố đi bộ Nguyễn Huệ|trung tâm (?:thành phố|Sài Gòn|TP.?|Q.? ?1|quận 1)|gần trung tâm(?! (?:mua sắm|thương mại|hành chính))/iu, ['Quận 1', 'Quận 3', 'Quận 4', 'Quận 5', 'Quận 10', 'Quận Bình Thạnh']],
  [/Thảo Điền/i, 'Quận 2'],
  [/Bitexco/i, 'Quận 1'],
];
const word = (source: string) => new RegExp(`(?<![\\p{L}])(?:${source})(?![\\p{L}])`, 'iu');

export function inferTransactionType(text: string): 'Sale'|'Rent'|undefined {
  const n = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const mua = word('mua').test(text) || word('mua').test(n);
  if (!mua && (word('thue').test(n) || word('thuê').test(text) || /\d[\d.,\s]*\s*trieu\s*\/\s*thang/.test(n) || /\/\s*thang|hang\s*thang|moi\s*thang/.test(n))) return 'Rent';
  if (mua || /\d[\d.,\s]*\s*ty\b/.test(n) || /\d[\d.,\s]*\s*(?:tỷ|tỉ)(?![\p{L}])/iu.test(text)) return 'Sale';
  return undefined;
}

const types: [RegExp, string][] = [
  [word('biệt thự'), 'Villa'], [word('căn hộ|chung cư|studio|penthouse|duplex'), 'Apartment'], [word('văn phòng'), 'Office'],
  [word('mặt bằng|shophouse|kiot|cửa hàng'), 'Shop'], [word('đất nền|lô đất|đất'), 'Land'], [word('nhà phố|nhà riêng|nhà nguyên căn|nhà mặt tiền|nhà mặt phố|nhà hẻm|nhà cấp 4|nhà \d+ tầng|nhà \d+ lầu'), 'House'], [word('nhà'), 'House'],
];
const places = ['Thủ Đức', 'Bình Thạnh', 'Gò Vấp', 'Tân Bình', 'Tân Phú', 'Phú Nhuận', 'Bình Tân', 'Nhà Bè', 'Củ Chi', 'Hóc Môn', 'Bình Chánh', 'Cần Giờ', 'Thảo Điền', 'Phú Mỹ Hưng', 'Thủ Thiêm'];
const propertyWords = /căn(?: hộ)?|chung cư|nhà|đất|biệt thự|văn phòng|mặt bằng|bất động sản|thuê|mua|bán|giá|ngân sách|tỷ|triệu|phòng ngủ|quận|khu vực|diện tích|nhận nhà ngay|dọn vào ở ngay|khu dân cư|vợ chồng|trường học|bệnh viện|chợ|siêu thị|trung tâm thương mại|hẻm|yên tĩnh|máy lạnh|máy giặt|nội thất|đậu ô tô|gara|tầng thấp|tầng cao|ban công|view|hồ bơi|gym|thang máy|giảm giá|ngộp|cắt lỗ|hạ giá|chiết khấu|giá tốt|chỉ còn|\bm\s*[²2]\b|apartment|house/i;

const keywordRules: [RegExp, string][] = [
  [/nhan nha ngay|don vao o ngay/iu, 'nhận nhà ngay'],
  [/khu dan cu/iu, 'khu dân cư'], [/nho/iu, 'nhỏ'], [/vo chong/iu, 'vợ chồng'],
  [/truong hoc/iu, 'trường học'], [/benh vien/iu, 'bệnh viện'], [/cho(?! thue)/iu, 'chợ'],
  [/sieu thi/iu, 'siêu thị'], [/trung tam thuong mai/iu, 'trung tâm thương mại'],
  [/hem/iu, 'hẻm'], [/yen tinh/iu, 'yên tĩnh'], [/may lanh/iu, 'máy lạnh'],
  [/may giat/iu, 'máy giặt'], [/noi that/iu, 'nội thất'], [/dau o to|gara/iu, 'đậu ô tô'],
  [/tang thap/iu, 'tầng thấp'], [/tang cao/iu, 'tầng cao'], [/ban cong/iu, 'ban công'],
  [/\bview\b/iu, 'view'], [/ho boi/iu, 'hồ bơi'], [/\bgym\b/iu, 'gym'],
  [/thang may/iu, 'thang máy'], [/giam gia|ngop|cat lo|ha gia|chiet khau|gia tot|chi con/iu, 'giảm giá'],
];
const searchKeywords = (text: string) => {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLocaleLowerCase('vi');
  return [...new Set(keywordRules.filter(([pattern]) => pattern.test(normalized)).map(([, keyword]) => keyword))];
};

// "thuê nhà" alone means a place to rent (apartments included); "mua nhà" still means a house.
export function genericHome(text: string) { return word('thuê').test(text) && word('nhà').test(text) && !types.slice(0, -1).some(([pattern]) => pattern.test(text)); }

export function inferSearch(text: string): InferredSearch | null {
  if (!propertyWords.test(text)) return null;
  const filters: InferredSearch = {};
  const landmark = landmarkLocations.find(([pattern]) => pattern.test(text));
  if (landmark) { if (Array.isArray(landmark[1])) filters.locations = landmark[1]; else filters.location = landmark[1]; }
  if (word('thuê').test(text)) filters.transaction_type = 'Rent';
  else if (word('mua|bán').test(text)) filters.transaction_type = 'Sale';
  const district = text.match(/\b(?:quận|q\.?)\s*(\d{1,2})\b/i);
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const nearCentre = /gan\s+(?:quan\s*1|trung\s*tam)|di\s*lam\s+(?:quan\s*1|trung\s*tam)/i.test(normalized);
  const place = places.find(name => text.toLocaleLowerCase('vi').includes(name.toLocaleLowerCase('vi')));
  if (district) filters.location = `Quận ${district[1]}`;
  else if (place) filters.location = place;
  if (nearCentre) { filters.locations = centralFormerDistricts; delete filters.location; }
  const type = types.find(([pattern]) => pattern.test(text));
  if (type) filters.type = type[1];
  const keywords = searchKeywords(text);
  if (keywords.length) filters.keywords = keywords;
  const below = text.match(/(?:dưới|tối đa|không quá|<=?|tầm|khoảng|budget|ngân sách)[^\d]{0,12}([\d.,]+\s*(?:tỷ|tỉ|triệu|tr))/i);
  const above = text.match(/(?:trên|từ|tối thiểu|>=?)[^\d]{0,12}([\d.,]+\s*(?:tỷ|tỉ|triệu|tr))/i);
  const amount = (raw: string) => moneyAmounts(raw.replace(/\btr\b/i, 'triệu'))[0];
  if (below) { const value = amount(below[1]); if (value) filters.maxPrice = /tầm|khoảng/i.test(below[0]) ? Math.round(value * 1.15) : value; }
  if (above && above[0] !== below?.[0]) { const value = amount(above[1]); if (value) filters.minPrice = value; }
  const area = text.match(/(?:diện\s*tích\s*)?(?:khoảng|tầm)\s*([\d.,]+)\s*(?:m\s*[²2]|mét\s*vuông)/i);
  const areaAbove = text.match(/(?:trên|từ)\s*([\d.,]+)\s*(?:m\s*[²2]|mét\s*vuông)/i);
  const areaBelow = text.match(/(?:dưới|tối đa|không quá)\s*([\d.,]+)\s*(?:m\s*[²2]|mét\s*vuông)/i);
  const areaValue = (raw: string) => Number(raw.replace(',', '.').replace(/\.(?=\d{3}\b)/g, ''));
  if (area) { const value = areaValue(area[1]); if (Number.isFinite(value)) { filters.minArea = Math.round(value * .85); filters.maxArea = Math.round(value * 1.15); } }
  if (areaAbove) { const value = areaValue(areaAbove[1]); if (Number.isFinite(value)) filters.minArea = value; }
  if (areaBelow) { const value = areaValue(areaBelow[1]); if (Number.isFinite(value)) filters.maxArea = value; }
  // No buy/rent word: a price in tỷ is a purchase, a price per month is a rent ("nhà ở Quận 7 giá dưới 5 tỷ").
  if (!filters.transaction_type) {
    if (/\d\s*(?:tỷ|tỉ)(?![\p{L}])/iu.test(text)) filters.transaction_type = 'Sale';
    else if (/(?:triệu|tr)\s*(?:\/|một|mỗi)\s*tháng/iu.test(text)) filters.transaction_type = 'Rent';
  }
  // "có (khoảng) 2 tỷ tiền mặt… vay thêm": the amount is cash in hand; the ceiling assumes a ~60% loan.
  const cash = /\bvay\b/i.test(normalized) ? moneyAmounts(text)[0] : undefined;
  if (cash) { filters.maxPrice = Math.round(cash * 2.5); delete filters.minPrice; }
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.minPrice > filters.maxPrice) delete filters.minPrice;
  return filters;
}
