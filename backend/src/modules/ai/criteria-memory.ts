import { budgetFilters, inferSearch, type InferredSearch } from './infer-search.js';

export const criteriaKeys = [
  'transaction_type',
  'type',
  'types',
  'location',
  'locations',
  'location_aliases',
  'minPrice',
  'maxPrice',
  'maxPriceExclusive',
  'bedrooms',
  'minArea',
  'maxArea',
  'minBedrooms',
  'maxBedrooms',
] as const;

const criteriaAliases: Record<string, string> = {
  min_price_vnd: 'minPrice',
  max_price_vnd: 'maxPrice',
  min_area_m2: 'minArea',
  max_area_m2: 'maxArea',
  property_type: 'type',
  property_types: 'types',
};

export type Criteria = Partial<
  Pick<
    InferredSearch,
    | 'transaction_type'
    | 'type'
    | 'types'
    | 'location'
    | 'locations'
    | 'location_aliases'
    | 'minPrice'
    | 'maxPrice'
    | 'maxPriceExclusive'
    | 'bedrooms'
    | 'minArea'
    | 'maxArea'
    | 'minBedrooms'
    | 'maxBedrooms'
  >
>;

export type CriteriaRefinement = { question: string; options: string[] };
export type CriteriaQuestion = {
  needed: boolean;
  question: string | null;
  options: string[];
  refine?: CriteriaRefinement;
};

const propertyTypes = new Set(['Apartment', 'House', 'Land', 'Villa', 'Office', 'Shop']);
const numericKeys = new Set(['minPrice', 'maxPrice', 'bedrooms', 'minArea', 'maxArea', 'minBedrooms', 'maxBedrooms']);
const arrayKeys = new Set(['types', 'locations', 'location_aliases']);
const budgetKeys = ['minPrice', 'maxPrice', 'maxPriceExclusive'] as const;
const budgetOptions = {
  Rent: ['Dưới 10 triệu', '10–20 triệu', 'Chưa rõ, gợi ý giúp tôi'],
  Sale: ['Dưới 3 tỷ', '3–6 tỷ', '6–10 tỷ', 'Trên 10 tỷ', 'Chưa rõ, gợi ý giúp tôi'],
} as const;
const areaOptions = ['Quận 7', 'Bình Thạnh', 'Thủ Đức', 'Chưa rõ, gợi ý giúp tôi'];
const bedroomOptions = ['1 PN', '2 PN', '3 PN+'];
const floorAreaOptions = ['Dưới 50 m²', '50–80 m²', 'Trên 80 m²'];

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLocaleLowerCase('vi');

function hasWholeWord(text: string, value: string) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${value}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

function isExplicitFullSearch(message: string, parsed: Criteria) {
  const text = fold(message);
  const hasAction = ['tim', 'kiem', 'mua', 'thue', 'can', 'muon'].some((word) => hasWholeWord(text, word));
  const hasObject = Boolean(
    parsed.type || parsed.types || /can ho|chung cu|nha pho|nha rieng|dat nen|biet thu/iu.test(text),
  );
  const hasPlace = Boolean(
    parsed.location ||
    parsed.locations?.length ||
    /quan\s*\d|q\.?\s*\d|thu duc|go vap|binh thanh|tan binh|tan phu|phu nhuan|binh tan|vung tau/iu.test(text),
  );
  return hasAction && hasObject && hasPlace;
}

function isRelaxingBedrooms(message: string, parsed: Criteria) {
  const text = fold(message);
  return (
    /(?:bo|khong can|khong nhat thiet).*(?:phong ngu|pn|bedroom|studio)/iu.test(text) ||
    (parsed.bedrooms !== undefined && /(?:phong ngu|pn|bedroom|studio).*(?:cung duoc|deu duoc|duoc)/iu.test(text))
  );
}

function isStudioMention(message: string) {
  return /(?:\bstudio\b|(?<![\p{L}\d])0\s*(?:PN|phòng\s*ngủ|phòng)(?![\p{L}\d]))/iu.test(message);
}

