import { moneyAmounts } from './money.js';
import { loanWords, noLoanWords } from './unsupported.js';

export type InferredSearch = {
  location?: string;
  locations?: string[];
  location_aliases?: string[];
  type?: string;
  types?: string[];
  minPrice?: number;
  maxPrice?: number;
  maxPriceExclusive?: boolean;
  minArea?: number;
  maxArea?: number;
  bedrooms?: number;
  minBedrooms?: number;
  maxBedrooms?: number;
  transaction_type?: 'Sale' | 'Rent';
  keywords?: string[];
};
export const centralFormerDistricts = [
  'Quận 1',
  'Quận 2',
  'Quận 3',
  'Quận 4',
  'Quận 5',
  'Quận 7',
  'Quận 10',
  'Quận Bình Thạnh',
  'Phú Nhuận',
];
const landmarkLocations: [RegExp, string | string[]][] = [
  [/RMIT|Tôn Đức Thắng|Phú Mỹ Hưng/i, 'Quận 7'],
  [/Landmark\s*81/i, 'Quận Bình Thạnh'],
  [/Tân Sơn Nhất/i, 'Tân Bình'],
  [/Đại học Quốc gia|Làng Đại học/i, 'Thủ Đức'],
  [
    /Bến Thành|Nhà thờ Đức Bà|phố đi bộ Nguyễn Huệ|trung tâm (?:thành phố|Sài Gòn|TP.?|Q.? ?1|quận 1)|gần trung tâm(?! (?:mua sắm|thương mại|hành chính))/iu,
    ['Quận 1', 'Quận 3', 'Quận 4', 'Quận 5', 'Quận 10', 'Quận Bình Thạnh'],
  ],
  [/Thảo Điền/i, 'Quận 2'],
  [/Bitexco/i, 'Quận 1'],
];
const word = (source: string) => new RegExp(`(?<![\\p{L}])(?:${source})(?![\\p{L}])`, 'iu');

export function inferTransactionType(text: string): 'Sale' | 'Rent' | undefined {
  const n = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const mua = word('mua').test(text) || word('mua').test(n);
  if (
    !mua &&
    (word('thue').test(n) ||
      word('thuê').test(text) ||
      /rent|for\s+rent|\d[\d.,\s]*\s*trieu\s*\/\s*thang/.test(n) ||
      /\/\s*thang|hang\s*thang|moi\s*thang/.test(n) ||
      /^\s*o\s+(?:quan|q\.?\s*\d|khu\s+vuc)\b/i.test(n))
  )
    return 'Rent';
  if (mua || /buy|for\s+sale|sale|\d[\d.,\s]*\s*ty\b/.test(n) || /\d[\d.,\s]*\s*(?:tỷ|tỉ)(?![\p{L}])/iu.test(text))
    return 'Sale';
  return undefined;
}

const types: [RegExp, string][] = [
  [word('biệt thự'), 'Villa'],
  [word('căn hộ|can ho|chung cư|studio|penthouse|duplex|apartment|condo'), 'Apartment'],
  [word('văn phòng'), 'Office'],
  [word('mặt bằng|shophouse|kiot|cửa hàng'), 'Shop'],
  [word('đất nền|lô đất|nền|đất'), 'Land'],
  [
    word(
      'nhà phố|nhà riêng|nhà nguyên căn|nhà mặt tiền|nhà mặt phố|nhà hẻm|nhà cấp 4|nhà [0-9]+ tầng|nhà [0-9]+ lầu|nhà [0-9]+ trệt',
    ),
    'House',
  ],
  [word('nhà'), 'House'],
];
const unspecifiedPropertyType =
  /(?:nhà\s+đất|bất động sản|(?<![\p{L}])bđs(?![\p{L}])|(?<![\p{L}])bds(?![\p{L}])|(?<![\p{L}])căn(?!\s*hộ))/iu;
const places = [
  'Thủ Đức',
  'Biên Hòa',
  'Đồng Nai',
  'Bình Thạnh',
  'Gò Vấp',
  'Tân Bình',
  'Tân Phú',
  'Phú Nhuận',
  'Bình Tân',
  'Nhà Bè',
  'Củ Chi',
  'Hóc Môn',
  'Bình Chánh',
  'Cần Giờ',
  'Vũng Tàu',
  'Thảo Điền',
  'Phú Mỹ Hưng',
  'Thủ Thiêm',
];
const propertyWords =
  /căn(?: hộ)?|can(?: ho)?|chung cư|chỗ ở|cho o|nhà|đất|biệt thự|văn phòng|mặt bằng|bất động sản|bđs|bds|thuê|thue|rent|mua|buy|bán|sale|giá|ngân sách|tỷ|triệu|million|billion|phòng ngủ|quận|quan|district|khu vực|diện tích|nhận nhà ngay|dọn vào ở ngay|khu dân cư|vợ chồng|trường học|bệnh viện|chợ|siêu thị|trung tâm thương mại|hẻm|yên tĩnh|máy lạnh|máy giặt|nội thất|đậu ô tô|gara|tầng thấp|tầng cao|ban công|view|hồ bơi|gym|thang máy|giảm giá|ngộp|cắt lỗ|hạ giá|chiết khấu|giá tốt|chỉ còn|\bm\s*[²2]\b|apartment|house/i;

