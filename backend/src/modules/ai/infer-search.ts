import { moneyAmounts } from './money.js';

export type InferredSearch = { location?: string; type?: string; minPrice?: number; maxPrice?: number; transaction_type?: 'Sale'|'Rent' };

// `\b` does not understand Vietnamese letters, so word edges use Unicode lookarounds.
const word = (source: string) => new RegExp(`(?<![\\p{L}])(?:${source})(?![\\p{L}])`, 'iu');
const types: [RegExp, string][] = [
  [word('biệt thự'), 'Villa'], [word('căn hộ|chung cư|studio|penthouse|duplex'), 'Apartment'], [word('văn phòng'), 'Office'],
  [word('mặt bằng|shophouse|kiot|cửa hàng'), 'Shop'], [word('đất nền|lô đất|đất'), 'Land'], [word('nhà phố|nhà riêng|nhà'), 'House'],
];
const places = ['Thủ Đức', 'Bình Thạnh', 'Gò Vấp', 'Tân Bình', 'Tân Phú', 'Phú Nhuận', 'Bình Tân', 'Nhà Bè', 'Củ Chi', 'Hóc Môn', 'Bình Chánh', 'Cần Giờ', 'Thảo Điền', 'Phú Mỹ Hưng', 'Thủ Thiêm'];
const propertyWords = /căn hộ|chung cư|nhà|đất|biệt thự|văn phòng|mặt bằng|bất động sản|bđs|thuê|mua|bán|giá|tỷ|triệu|phòng ngủ|quận|khu vực/i;

// Turns a customer question into catalogue filters so the assistant always answers
// from a real search instead of relying on the model to request one.
export function inferSearch(text: string): InferredSearch | null {
  if (!propertyWords.test(text)) return null;
  const filters: InferredSearch = {};
  if (word('thuê').test(text)) filters.transaction_type = 'Rent';
  else if (word('mua|bán').test(text)) filters.transaction_type = 'Sale';
  const district = text.match(/\b(?:quận|q\.?)\s*(\d{1,2})\b/i);
  const place = places.find(name => text.toLocaleLowerCase('vi').includes(name.toLocaleLowerCase('vi')));
  if (district) filters.location = `Quận ${district[1]}`;
  else if (place) filters.location = place;
  const type = types.find(([pattern]) => pattern.test(text));
  if (type) filters.type = type[1];
  const below = text.match(/(?:dưới|tối đa|không quá|<=?|tầm|khoảng|budget|ngân sách)[^\d]{0,12}([\d.,]+\s*(?:tỷ|tỉ|triệu|tr))/i);
  const above = text.match(/(?:trên|từ|tối thiểu|>=?)[^\d]{0,12}([\d.,]+\s*(?:tỷ|tỉ|triệu|tr))/i);
  const amount = (raw: string) => moneyAmounts(raw.replace(/\btr\b/i, 'triệu'))[0];
  if (below) { const value = amount(below[1]); if (value) filters.maxPrice = /tầm|khoảng/i.test(below[0]) ? Math.round(value * 1.15) : value; }
  if (above && above[0] !== below?.[0]) { const value = amount(above[1]); if (value) filters.minPrice = value; }
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.minPrice > filters.maxPrice) delete filters.minPrice;
  return filters;
}