function criteriaFromMessage(message: string): Criteria {
  const inferred = { ...(inferSearch(message) || {}), ...budgetFilters(message) };
  if (isStudioMention(message)) inferred.bedrooms = 0;
  const hasBudget = budgetKeys.some((key) => inferred[key] !== undefined);
  const hasSearchContext =
    inferred.location !== undefined ||
    inferred.locations !== undefined ||
    inferred.type !== undefined ||
    inferred.types !== undefined;
  if (hasBudget && !hasSearchContext && !/(?:mua|b[aá]n|thu[eê]|cho\s+thu[eê]|rent|buy|sale)/iu.test(message))
    delete inferred.transaction_type;
  return Object.fromEntries(
    criteriaKeys.flatMap((key) => (inferred[key] === undefined ? [] : [[key, inferred[key]]])),
  ) as Criteria;
}

export function validCriteria(value: unknown): value is Criteria {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !criteriaKeys.includes(key as (typeof criteriaKeys)[number]))) return false;
  for (const [key, item] of Object.entries(record)) {
    if (numericKeys.has(key)) {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) return false;
      if (
        (key === 'bedrooms' || key === 'minBedrooms' || key === 'maxBedrooms') &&
        (!Number.isInteger(item) || item > 100)
      )
        return false;
      if (key !== 'bedrooms' && item > (key.includes('Price') ? 1e15 : 1e6)) return false;
    } else if (key === 'maxPriceExclusive') {
      if (typeof item !== 'boolean') return false;
    } else if (key === 'transaction_type') {
      if (item !== 'Sale' && item !== 'Rent') return false;
    } else if (key === 'type') {
      if (typeof item !== 'string' || !propertyTypes.has(item)) return false;
    } else if (arrayKeys.has(key)) {
      if (
        !Array.isArray(item) ||
        item.length === 0 ||
        item.length > 100 ||
        item.some((entry) => typeof entry !== 'string')
      )
        return false;
      if (key === 'types' && item.some((entry) => !propertyTypes.has(entry))) return false;
    }
  }
  return (
    !(
      typeof record.minPrice === 'number' &&
      typeof record.maxPrice === 'number' &&
      record.minPrice > record.maxPrice
    ) &&
    !(
      typeof record.minBedrooms === 'number' &&
      typeof record.maxBedrooms === 'number' &&
      record.minBedrooms > record.maxBedrooms
    )
  );
}

export function normalizeCriteria(value: Criteria): Criteria {
  return Object.fromEntries(
    criteriaKeys.flatMap((key) => (value[key] === undefined ? [] : [[key, value[key]]])),
  ) as Criteria;
}

/** Keep catalogue criteria only when the customer supplied them explicitly. */
export function retainUserCriteria(filters: Record<string, unknown>, userCriteria: Criteria) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([key]) =>
        !criteriaKeys.includes((criteriaAliases[key] || key) as (typeof criteriaKeys)[number]) ||
        userCriteria[(criteriaAliases[key] || key) as keyof Criteria] !== undefined,
    ),
  );
}

function criteriaLocation(criteria: Criteria) {
  return typeof criteria.location === 'string' && criteria.location.trim()
    ? criteria.location
    : Array.isArray(criteria.locations) && criteria.locations.length
      ? String(criteria.locations[0])
      : '';
}

function criteriaAction(transaction: Criteria['transaction_type']) {
  return transaction === 'Rent' ? 'thuê' : 'mua';
}

export function nextCriteriaQuestion(criteria: Criteria, address = 'Bạn'): CriteriaQuestion | null {
  if (criteria.transaction_type !== 'Rent' && criteria.transaction_type !== 'Sale') return null;

  const location = criteriaLocation(criteria);
  const hasBudget = budgetKeys.some((key) => criteria[key] !== undefined);
  const action = criteriaAction(criteria.transaction_type);
  if (location && !hasBudget)
    return {
      needed: true,
      question: `${address} muốn ${action} ở ${location}; ngân sách khoảng bao nhiêu${action === 'thuê' ? ' mỗi tháng' : ''}?`,
      options: [...budgetOptions[criteria.transaction_type]],
    };
  if (!location && hasBudget)
    return {
      needed: true,
      question: `${address} muốn ${action} ở khu vực nào (quận/phường)? Nếu chưa chắc, mình gợi ý vài khu nhé.`,
      options: [...areaOptions],
    };
  if (!location || !hasBudget) return null;

  const missingBedrooms = criteria.bedrooms === undefined;
  const missingArea = criteria.minArea === undefined && criteria.maxArea === undefined;
  const options = [...(missingBedrooms ? bedroomOptions : []), ...(missingArea ? floorAreaOptions : [])];
  if (!options.length) return { needed: false, question: null, options: [] };
  const question =
    missingBedrooms && missingArea
      ? 'Bạn muốn ưu tiên số phòng ngủ hay diện tích khoảng bao nhiêu?'
      : missingBedrooms
        ? 'Bạn ưu tiên mấy phòng ngủ?'
        : 'Bạn ưu tiên diện tích khoảng bao nhiêu?';
  return { needed: false, question: null, options: [], refine: { question, options } };
}