const keywordRules: [RegExp, string][] = [
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
keywordRules.push([/o to vao|xe hoi|hem xe hoi/iu, 'đậu ô tô']);
const searchKeywords = (text: string) => {
  const normalized = text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLocaleLowerCase('vi');
  return [...new Set(keywordRules.filter(([pattern]) => pattern.test(normalized)).map(([, keyword]) => keyword))];
};

const explicitHouse = word(
  'nhà phố|nhà riêng|nhà nguyên căn|nhà mặt tiền|nhà mặt phố|nhà hẻm|nhà cấp 4|nhà [0-9]+ tầng|nhà [0-9]+ lầu|nhà [0-9]+ trệt',
);

// Generic home wording describes a place to live, not the House catalogue type.
export function genericHome(text: string) {
  if (
    explicitHouse.test(text) ||
    unspecifiedPropertyType.test(text) ||
    word('căn hộ|can ho|chung cư|studio|penthouse|duplex|apartment|condo').test(text)
  )
    return false;
  return /(?:thuê|mua|tìm|gợi ý)\s+nhà|(?<![\p{L}])nhà(?![\p{L}])(?:\s+(?:ở|để ở|quận|huyện|q\.?\s*\d))?|chỗ\s+ở/iu.test(
    text,
  );
}

export type BudgetFilters = Pick<InferredSearch, 'minPrice' | 'maxPrice' | 'maxPriceExclusive'>;

export function budgetFilters(text: string): BudgetFilters {
  const amount = (raw: string) => moneyAmounts(raw.replace(/(?<![\p{L}])tr(?![\p{L}])/iu, 'triệu'))[0];
  const filters: BudgetFilters = {};
  const range = text.match(
    /([\d.,]+)\s*(tỷ|tỉ|ty|billion|triệu|tr|million)?\s*(?:-|–|—|đến|tới)\s*([\d.,]+)\s*(tỷ|tỉ|ty|billion|triệu|tr|million)?/iu,
  );
  const rangeAmount = (raw: string, fallbackUnit?: string) =>
    amount(
      fallbackUnit && !/(?:tỷ|tỉ|ty|billion|triệu|tr|million)(?![\p{L}])/iu.test(raw) ? `${raw} ${fallbackUnit}` : raw,
    );
  if (range) {
    const unit = range[2] || range[4];
    const first = rangeAmount(range[1], unit);
    const second = rangeAmount(range[3], unit);
    if (first && second) {
      filters.minPrice = Math.min(first, second);
      filters.maxPrice = Math.max(first, second);
      filters.maxPriceExclusive = false;
    }
    return filters;
  }
  const below = text.match(
    /(?:dưới|duoi|tối đa|toi da|không quá|khong qua|<=?|tầm|tam|khoảng|khoang|budget|ngân sách|ngan sach|under|below)[^\d]{0,12}([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|trieu|tr|million|billion))/iu,
  );
  const above = text.match(
    /(?:trên|từ|tối thiểu|>=?|over|above)[^\d]{0,12}([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|trieu|tr|million|billion))/iu,
  );
  if (below) {
    const value = amount(below[1]);
    if (value) {
      filters.maxPrice = /tầm|khoảng/i.test(below[0]) ? Math.round(value * 1.1) : value;
      if (/(?:dưới|duoi)/i.test(below[0])) filters.maxPriceExclusive = true;
    }
  }
  if (above && above[0] !== below?.[0]) {
    const value = amount(above[1]);
    if (value) filters.minPrice = value;
  }
  if (!below && !above) {
    const bareAmount = text.match(/(?<![\p{L}\d])([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|trieu|tr))(?![\p{L}])/iu);
    if (bareAmount) {
      const value = amount(bareAmount[1]);
      if (value) filters.maxPrice = value;
    }
  }
  const statedBudget = text.match(
    /(?:chỉ\s+có|có|trong\s+tay|vốn|tài\s+chính)[^\d]{0,40}([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|trieu|tr))(?![\p{L}])/iu,
  );
  if (statedBudget) {
    const value = amount(statedBudget[1]);
    if (value) {
      filters.maxPrice = value;
      delete filters.minPrice;
      filters.maxPriceExclusive = false;
    }
  }
  const moneyMentions = [...text.matchAll(/([\d.,]+)\s*(tỷ|tỉ|ty|triệu|trieu|tr)(?![\p{L}])/giu)];
  const correction =
    /(?:nhầm|sửa\s*lại|thật\s*ra|thay\s*vào\s*đó|đổi\s+thành|chỉ\s+có|vẫn\s+muốn|à\s*(?:không|nhầm))|thôi\s*$/iu;
  for (const mention of moneyMentions) {
    const start = mention.index || 0;
    const before = text.slice(Math.max(0, start - 48), start);
    const after = text.slice(start + mention[0].length, start + mention[0].length + 24);
    if (!correction.test(`${before} ${after}`) && !/chỉ\s*có/i.test(before)) continue;
    const value = amount(mention[0]);
    if (value) {
      filters.maxPrice = value;
      delete filters.minPrice;
      filters.maxPriceExclusive = false;
    }
  }
  return filters;
}

export function inferSearch(text: string): InferredSearch | null {
  const standalonePlace = places.some((name) => text.trim().toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'));
  const asciiDistrictOnly = /(?:^|\s)(?:q|quan)\s*\d{1,2}(?:\s|$)/iu.test(text.normalize('NFD').replace(/\p{M}/gu, ''));
  if (
    !propertyWords.test(text) &&
    !standalonePlace &&
    !asciiDistrictOnly &&
    !places.some((name) => text.toLocaleLowerCase('vi').includes(name.toLocaleLowerCase('vi')))
  )
    return null;
  const filters: InferredSearch = {};
  const landmark = landmarkLocations.find(([pattern]) => pattern.test(text));
  if (landmark) {
    if (Array.isArray(landmark[1])) filters.locations = landmark[1];
    else filters.location = landmark[1];
  }
  const transaction = inferTransactionType(text);
  if (transaction) filters.transaction_type = transaction;
  else if (word('mua|bán').test(text)) filters.transaction_type = 'Sale';
  const district = [...text.matchAll(/(?:quận|quan|q\.?|district)\s*(\d{1,2})(?![\p{L}\d])/giu)].at(-1);
  const normalized = text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase();
  const nearCentre =
    /gan\s+(?:quan\s*1|trung\s*tam)|di\s*lam\s+(?:quan\s*1|trung\s*tam)|cach\s+(?:trung\s*tam|quan\s*1)\s+(?:khong\s+qua\s+)?\d+\s*km|\d+\s*km\s+(?:den\s+)?trung\s*tam/i.test(
      normalized,
    );
  const asciiPlaces: [string, string][] = [
    ['thu duc', 'Thủ Đức'],
    ['bien hoa', 'Biên Hòa'],
    ['binh thanh', 'Bình Thạnh'],
    ['go vap', 'Gò Vấp'],
    ['tan binh', 'Tân Bình'],
    ['quan 7', 'Quận 7'],
    ['q7', 'Quận 7'],
    ['quan 9', 'Quận 9'],
    ['q9', 'Quận 9'],
  ];
  const place =
    places.find((name) => text.toLocaleLowerCase('vi').includes(name.toLocaleLowerCase('vi'))) ||
    asciiPlaces.find(([name]) => normalized.includes(name))?.[1];
  if (district) filters.location = `Quận ${district[1]}`;
  else if (place) filters.location = place;
  if (nearCentre) {
    filters.locations = centralFormerDistricts;
    delete filters.location;
  }
  const type = types.find(([pattern]) => pattern.test(text));
  if (type) filters.type = type[1];
  if (unspecifiedPropertyType.test(text) && !explicitHouse.test(text)) delete filters.type;
  const bedrooms = text.match(/(?<!\d)(\d+)\s*(?:phòng\s*ngủ|pn|phòng)(?!\p{L})/iu);
  if (bedrooms) filters.bedrooms = Number(bedrooms[1]);
  const bedroomRange = text.match(/(?<!\d)(\d+)\s*(?:-|–|—|đến)\s*(\d+)\s*(?:phòng\s*ngủ|pn|phòng)(?!\p{L})/iu);
  if (bedroomRange) {
    filters.minBedrooms = Math.min(Number(bedroomRange[1]), Number(bedroomRange[2]));
    filters.maxBedrooms = Math.max(Number(bedroomRange[1]), Number(bedroomRange[2]));
    delete filters.bedrooms;
  }
  const keywords = searchKeywords(text);
  if (keywords.length) filters.keywords = keywords;
  Object.assign(filters, budgetFilters(text));
  if (genericHome(text)) {
    delete filters.type;
    filters.types = ['House', 'Apartment'];
  }
  const area = text.match(/(?:diện\s*tích\s*)?(?:khoảng|tầm)\s*([\d.,]+)\s*(?:m\s*[²2]|mét\s*vuông)/i);
  const areaRange = text.match(/(?<![\d])([\d.,]+)\s*(?:-|–|—|đến)\s*([\d.,]+)\s*(?:m\s*[²2]|mét\s*vuông)/iu);
  const areaAbove = [
    ...text.matchAll(/(?:trên|từ|tối\s*thiểu|ít\s*nhất|>=?)\s*([\d.,]+)\s*(?:m\s*[²2]|mét\s*vuông)/giu),
  ].at(-1);
  const areaBelow = [
    ...text.matchAll(/(?:dưới|tối\s*đa|không\s*quá|<=?)\s*([\d.,]+)\s*(?:m\s*[²2]|mét\s*vuông)/giu),
  ].at(-1);
  const areaValue = (raw: string) => Number(raw.replace(',', '.').replace(/\.(?=\d{3}\b)/g, ''));
  if (area) {
    const value = areaValue(area[1]);
    if (Number.isFinite(value)) {
      filters.minArea = Math.round(value * 0.85);
      filters.maxArea = Math.round(value * 1.15);
    }
  }
  if (areaAbove) {
    const value = areaValue(areaAbove[1]);
    if (Number.isFinite(value)) filters.minArea = value;
  }
  if (areaBelow) {
    const value = areaValue(areaBelow[1]);
    if (Number.isFinite(value)) filters.maxArea = value;
  }
  if (areaRange) {
    const first = areaValue(areaRange[1]);
    const second = areaValue(areaRange[2]);
    if (Number.isFinite(first) && Number.isFinite(second)) {
      filters.minArea = Math.min(first, second);
      filters.maxArea = Math.max(first, second);
    }
  }
  // No buy/rent word: a price in tỷ is a purchase, a price per month is a rent ("nhà ở Quận 7 giá dưới 5 tỷ").
  if (!filters.transaction_type) {
    if (/\d\s*(?:tỷ|tỉ)(?![\p{L}])/iu.test(text)) filters.transaction_type = 'Sale';
    else if (/(?:triệu|tr)\s*(?:\/|một|mỗi)\s*tháng/iu.test(text)) filters.transaction_type = 'Rent';
  }
  const statedCash = text.match(
    /(?:có|sẵn|tiền mặt|tự có|trong tay|vốn|tài chính)[^\d]{0,24}([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|tr))(?![\p{L}])/iu,
  )?.[1];
  const cash = statedCash ? moneyAmounts(statedCash)[0] : undefined;
  const purchasePriceMatch = text.match(/(?:căn|nhà|đất|giá)[^\d]{0,20}([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|tr))(?![\p{L}])/iu);
  const purchasePrice =
    cash && purchasePriceMatch && (purchasePriceMatch.index || 0) > (statedCash ? text.indexOf(statedCash) : -1)
      ? moneyAmounts(purchasePriceMatch[1])[0]
      : undefined;
  const statedLoan = text.match(
    /(?:vay|khoản vay|trả góp)[^\d]{0,20}([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|tr))(?![\p{L}])/iu,
  )?.[1];
  const loanAmount = statedLoan ? moneyAmounts(statedLoan)[0] : undefined;
  // A purchase price is a price, cash is equity, and an amount after "vay" is debt.
  // Never turn the debt amount into cash, and never infer a 60%-loan budget after
  // the customer explicitly says that borrowing is not wanted.
  if (purchasePrice) {
    filters.maxPrice = purchasePrice;
    delete filters.minPrice;
    filters.maxPriceExclusive = false;
  } else if (loanWords(text) && cash && !loanAmount) {
    filters.maxPrice = Math.round(cash * 2.5);
    delete filters.minPrice;
    filters.maxPriceExclusive = false;
  } else if (loanWords(text) && loanAmount && !cash) {
    delete filters.minPrice;
    delete filters.maxPrice;
    delete filters.maxPriceExclusive;
  }
  if (noLoanWords(text) && cash) {
    filters.maxPrice = cash;
    delete filters.minPrice;
    filters.maxPriceExclusive = true;
  }
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.minPrice > filters.maxPrice)
    delete filters.minPrice;
  return filters;
}