type CriteriaHistoryTurn = {
  role: string;
  content: string;
  sources?: unknown[];
};

export function isListedCardFollowUp(message: string, history: CriteriaHistoryTurn[]) {
  const hasListedCards = history.some(
    (turn) =>
      turn.role === 'assistant' &&
      ((Array.isArray(turn.sources) && turn.sources.length > 0) || /\[\d{1,3}\]/u.test(turn.content)),
  );
  if (!hasListedCards) return false;
  const referencesCard = /\d/.test(message) || /so\s+s.{0,4}nh|compare|căn\s+(?:này|đó)/iu.test(message);
  const followUp = /vay|borrow|so\s+s.{0,4}nh|compare|phap|pháp|giay|giấy|so|sổ|chi|detail|monthly|giá/iu.test(message);
  return referencesCard && followUp;
}

export function mergeCriteria(previous: Criteria, message: string): Criteria {
  const base = normalizeCriteria(previous);
  const current = criteriaFromMessage(message);
  const areaOnlyUpdate =
    current.transaction_type !== undefined &&
    (current.location !== undefined || current.locations !== undefined) &&
    !current.type &&
    !current.types &&
    !budgetKeys.some((key) => current[key] !== undefined) &&
    current.bedrooms === undefined &&
    !/(?:mua|b[aá]n|thu[eê]|cho\s+thu[eê]|rent|buy|sale)/iu.test(message);
  if (areaOnlyUpdate) delete current.transaction_type;
  if (!Object.keys(current).length) return base;
  if (isExplicitFullSearch(message, current)) return current;

  const merged: Criteria = { ...base };
  const locationChanged = current.location !== undefined || current.locations !== undefined;
  const typeChanged = current.type !== undefined || current.types !== undefined;
  const transactionChanged =
    current.transaction_type !== undefined && current.transaction_type !== base.transaction_type;
  const hasNewBudget = budgetKeys.some((key) => current[key] !== undefined);

  if (locationChanged) {
    delete merged.location;
    delete merged.locations;
    delete merged.location_aliases;
  }
  if (typeChanged) {
    delete merged.type;
    delete merged.types;
  }
  if (transactionChanged && !hasNewBudget) {
    for (const key of budgetKeys) delete merged[key];
  }
  if (isRelaxingBedrooms(message, current)) delete merged.bedrooms;

  if (isRelaxingBedrooms(message, current)) {
    const allowed = current.bedrooms;
    if (typeof allowed === 'number' && typeof base.bedrooms === 'number') {
      merged.minBedrooms = Math.min(allowed, base.bedrooms);
      merged.maxBedrooms = Math.max(allowed, base.bedrooms);
      delete merged.bedrooms;
    } else {
      delete merged.bedrooms;
      delete merged.minBedrooms;
      delete merged.maxBedrooms;
    }
  }

  for (const [key, value] of Object.entries(current)) {
    if (key === 'bedrooms' && isRelaxingBedrooms(message, current)) continue;
    merged[key as keyof Criteria] = value as never;
  }
  if (current.minPrice !== undefined && current.maxPrice !== undefined) delete merged.maxPriceExclusive;
  if (current.location !== undefined) delete merged.locations;
  if (current.locations !== undefined) delete merged.location;
  if (current.type !== undefined) delete merged.types;
  if (current.types !== undefined) delete merged.type;
  return normalizeCriteria(merged);
}
