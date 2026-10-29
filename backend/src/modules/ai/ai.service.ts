import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies, validOrigin, requestClientIp } from '../../common/http.js';
import { WebRequest as NextRequest } from '../../common/http.js';
import { Injectable } from '@nestjs/common';
import {
  AiLlmService,
  AiGuardService,
  AiExtractionService,
  AiScoringService,
  AiPrivacyService,
} from './ai-logic.services.js';
import { authenticatedSession, authClient, consumeAttempt } from '../auth/session.js';
import { systemClient } from '../supabase/supabase.service.js';
import { catalogDatabaseError, catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { uuidPattern } from '../../common/catalog.js';
import { normalizePhone } from '../../common/profile-validation.js';
import { object } from './extraction.js';
import { budgetFilters, inferSearch, inferTransactionType, centralFormerDistricts } from './infer-search.js';
import { type ScoreResult, type Dimension } from './lead-scoring.js';
import {
  correctionData,
  labelMonthlyRent,
  disclosure,
  GUARD_VERSION,
  safeReply,
  groundedSummary,
  isOutOfScope,
  scopeFromTopic,
  outOfScopeReply,
  explicitWriteIntent,
  sourcesFromCitations,
  normalizeCitations,
  discardInvalidCitations,
  redactListingCodesSafe,
  isAbusive,
  abusiveReply,
  dedupeListings,
  rewriteAvailabilityLabels,
  availabilityLabel,
  removeUnpromptedNegotiation,
  normalizeFinalReply,
  assembleFinalReply,
  availabilityNoticeForReply,
  outputDiagnostic,
  rewriteUnsupportedPolicy,
  isValidListingPrice,
  isRawListingDump,
  removeUnpromptedOwnerTemplate,
  formatReplyDate,
  repairUnsupportedRoomClaims,
  removeFutureListingPromise,
  type Evidence,
} from './guard.js';
import {
  RetrievalService,
  renderRetrievedContextWithCards,
  deterministicReason,
  type RetrievalResult,
  type RankedChunk,
} from './retrieval.js';
import { runAgent } from './agent.ts';
import { assistantPrompt, complete, querySearch, checkAnswer, extractNeedsAfterReply, streamAgentStep } from './llm.ts';
import { setAiRequestSession, logAiRequest } from './request-log.js';
import { questionPreview } from './privacy.js';
import {
  adviceOrServiceQuestion,
  budgetFollowUp,
  catalogueOverviewIntent,
  clarificationFor,
  customerNameFromHistory,
  explicitRefilterRequest,
  genericSearchQuestion,
  historyReferenceQuestion,
  isAreaOnlyRefinement,
  isMoreRequest,
  listingCodes,
  missingBudgetQuestion,
  outsideCataloguePlace,
  preserveAreaSwitchCriteria,
  referencedListingCodes,
  renumberReferencedListings,
  searchCriteriaFromHistory,
  textListingReferences,
  isPureClosing,
} from './history-aware.js';
import { catalogueOverview, typeLabels } from './catalogue-overview.js';
import { sanitizeReply, normalizeListedPrices } from './guard.js';
import { withFormerDistrict } from './ward-label.js';
import { areaAliases, withAreaAliases } from './location-aliases.js';
import { moneyAmounts, priceLabel } from './money.js';
import {
  contactRequest,
  loanAssumption,
  loanBudget as inferLoanBudget,
  loanWords,
  noLoanWords,
  noMatchReply,
  hasNoMatchReply,
  hasCatalogueNoMatchReply,
  dedupeNoMatchReply,
  cheaperFallbackReply,
  listingFollowUpFallback,
  ownerRequest,
  ownerValuationQuestion,
  unsupportedCriteria,
  unsupportedLine,
  deterministicNoMatchReply,
  genericQuestionFallback,
} from './unsupported.js';
import { inquiryEvents } from '../../common/inquiry-events.js';
import { displayListingName, shortListingName } from './display.js';
import {
  areaAdviceQuestion,
  areaSummary,
  landPriceQuestion,
  marketSummary,
  priceComparisonQuestion,
  rentLevelQuestion,
} from './market.js';
import {
  annuityPayment,
  financeNoteForQuestion,
  financeEvidenceForQuestion,
  derivedFinanceAmounts,
} from './finance.js';
import { answerCriteriaLine, showCriteriaLine } from './answer-rules.js';
import { correctUnknownReply, removeReplyArtifacts } from './guard.js';
import { nearestReasonForReply, nearestRelaxationStages } from './nearest.js';
import { cardComparisonReply } from './comparison.js';
import { bedroomMatchesFilter, isStudioListing } from './bedroom-filter.js';
import { postgrestIlike } from '../../common/postgrest.js';
import {
  isListedCardFollowUp,
  mergeCriteria,
  nextCriteriaQuestion,
  normalizeCriteria,
  retainUserCriteria,
  validCriteria,
  type Criteria,
} from './criteria-memory.js';

function bedroomRangeMatches(item: Evidence, filters: Record<string, unknown>) {
  if (typeof filters.minBedrooms !== 'number' && typeof filters.maxBedrooms !== 'number')
    return typeof filters.bedrooms !== 'number' || bedroomMatchesFilter(item, Number(filters.bedrooms));
  if (typeof item.bedrooms !== 'number') return true;
  return (
    item.bedrooms >= (typeof filters.minBedrooms === 'number' ? filters.minBedrooms : 0) &&
    item.bedrooms <= (typeof filters.maxBedrooms === 'number' ? filters.maxBedrooms : 100)
  );
}

export const unavailable = () =>
  catalogJson(
    {
      code: 'AI_UNAVAILABLE',
      message:
        'Trợ lý AI tạm thời không khả dụng. Bạn có thể thử lại, xem danh sách bất động sản hoặc gửi yêu cầu tư vấn.',
      retry: true,
      search_url: '/properties',
      inquiry_url: '/customer/inquiries/new',
    },
    503,
  );
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const realEstateWordsForHistory = (text: string) =>
  /căn|nhà|đất|phòng|giá|thuê|mua|bất động sản|dự án|khu vực|diện tích|chuyên viên|lịch xem|yêu thích|Q\d|RV-/i.test(
    text,
  );
async function identity() {
  const session = await authenticatedSession();
  if (session && session.role !== 'User')
    return { error: catalogError('FORBIDDEN', 'Hội thoại dành cho khách hàng.', 403) } as const;
  const cookie = (await cookies()).get('pose-ai-session')?.value;
  const token = cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie : randomBytes(32).toString('hex');
  return {
    session,
    token,
    guestHash: session ? null : hash(token),
    client: session ? authClient(session.access) : null,
  } as const;
}
async function readSession(id: string, who: Awaited<ReturnType<typeof identity>>) {
  if (who.error) return { data: null, error: { code: '42501' } };
  return who.client
    ? who.client.rpc('pose_ai_read_session', { p_session: id })
    : systemClient().rpc('pose_system_ai_read_guest', { p_session: id, p_hash: who.guestHash });
}
async function retrieve(filters: Record<string, unknown>, context: string | null): Promise<Evidence[]> {
  filters = withAreaAliases(filters);
  const scalar = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? value : '');
  const allowed = new Set([
    'location',
    'locations',
    'location_aliases',
    'transaction_type',
    'type',
    'types',
    'minPrice',
    'maxPrice',
    'maxPriceExclusive',
    'minArea',
    'maxArea',
    'bedrooms',
    'minBedrooms',
    'maxBedrooms',
    'exclude_ids',
    'keywords',
  ]);
  if (Object.keys(filters).some((k) => !allowed.has(k))) throw new Error('INVALID_FILTER');
  let query = authClient()
    .from('property_public_catalog')
    .select(
      'id,code,name,description,cover_id,area,bedrooms,price,availability,updated_at,location,property_type,transaction_type,price_period',
    );
  if (context) query = query.eq('id', context);
  const locations = [
    ...(typeof filters.location === 'string' ? [filters.location] : []),
    ...(Array.isArray(filters.locations) ? filters.locations : []),
    ...(Array.isArray(filters.location_aliases) ? filters.location_aliases : []),
  ]
    .map(String)
    .slice(0, 100);
  if (locations.length) query = query.or(locations.map((value) => postgrestIlike('location', value)).join(','));
  if (filters.transaction_type) query = query.eq('transaction_type', filters.transaction_type);
  if (filters.transaction_type === 'Rent') query = query.gte('price', 500_000);
  else if (filters.transaction_type === 'Sale') query = query.gte('price', 50_000_000);
  else
    query = query.or('and(transaction_type.eq.Sale,price.gte.50000000),and(transaction_type.eq.Rent,price.gte.500000)');
  if (filters.type) query = query.eq('property_type', filters.type);
  else if (Array.isArray(filters.types) && filters.types.length) query = query.in('property_type', filters.types);
  if (filters.minPrice !== undefined) query = query.gte('price', filters.minPrice);
  if (filters.maxPrice !== undefined)
    query = filters.maxPriceExclusive ? query.lt('price', filters.maxPrice) : query.lte('price', filters.maxPrice);
  if (filters.minArea !== undefined) query = query.gte('area', filters.minArea);
  if (filters.maxArea !== undefined) query = query.lte('area', filters.maxArea);
  if (filters.bedrooms !== undefined) query = query.or(`bedrooms.is.null,bedrooms.eq.${Number(filters.bedrooms)}`);
  if (Array.isArray(filters.exclude_ids) && filters.exclude_ids.length)
    query = query.not(
      'id',
      'in',
      `(${filters.exclude_ids.map((value) => String(value).replace(/[(),]/g, '')).join(',')})`,
    );
  const result = await query.order('updated_at', { ascending: false }).order('id').limit(15);
  if (result.error) throw new Error('RETRIEVAL_UNAVAILABLE');
  return (result.data || [])
    .map((p) => ({ ...p, price: p.price === null ? null : Number(p.price) }))
    .filter(isValidListingPrice)
    .filter((item) =>
      typeof filters.minBedrooms !== 'number' && typeof filters.maxBedrooms !== 'number'
        ? typeof filters.bedrooms !== 'number' || bedroomMatchesFilter(item, Number(filters.bedrooms))
        : typeof item.bedrooms !== 'number' ||
          (item.bedrooms >= (filters.minBedrooms as number) && item.bedrooms <= (filters.maxBedrooms as number)),
    ) as Evidence[];
}
type StructuredCatalogueResult = { items: Evidence[]; count: number };
async function retrieveStructured(
  filters: Record<string, unknown>,
  context: string | null,
): Promise<StructuredCatalogueResult> {
  filters = withAreaAliases(filters);
  const select =
    'id,code,name,description,cover_id,area,bedrooms,price,availability,updated_at,location,property_type,transaction_type,price_period';
  let query = authClient().from('property_public_catalog').select(select, { count: 'exact' });
  if (context) query = query.eq('id', context);
  const locations = [
    ...(typeof filters.location === 'string' ? [filters.location] : []),
    ...(Array.isArray(filters.locations) ? filters.locations : []),
    ...(Array.isArray(filters.location_aliases) ? filters.location_aliases : []),
  ]
    .map(String)
    .slice(0, 100);
  if (locations.length) query = query.or(locations.map((value) => postgrestIlike('location', value)).join(','));
  if (filters.transaction_type) query = query.eq('transaction_type', filters.transaction_type);
  if (filters.transaction_type === 'Rent') query = query.gte('price', 500_000);
  else if (filters.transaction_type === 'Sale') query = query.gte('price', 50_000_000);
  else
    query = query.or('and(transaction_type.eq.Sale,price.gte.50000000),and(transaction_type.eq.Rent,price.gte.500000)');
  if (filters.type) query = query.eq('property_type', filters.type);
  else if (Array.isArray(filters.types) && filters.types.length) query = query.in('property_type', filters.types);
  if (filters.minPrice !== undefined) query = query.gte('price', filters.minPrice);
  if (filters.maxPrice !== undefined)
    query = filters.maxPriceExclusive ? query.lt('price', filters.maxPrice) : query.lte('price', filters.maxPrice);
  if (filters.minArea !== undefined) query = query.gte('area', filters.minArea);
  if (filters.maxArea !== undefined) query = query.lte('area', filters.maxArea);
  if (filters.bedrooms !== undefined) query = query.or(`bedrooms.is.null,bedrooms.eq.${Number(filters.bedrooms)}`);
  if (Array.isArray(filters.exclude_ids) && filters.exclude_ids.length)
    query = query.not(
      'id',
      'in',
      `(${filters.exclude_ids.map((value) => String(value).replace(/[(),]/g, '')).join(',')})`,
    );
  const result = await query.order('updated_at', { ascending: false }).order('id').limit(1000);
  if (result.error) throw new Error('RETRIEVAL_UNAVAILABLE');
  const items = (result.data || [])
    .map((p) => ({ ...p, price: p.price === null ? null : Number(p.price) }))
    .filter(isValidListingPrice)
    .filter((item) =>
      typeof filters.minBedrooms !== 'number' && typeof filters.maxBedrooms !== 'number'
        ? typeof filters.bedrooms !== 'number' || bedroomMatchesFilter(item, Number(filters.bedrooms))
        : typeof item.bedrooms !== 'number' ||
          (item.bedrooms >= (filters.minBedrooms as number) && item.bedrooms <= (filters.maxBedrooms as number)),
    ) as Evidence[];
  return { items, count: items.length < 1000 ? items.length : Number(result.count ?? 0) };
}
async function retrieveIds(ids: string[]): Promise<Evidence[]> {
  if (!ids.length) return [];
  const result = await authClient()
    .from('property_public_catalog')
    .select(
      'id,code,name,cover_id,area,bedrooms,price,availability,updated_at,location,property_type,transaction_type,price_period',
    )
    .in('id', [...new Set(ids)].slice(0, 100))
    .limit(100);
  if (result.error) throw new Error('RETRIEVAL_UNAVAILABLE');
  const order = new Map(ids.map((id, index) => [id, index]));
  return (result.data || [])
    .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    .map((p) => ({ ...p, price: p.price === null ? null : Number(p.price) }))
    .filter(isValidListingPrice) as Evidence[];
}
async function retrieveCodes(codes: string[]): Promise<Evidence[]> {
  if (!codes.length) return [];
  const result = await authClient()
    .from('property_public_catalog')
    .select(
      'id,code,name,cover_id,area,bedrooms,price,availability,updated_at,location,property_type,transaction_type,price_period',
    )
    .in('code', [...new Set(codes)].slice(0, 5))
    .limit(5);
  if (result.error) throw new Error('RETRIEVAL_UNAVAILABLE');
  const order = new Map(codes.map((code, index) => [code.toLowerCase(), index]));
  return (result.data || [])
    .sort(
      (a, b) =>
        (order.get(a.code.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.code.toLowerCase()) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((p) => ({ ...p, price: p.price === null ? null : Number(p.price) }))
    .filter(isValidListingPrice) as Evidence[];
}
async function retrieveSimilar(propertyId: string): Promise<Evidence[]> {
  const result = await authClient().rpc('pose_similar_properties', { p_property: propertyId, p_limit: 3 });
  if (result.error || !Array.isArray(result.data)) return [];
  const ids = result.data
    .map((row) => (row && typeof row === 'object' && 'id' in row ? String((row as { id: unknown }).id) : ''))
    .filter(Boolean);
  return ids.length ? retrieveIds(ids) : [];
}
// The whole catalogue is in Ho Chi Minh City, whose name is written many ways ("TP.HCM",
// "Thành phố Hồ Chí Minh"…); a city-level location is not a filter and would only miss rows.
const cityOnly = /^(?:tp\.?\s*|thành phố\s*)?(?:hcm|hồ chí minh|ho chi minh|sài gòn|saigon)$/i;
export function locationFilter(value: unknown) {
  return typeof value === 'string' && value.trim() && !cityOnly.test(value.trim().replace(/[.,]$/, ''))
    ? value.trim()
    : undefined;
}
function areaLabelForFilters(filters: Record<string, unknown>): string | undefined {
  const locations = [
    ...(typeof filters.location === 'string' ? [filters.location] : []),
    ...(Array.isArray(filters.locations) ? filters.locations.map(String) : []),
  ];
  if (locations.length > 1 && locations.every((value) => centralFormerDistricts.includes(value)))
    return 'khu trung tâm';
  return locations[0]?.trim() || undefined;
}
function relaxedLocation(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const match = value.match(/(?:quận|huyện|thành phố|tp\.?|q\.?)[\s\d-]+/i);
  return match?.[0]?.trim() || value.split(',').at(-1)?.trim();
}
function catalogueAreaKey(value: unknown) {
  const text = String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi');
  return text
    .replace(/\b(?:quan|huyen|thanh pho|tp)\.?\s+/u, '')
    .replace(/\s*\([^)]*\)/gu, '')
    .trim();
}

function historicalOwnershipReply(items: Evidence[], question: string) {
  if (items.length < 2) return null;
  const properties = items.filter((item) => item.source_type !== 'Faq');
  if (properties.length < 2) return null;
  const lines = properties.map((item, index) => {
    const number = item.number ?? index + 1;
    const price = priceLabel(item.price, false);
    const loan = item.price ? Math.round(item.price * 0.7) : 0;
    const low = loan ? Math.round(annuityPayment(loan, 8, 20).monthlyPayment / 10_000) * 10_000 : 0;
    const high = loan ? Math.round(annuityPayment(loan, 10, 20).monthlyPayment / 10_000) * 10_000 : 0;
    const loanText = loan
      ? `; giả định vay 70% là ${priceLabel(loan)}, lãi suất tham khảo 8–10%/năm trong 20 năm, trả đều khoảng ${priceLabel(low)}/tháng–${priceLabel(high)}/tháng`
      : '';
    return `Căn số ${number} ${shortListingName(item.name)} [${number}]: giá ${price}${loanText}; phí quản lý theo m² và phí bảo trì chưa có dữ liệu.`;
  });
  const lowest = properties
    .filter((item) => typeof item.price === 'number')
    .sort((left, right) => (left.price ?? Infinity) - (right.price ?? Infinity))[0];
  const lowestNumber = lowest?.number ?? properties.indexOf(lowest) + 1;
  const lowestArea = lowest?.area ? `/${lowest.area}m²` : '';
  return `Mình đối chiếu các căn bạn vừa nhắc theo đúng số thứ tự; đây là ước tính minh họa, không phải báo giá vay:\n${lines.join('\n')}\nDữ liệu chưa cho biết phí quản lý và phí bảo trì; các khoản phí này chưa có dữ liệu nên chưa thể cộng thành tổng chi phí sở hữu 5 năm chính xác. Với các số đang biết và giả định trên, căn số ${lowestNumber}${lowestArea} có khả năng là phương án có tổng chi phí thấp nhất; bạn nên nhờ chuyên viên xác nhận các khoản phí và ngân hàng xác nhận lịch trả nợ.`;
}

@Injectable()
export class AiService {
  constructor(
    private readonly llm: AiLlmService,
    private readonly guard: AiGuardService,
    private readonly extraction: AiExtractionService,
    private readonly scoring: AiScoringService,
    private readonly privacy: AiPrivacyService,
    private readonly retrieval: RetrievalService,
  ) {}
  async chat(request: NextRequest) {
    try {
      const turnStarted = performance.now();
      const timing = { clarify: 0, embed: 0, kb_search: 0, rerank: 0, generate: 0, guard: 0, commit: 0, other: 0 };
      if (!validOrigin(request)) return catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403);
      const parsed = await catalogInput(request);
      if (parsed.error) return parsed.error;
      const input = parsed.input;
      if (
        Object.keys(input).some(
          (k) =>
            !['session_id', 'message', 'history', 'store_transcript', 'property_id', 'filters', 'criteria'].includes(k),
        ) ||
        typeof input.message !== 'string' ||
        !input.message.trim() ||
        input.message.length > 2000 ||
        typeof input.store_transcript !== 'boolean' ||
        (input.session_id !== undefined &&
          (typeof input.session_id !== 'string' || !uuidPattern.test(input.session_id))) ||
        (input.property_id !== undefined &&
          input.property_id !== null &&
          (typeof input.property_id !== 'string' || !uuidPattern.test(input.property_id)))
      )
        return catalogError('INVALID_INPUT', 'Tin nhắn tối đa 2.000 ký tự; lựa chọn lưu hội thoại phải rõ ràng.', 400);
      const history = input.history ?? [];
      if (
        !Array.isArray(history) ||
        history.length > 10 ||
        history.some(
          (turn) =>
            !object(turn) ||
            Object.keys(turn).some((k) => !['role', 'content', 'sources'].includes(k)) ||
            !['user', 'assistant'].includes(turn.role as string) ||
            typeof turn.content !== 'string' ||
            turn.content.length > 8000 ||
            (turn.sources !== undefined &&
              (!Array.isArray(turn.sources) ||
                turn.sources.some(
                  (source) =>
                    !object(source) ||
                    (source.price !== null &&
                      source.price !== undefined &&
                      (typeof source.price !== 'number' || !Number.isFinite(source.price))),
                ))),
        )
      )
        return catalogError('INVALID_HISTORY', 'Chỉ gửi tối đa 10 lượt hội thoại.', 400);
      const filters = input.filters ?? {};
      const inputFilters = filters as Record<string, unknown>;
      if (
        input.criteria !== undefined &&
        (!validCriteria(input.criteria) ||
          !this.guard.toolAllowed({ name: 'search_properties', arguments: input.criteria }))
      )
        return catalogError('INVALID_FILTER', 'Tiêu chí không hợp lệ.', 400);
      const hasStructuredInputFilters =
        input.filters !== undefined &&
        inputFilters.transaction_type !== undefined &&
        [
          'location',
          'locations',
          'type',
          'types',
          'minPrice',
          'maxPrice',
          'minArea',
          'maxArea',
          'bedrooms',
          'minBedrooms',
          'maxBedrooms',
        ].some((key) => inputFilters[key] !== undefined);
      if (!object(filters) || !this.guard.toolAllowed({ name: 'search_properties', arguments: filters }))
        return catalogError('INVALID_FILTER', 'Bộ lọc không hợp lệ.', 400);
      const who = await identity();
      if (who.error) return who.error;
      let id = typeof input.session_id === 'string' ? input.session_id : randomUUID();
      let count = 0,
        interestIds: string[] = [],
        scoring: {
          needs: Record<string, { value: unknown; evidence?: string; confirmed_by?: unknown }>;
          verified: boolean;
          version: number;
          interest_ids?: string[];
          score_result?: ScoreResult;
        } | null = null;
      // A conversation stopped before its first answer was never committed; continue it as a new session instead of failing.
      let prior = input.session_id ? await readSession(id, who) : null;
      if (prior?.error?.code === 'P0002') {
        id = randomUUID();
        prior = null;
      }
      const turnId = randomUUID();
      setAiRequestSession(id, turnId, questionPreview(input.message));
      if (prior) {
        if (prior.error) return catalogDatabaseError(prior.error);
        count = prior.data.message_count;
        scoring = prior.data.scoring;
        interestIds = prior.data.suggested_property_ids || [];
        if (prior.data.store_transcript !== input.store_transcript || prior.data.status === 'Closed')
          return catalogError(
            'SESSION_CONFLICT',
            'Lựa chọn lưu áp dụng cho cả phiên; hãy bắt đầu phiên mới để thay đổi.',
            409,
          );
      } else if (who.client) {
        const context = await who.client.rpc('pose_ai_score_context');
        if (context.error) return catalogDatabaseError(context.error);
        scoring = context.data;
      }
      if (!consumeAttempt('ai-ip', requestClientIp(), 100) || !consumeAttempt('ai-session', id, 40))
        return catalogError('RATE_LIMIT', 'Bạn đã gửi nhiều tin nhắn. Vui lòng thử lại sau.', 429);
      const guest = !who.session,
        source = guest ? this.privacy.stripPhones(input.message) : input.message;
      const pureClosing = isPureClosing(source);
      const closingReply = 'Rất vui được hỗ trợ bạn! Khi cần tìm căn phù hợp, bạn cứ nhắn mình nhé.';
      const setGuestSessionCookie = async () => {
        if (guest)
          (await cookies()).set('pose-ai-session', who.token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: 86400 * 7,
          });
      };
      let responseCriteria: Criteria = {};
      const guestCatalog = async (payload: object, status = 200) => {
        await setGuestSessionCookie();
        return catalogJson({ criteria: responseCriteria, ...payload }, status);
      };
      const discountSignal = /(?:giảm giá|hạ giá|ngộp|cắt lỗ|giá tốt|chỉ còn)/iu;
      const discountQuestion =
        discountSignal.test(source) && !/(?:thuê|cho thuê|mua|bán|đang bán|rent|sale)/iu.test(source);
      // The browser sends its local history, while lightweight clients such as
      // ask.mjs rely on the session. Use stored messages as the same source of
      // context when a request omits history.
      const contextHistory: {
        role: string;
        content: string;
        sources?: { id?: string; code?: string; price?: number | null }[];
      }[] = history.length
        ? (history as {
            role: string;
            content: string;
            sources?: { id?: string; code?: string; price?: number | null }[];
          }[])
        : ((prior?.data?.messages || history) as {
            role: string;
            content: string;
            sources?: { id?: string; code?: string; price?: number | null }[];
          }[]);
      const sanitizedHistory = contextHistory.map((turn) => ({
        role: turn.role,
        content: guest ? this.privacy.stripPhones(turn.content) : turn.content,
        sources: Array.isArray(turn.sources) ? turn.sources : undefined,
      }));
      const criteriaSource = prior?.data?.messages?.length
        ? prior.data.messages
        : history.length
          ? sanitizedHistory
          : sanitizedHistory;
      const criteriaHistory = criteriaSource.map(
        (turn: {
          role: string;
          content: string;
          sources?: { id?: string; code?: string; price?: number | null }[];
        }) => ({
          role: turn.role,
          content: guest ? this.privacy.stripPhones(turn.content) : turn.content,
          sources: Array.isArray(turn.sources) ? turn.sources : undefined,
        }),
      );
      const listedCardFollowUp = isListedCardFollowUp(source, criteriaHistory);
      responseCriteria = listedCardFollowUp
        ? normalizeCriteria(
            input.criteria !== undefined
              ? (input.criteria as Criteria)
              : searchCriteriaFromHistory('', criteriaHistory),
          )
        : input.criteria !== undefined
          ? mergeCriteria(input.criteria as Criteria, source)
          : normalizeCriteria(searchCriteriaFromHistory(source, criteriaHistory));
      const rememberedCriteria = normalizeCriteria({ ...responseCriteria, ...inputFilters } as Criteria);
      const explicitInputCriteria = input.filters !== undefined ? normalizeCriteria(inputFilters as Criteria) : {};
      const customerName = customerNameFromHistory(source, sanitizedHistory);
      const address = customerName || 'bạn',
        addressStart = customerName || 'Bạn';
      if (isAbusive(source)) {
        const committed = await systemClient().rpc('pose_system_ai_commit_chat', {
          p_session: id,
          p_user: who.session?.user.id || null,
          p_hash: who.guestHash,
          p_store: false,
          p_message: source,
          p_reply: abusiveReply,
          p_sources: [],
          p_actions: [],
          p_fields: {},
          p_score: null,
        });
        if (committed.error) return catalogDatabaseError(committed.error);
        return guestCatalog({
          session: committed.data,
          reply: abusiveReply,
          scope: 'out_of_scope',
          sources: [],
          related: [],
          blocked: false,
          proposals: [],
          pending_actions: [],
          inquiry_url: '/customer/inquiries/new',
        });
      }
      const codeReference = referencedListingCodes(source, sanitizedHistory);
      let referencedItems: Evidence[] = [];
      if (codeReference.ambiguous) {
        referencedItems = await retrieveCodes(codeReference.codes);
        // "tôi quan tâm căn … giá 26 triệu": a pasted line or price picks one of the listings just shown.
        const said = new Set(moneyAmounts(source)),
          text = source.normalize('NFC').toLocaleLowerCase('vi');
        const words = (value: string) =>
          value
            .normalize('NFC')
            .toLocaleLowerCase('vi')
            .split(/[^\p{L}\p{N}]+/u)
            .filter((word) => word.length > 2);
        const score = (item: Evidence) =>
          (item.price != null && said.has(item.price) ? 3 : 0) +
          words(item.name || '').filter((word) => text.includes(word)).length /
            Math.max(1, words(item.name || '').length);
        const ranked = referencedItems.map((item) => ({ item, score: score(item) })).sort((a, b) => b.score - a.score);
        if (
          ranked.length &&
          ranked[0].score >= 1 &&
          (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.5)
        ) {
          codeReference.codes = [ranked[0].item.code];
          codeReference.ambiguous = false;
        }
      }
      if (codeReference.ambiguous) {
        const clarify = {
          needed: true,
          question: `${addressStart} đang hỏi căn nào?`,
          options: referencedItems.slice(0, 5).map((item) => `${item.code} - ${item.name}`),
        };
        const committed = await systemClient().rpc('pose_system_ai_commit_chat', {
          p_session: id,
          p_user: who.session?.user.id || null,
          p_hash: who.guestHash,
          p_store: input.store_transcript,
          p_message: source,
          p_reply: clarify.question,
          p_sources: [],
          p_actions: [],
          p_fields: {},
          p_score: null,
        });
        if (committed.error) return catalogDatabaseError(committed.error);
        return guestCatalog({
          session: committed.data,
          reply: clarify.question,
          scope: 'in_scope',
          sources: [],
          related: [],
          clarify,
          proposals: [],
          pending_actions: [],
          inquiry_url: '/customer/inquiries/new',
        });
      }
      const financeIntentNote = financeNoteForQuestion(source) || null;
      const listingRequestIntent =
        /(?:gợi ý|giới thiệu|tìm|kiếm|có\s+(?:căn|nhà|lô|bất động sản)|xem\s+(?:căn|nhà|danh sách)|cho tôi.*(?:căn|nhà|lô))/iu.test(
          source,
        ) ||
        (!financeIntentNote && /(?:muốn|muon)\s+(?:mua|thuê|thue)\s+(?:căn|nhà|lô|đất)/iu.test(source));
      const historyBudgetAdjustment = budgetFollowUp(source, criteriaHistory);
      const budgetAdjustment = historyBudgetAdjustment
        ? {
            ...historyBudgetAdjustment,
            filters: { ...responseCriteria, ...historyBudgetAdjustment.filters },
          }
        : null;
      const moreRequest = isMoreRequest(source);
      const filterAgainRequest = explicitRefilterRequest(source);
      const explicitPriceRange =
        typeof inferSearch(source)?.minPrice === 'number' && typeof inferSearch(source)?.maxPrice === 'number';
      const excludePrevious = moreRequest || (budgetAdjustment?.direction === 'cheaper' && !explicitPriceRange);
      const shownHistory = criteriaHistory as {
        role: string;
        content: string;
        sources?: { id?: string; code?: string }[];
      }[];
      const shownSources = shownHistory
        .filter((turn) => turn.role === 'assistant' && Array.isArray(turn.sources))
        .flatMap((turn) => turn.sources || []);
      const shownIds = new Set(
        shownSources.map((item) => item.id).filter((value): value is string => typeof value === 'string'),
      );
      const shownCodes = [
        ...new Set(
          [
            ...shownSources.map((item) => item.code),
            ...shownHistory.filter((turn) => turn.role === 'assistant').flatMap((turn) => listingCodes(turn.content)),
          ].filter((value): value is string => typeof value === 'string'),
        ),
      ];
      if (excludePrevious && shownCodes.length) {
        for (const item of await retrieveCodes(shownCodes)) shownIds.add(item.id);
      }
      const clarifyStarted = performance.now();
      const areaAdviceFilters = inferSearch(source) || {};
      const budgetedAreaAdvice =
        areaAdviceQuestion(source) && typeof areaAdviceFilters.maxPrice === 'number' && !input.property_id;
      const overviewKind = budgetedAreaAdvice ? null : catalogueOverviewIntent(source);
      const outsideCity = outsideCataloguePlace(source);
      if (outsideCity && !input.property_id && !codeReference.codes.length) {
        const transactionType = areaAdviceFilters.transaction_type || inferTransactionType(source);
        const maxPrice = typeof areaAdviceFilters.maxPrice === 'number' ? areaAdviceFilters.maxPrice : undefined;
        const propertyType =
          typeof areaAdviceFilters.type === 'string'
            ? areaAdviceFilters.type
            : Array.isArray(areaAdviceFilters.types)
              ? areaAdviceFilters.types
              : undefined;
        const overview = await catalogueOverview('areas', transactionType, maxPrice, propertyType, true);
        const areas = (overview.areas || []).filter((area) => Number(area.count) > 0).slice(0, 5);
        const monthly = transactionType === 'Rent';
        const areaLine = areas.length
          ? areas
              .map(
                (area) =>
                  `${area.label} (${Number(area.count)} tin${maxPrice !== undefined ? ` ≤ ${priceLabel(maxPrice, monthly)}` : ''})`,
              )
              .join(', ')
          : 'chưa có khu vực phù hợp trong dữ liệu hiện có';
        const typeText = typeof propertyType === 'string' ? `${typeLabels[propertyType] || propertyType} ` : '';
        const reply = assembleFinalReply({
          body: `Hiện TERAVA chưa có tin ${typeText}${transactionType === 'Rent' ? 'cho thuê' : transactionType === 'Sale' ? 'đang bán' : ''} tại ${outsideCity}. TERAVA hiện có danh mục tại TP.HCM và một số khu vực lân cận; với tiêu chí hiện tại, các khu có tin là: ${areaLine}. Bạn muốn xem khu vực nào trong danh mục này?`,
        });
        const committed = await systemClient().rpc('pose_system_ai_commit_chat', {
          p_session: id,
          p_user: who.session?.user.id || null,
          p_hash: who.guestHash,
          p_store: input.store_transcript,
          p_message: source,
          p_reply: reply,
          p_sources: [],
          p_actions: [],
          p_fields: {},
          p_score: null,
        });
        if (committed.error) return catalogDatabaseError(committed.error);
        return guestCatalog({
          session: committed.data,
          reply,
          scope: 'in_scope',
          sources: [],
          related: [],
          clarify: { needed: false, question: null, options: areas.slice(0, 3).map((area) => String(area.label)) },
          proposals: [],
          pending_actions: [],
          inquiry_url: '/customer/inquiries/new',
        });
      }
      const extremePriceRequest = /(?:đắt|cao|rẻ|thấp)\s+nhất/iu.test(source);
      const criteriaQuestion =
        input.filters === undefined &&
        !extremePriceRequest &&
        (responseCriteria.transaction_type === 'Rent' ||
          (responseCriteria.transaction_type === 'Sale' && responseCriteria.type !== 'House')) &&
        !/(?:nhà\s+phố|nhà\s+đất)/iu.test(source) &&
        (typeof responseCriteria.location === 'string' ||
          (Array.isArray(responseCriteria.locations) && responseCriteria.locations.length > 0))
          ? nextCriteriaQuestion(responseCriteria, addressStart)
          : null;
      const clarification =
        input.property_id ||
        overviewKind ||
        budgetedAreaAdvice ||
        hasStructuredInputFilters ||
        (financeIntentNote && !listingRequestIntent)
          ? { needed: false, question: null, options: [] }
          : criteriaQuestion || clarificationFor(source, criteriaHistory);
      timing.clarify = performance.now() - clarifyStarted;
      if (clarification.needed) {
        const committed = await systemClient().rpc('pose_system_ai_commit_chat', {
          p_session: id,
          p_user: who.session?.user.id || null,
          p_hash: who.guestHash,
          p_store: input.store_transcript,
          p_message: source,
          p_reply: clarification.question,
          p_sources: [],
          p_actions: [],
          p_fields: {},
          p_score: null,
        });
        if (committed.error) return catalogDatabaseError(committed.error);
        return guestCatalog({
          session: committed.data,
          reply: clarification.question,
          scope: 'in_scope',
          sources: [],
          related: [],
          clarify: clarification,
          proposals: [],
          pending_actions: [],
          inquiry_url: '/customer/inquiries/new',
        });
      }
      if (budgetedAreaAdvice && !referencedListingCodes(source, sanitizedHistory).codes.length) {
        const transactionType = areaAdviceFilters.transaction_type || inferTransactionType(source) || 'Sale';
        const maxPrice = areaAdviceFilters.maxPrice as number;
        const propertyType =
          typeof areaAdviceFilters.type === 'string'
            ? areaAdviceFilters.type
            : Array.isArray(areaAdviceFilters.types)
              ? areaAdviceFilters.types
              : undefined;
        const overview = await catalogueOverview('areas', transactionType, maxPrice, propertyType);
        const areas = overview.areas || [];
        const cards: (Evidence & { relaxed_reason?: string })[] = [];
        for (const area of areas.slice(0, 3)) {
          const aliases = areaAliases(area.label);
          const matches = await retrieve(
            {
              transaction_type: transactionType,
              ...(typeof propertyType === 'string' ? { type: propertyType } : { types: propertyType }),
              maxPrice,
              location: area.label,
              location_aliases: aliases,
            },
            null,
          );
          const best = matches
            .filter((item) => typeof item.price === 'number' && item.price <= maxPrice)
            .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
          if (best && !cards.some((item) => item.id === best.id)) cards.push(best);
        }
        let reply = overview.reply;
        if (!areas.length) {
          const nearest = await retrieve(
            {
              transaction_type: transactionType,
              ...(typeof propertyType === 'string' ? { type: propertyType } : { types: propertyType }),
              minPrice: maxPrice + 1,
            },
            null,
          );
          cards.push(
            ...nearest
              .filter((item) => typeof item.price === 'number' && item.price > maxPrice)
              .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
              .slice(0, 3)
              .map((item) => ({ ...item, relaxed_reason: 'Ngoài ngân sách đã nêu', reason: 'Ngoài ngân sách đã nêu' })),
          );
          reply = assembleFinalReply({
            body: reply,
            trailing: [
              cards.length
                ? 'Mình gửi một vài lựa chọn gần nhất ở trên ngân sách đã nêu, có nhãn để bạn dễ cân nhắc. Chuyên viên cũng có thể tìm thêm giúp bạn.'
                : 'Mình có thể nhờ chuyên viên tìm thêm lựa chọn phù hợp hoặc tư vấn điều chỉnh ngân sách.',
            ],
          });
        }
        const sources = cards.map((item, index) => ({ ...item, number: index + 1, source_type: 'Property' as const }));
        const committed = await systemClient().rpc('pose_system_ai_commit_chat', {
          p_session: id,
          p_user: who.session?.user.id || null,
          p_hash: who.guestHash,
          p_store: input.store_transcript,
          p_message: source,
          p_reply: reply,
          p_sources: sources,
          p_actions: [],
          p_fields: {},
          p_score: null,
        });
        if (committed.error) return catalogDatabaseError(committed.error);
        return guestCatalog({
          session: committed.data,
          reply,
          scope: 'in_scope',
          sources,
          related: [],
          clarify: { needed: false, question: null, options: overview.options },
          proposals: [],
          pending_actions: [],
          inquiry_url: '/customer/inquiries/new',
        });
      }
      if (overviewKind && !input.property_id && !referencedListingCodes(source, sanitizedHistory).codes.length) {
        const overviewTransaction = /(?:cho\s+thuê|cho\s+thuê|thuê)/iu.test(source)
          ? 'Rent'
          : /(?:đang\s+bán|bên\s+mình\s+có\s+bán|bán)/iu.test(source)
            ? 'Sale'
            : undefined;
        const overview = await catalogueOverview(overviewKind, overviewTransaction);
        const reply = assembleFinalReply({ intro: count === 0 ? disclosure : '', body: overview.reply });
        const committed = await systemClient().rpc('pose_system_ai_commit_chat', {
          p_session: id,
          p_user: who.session?.user.id || null,
          p_hash: who.guestHash,
          p_store: input.store_transcript,
          p_message: source,
          p_reply: reply,
          p_sources: [],
          p_actions: [],
          p_fields: {},
          p_score: null,
        });
        if (committed.error) return catalogDatabaseError(committed.error);
        return guestCatalog({
          session: committed.data,
          reply,
          scope: 'in_scope',
          sources: [],
          related: [],
          clarify: { needed: true, question: null, options: overview.options },
          proposals: [],
          pending_actions: [],
          inquiry_url: '/customer/inquiries/new',
        });
      }
      // A question about a listing being viewed or just discussed ("đã gồm phí môi giới chưa?") is a buyer's question.
      if (ownerRequest(source) && !codeReference.codes.length && !input.property_id) {
        const selling = /(?<![\p{L}])bán(?![\p{L}])/iu.test(source) && !/cho\s+thuê/iu.test(source);
        const ownerBody = `Mình hiểu ${address} đang muốn ${selling ? 'bán' : 'cho thuê/bán'} bất động sản. ${/phí|hoa\s+hồng|phần\s+trăm|chi\s+phí/iu.test(source) ? `Hiện mình chưa có thông tin về phí môi giới hay phần trăm hoa hồng; chuyên viên sẽ báo cụ thể cho ${address}. ` : ''}${unsupportedCriteria(source).includes('thời gian bán') ? `Hiện mình chưa có thông tin để ước tính thời gian bán được nhà; chuyên viên sẽ xem vị trí, giá và tình trạng nhà để tư vấn cụ thể cho ${address}. ` : ''}TERAVA có thể kết nối ${address} với chuyên viên để ${selling ? 'định giá, đăng tin, tìm người mua' : 'tìm người thuê, đăng tin'} và hỗ trợ hợp đồng. ${addressStart} muốn gặp chuyên viên tư vấn không?`;
        const ownerReply = assembleFinalReply({ intro: count === 0 ? disclosure : '', body: ownerBody });
        const ownerReplyWithValuation = ownerValuationQuestion(source)
          ? assembleFinalReply({
              body: ownerReply,
              trailing: [
                `Hiện mình chưa có thông tin/dữ liệu để định giá thị trường căn của ${address}; chuyên viên sẽ kiểm tra cụ thể cho ${address}.`,
              ],
            })
          : ownerReply;
        const committed = await systemClient().rpc('pose_system_ai_commit_chat', {
          p_session: id,
          p_user: who.session?.user.id || null,
          p_hash: who.guestHash,
          p_store: input.store_transcript,
          p_message: source,
          p_reply: ownerReplyWithValuation,
          p_sources: [],
          p_actions: [],
          p_fields: {},
          p_score: null,
        });
        if (committed.error) return catalogDatabaseError(committed.error);
        return guestCatalog({
          session: committed.data,
          reply: ownerReplyWithValuation,
          scope: 'in_scope',
          sources: [],
          related: [],
          clarify: { needed: false, question: null, options: [] },
          proposals: [],
          pending_actions: [],
          inquiry_url: '/customer/inquiries/new',
        });
      }
      // Comparisons and similar-listing requests keep the detail-page focus; their extra cards
      // are added separately below. Other-listing requests can still leave the focus.
      const wantsOthers =
        /(?:căn|nhà|lô|chỗ|dự án)\s+(?:khác|tương tự)|rẻ hơn|cao hơn|gợi ý thêm|so sánh|còn căn nào/iu.test(source);
      const comparisonQuestion = priceComparisonQuestion(source);
      const cardComparisonQuestion = /(?:so\s+s.{0,4}nh|compare)/iu.test(source) && /\d/.test(source);
      const similarQuestion = /(?:tương tự|căn khác|căn nào giống|giống căn)/iu.test(source);
      const viewedListingReference =
        /(?:căn(?:\s+hộ)?|nhà|lô|đất)\s+(?:này|đang\s+xem|trên\s+trang)|(?:hôm\s+nay|vừa\s+xem)/iu;
      const detailReference = Boolean(input.property_id && viewedListingReference.test(source) && !wantsOthers);
      const extraCostsQuestion = /(?:giá bán cuối cùng|phát sinh thêm chi phí|ký hợp đồng)/iu.test(source);
      const viewedPropertyId =
        typeof input.property_id === 'string' && (!wantsOthers || comparisonQuestion || similarQuestion)
          ? input.property_id
          : null;
      // "Nhân viên liên hệ lại cho mình" is a hand-off request, not a search with no criteria.
      const contactOnly = contactRequest(source) && !inferSearch(source) && !moneyAmounts(source).length;
      const explicitSearch = inferSearch(source);
      const hasSearchCriteria = Boolean(
        explicitSearch &&
        [
          'location',
          'locations',
          'type',
          'types',
          'minPrice',
          'maxPrice',
          'minArea',
          'maxArea',
          'bedrooms',
          'minBedrooms',
          'maxBedrooms',
          'transaction_type',
        ].some((key) => explicitSearch[key as keyof typeof explicitSearch] !== undefined),
      );
      const areaOnlyRefinement = isAreaOnlyRefinement(source, criteriaHistory);
      const financeAdviceOnly = Boolean(financeIntentNote) && !listingRequestIntent;
      const adviceOnly =
        (((adviceOrServiceQuestion(source) || historyReferenceQuestion(source, sanitizedHistory)) &&
          !listingRequestIntent) ||
          financeAdviceOnly) &&
        !areaOnlyRefinement &&
        !input.property_id;
      const cashAmounts = moneyAmounts(source);
      const loanBudget = inferLoanBudget(source);
      const strictCashBudget =
        noLoanWords(source) && typeof inferSearch(source)?.maxPrice === 'number'
          ? (inferSearch(source)?.maxPrice as number)
          : null;
      let searchPerformed = (input.filters !== undefined || !!input.property_id) && !adviceOnly && !detailReference,
        rag: RetrievalResult | null = null;
      let structuredRemainingCount: number | null = null;
      let exactMatchesExhausted = false;
      const filterAmounts: number[] = [];
      let items: Evidence[] = [],
        related: Record<string, unknown>[] = [];
      // Retrieval already applies price, area, room and type filters with tolerance; this recheck only
      // guards the two mistakes seen live: listings from another area or another transaction type.
      const matchesFilters = (item: Evidence, filters: Record<string, unknown>) => {
        const place = withFormerDistrict(item.location || '').toLocaleLowerCase('vi');
        const wanted = [
          ...(typeof filters.location === 'string' ? [filters.location] : []),
          ...(Array.isArray(filters.locations) ? filters.locations.map(String) : []),
        ];
        // A title may name the district ("… Q7 giá …"), but "Tân Phú Trung" (a Củ Chi commune) is not Tân Phú.
        const inName = (value: string) =>
          new RegExp(
            `(?<![\\p{L}\\d])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d]|\\s+\\p{Lu})`,
            'u',
          ).test(item.name || '');
        const aliases = Array.isArray(filters.location_aliases) ? filters.location_aliases.map(String) : [];
        if (
          wanted.length &&
          !wanted.some((value) => place.includes(value.toLocaleLowerCase('vi'))) &&
          !aliases.some((value) => place.includes(value.toLocaleLowerCase('vi')))
        )
          return false;
        if (filters.transaction_type && item.transaction_type && item.transaction_type !== filters.transaction_type)
          return false;
        if (filters.type && item.property_type && item.property_type !== filters.type) return false;
        if (
          Array.isArray(filters.types) &&
          filters.types.length &&
          item.property_type &&
          !filters.types.includes(item.property_type)
        )
          return false;
        if (
          typeof filters.minPrice === 'number' &&
          item.price !== null &&
          item.price !== undefined &&
          item.price < filters.minPrice
        )
          return false;
        if (
          typeof filters.maxPrice === 'number' &&
          item.price !== null &&
          item.price !== undefined &&
          (filters.maxPriceExclusive ? item.price >= filters.maxPrice : item.price > filters.maxPrice)
        )
          return false;
        if (
          typeof filters.minArea === 'number' &&
          (item.area === null || item.area === undefined || item.area < filters.minArea)
        )
          return false;
        if (
          typeof filters.maxArea === 'number' &&
          (item.area === null || item.area === undefined || item.area > filters.maxArea)
        )
          return false;
        if (!bedroomRangeMatches(item, filters)) return false;
        return true;
      };
      const criteriaOnlyFollowUp =
        sanitizedHistory.length > 0 &&
        !moreRequest &&
        !!inferSearch(source) &&
        !moneyAmounts(source).length &&
        !/(?:tìm|kiếm|muốn|cần|gợi ý|có\s+căn|căn\s+hộ|nhà|đất|phòng|thuê|mua|bán|bất động sản)/iu.test(source);
      let structuredCatalogueSearch =
        hasStructuredInputFilters ||
        moreRequest ||
        !!budgetAdjustment ||
        criteriaOnlyFollowUp ||
        filterAgainRequest ||
        (sanitizedHistory.length > 0 && !!inferSearch(source) && !/(?:tìm|mua|bán|thuê|căn|nhà|đất)/iu.test(source));
      const areaAlreadyTolerant = /(?:diện\s*tích\s*)?(?:khoảng|tầm)\s*[\d.,]+\s*(?:m\s*[²2]|mét\s*vuông)/iu.test(
        source,
      );
      const search = async (
        searchFilters: Record<string, unknown>,
        propertyId: string | null = null,
        referenceIds: string[] = [],
        searchQuery = source,
        rememberCriteria = true,
        ignoreShown = false,
      ) => {
        const aliases: Record<string, string> = {
          min_price_vnd: 'minPrice',
          max_price_vnd: 'maxPrice',
          min_area_m2: 'minArea',
          max_area_m2: 'maxArea',
          property_type: 'type',
          property_types: 'types',
        };
        searchFilters = Object.fromEntries(
          Object.entries(searchFilters).map(([key, value]) => [aliases[key] || key, value]),
        );
        if (rememberCriteria && (structuredCatalogueSearch || Object.keys(explicitInputCriteria).length)) {
          const remembered = rememberedCriteria;
          for (const key of [
            'location',
            'locations',
            'location_aliases',
            'type',
            'types',
            'transaction_type',
            'minPrice',
            'maxPrice',
            'maxPriceExclusive',
            'minArea',
            'maxArea',
            'bedrooms',
            'minBedrooms',
            'maxBedrooms',
          ] as const)
            if (searchFilters[key] === undefined && remembered[key] !== undefined) searchFilters[key] = remembered[key];
        }
        searchFilters = withAreaAliases(searchFilters);
        const stated = { ...searchFilters };
        const effective = { ...searchFilters };
        if (!areaAlreadyTolerant) {
          if (typeof stated.minArea === 'number') effective.minArea = Math.floor(stated.minArea * 0.85);
          if (typeof stated.maxArea === 'number') effective.maxArea = Math.ceil(stated.maxArea * 1.15);
        }
        if (excludePrevious && shownIds.size && !ignoreShown) effective.exclude_ids = [...shownIds];
        const searchStarted = performance.now();
        if (structuredCatalogueSearch && !propertyId) {
          try {
            const structured = await retrieveStructured(effective, null);
            structuredRemainingCount = structured.count;
            timing.kb_search += performance.now() - searchStarted;
            const found = structured.items.filter((item) => matchesFilters(item, effective));
            const inStated = found.filter(
              (item) =>
                (typeof stated.minArea !== 'number' || typeof item.area !== 'number' || item.area >= stated.minArea) &&
                (typeof stated.maxArea !== 'number' || typeof item.area !== 'number' || item.area <= stated.maxArea),
            );
            const near = found
              .filter((item) => !inStated.includes(item) && typeof item.area === 'number')
              .map((item) => ({ ...item, areaNearCriteria: true }));
            const ordered = [...inStated, ...near];
            const requestedLocations = [
              ...(typeof stated.location === 'string' ? [stated.location] : []),
              ...(Array.isArray(stated.locations) ? stated.locations.map(String) : []),
            ];
            const locationOrder = (item: Evidence) => {
              const text = String(item.location || '')
                .normalize('NFC')
                .toLocaleLowerCase('vi');
              const exactWard = requestedLocations.some((location) =>
                areaAliases(location).some((alias) => {
                  const ward = alias.match(/^(?:phường|xã|đặc khu)\s+(.+)$/iu)?.[1];
                  if (!ward) return false;
                  const escaped = ward.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  return new RegExp(`(?:phường|xã|đặc khu)\\s+${escaped}(?=\\s*(?:,|$))`, 'iu').test(text);
                }),
              );
              if (exactWard) return 0;
              const legacyDistrict = requestedLocations.some((location) =>
                areaAliases(location).some(
                  (alias) =>
                    /^(?:quận|q\.?|huyện|thị xã|thành phố|tp\.?)\s/iu.test(alias) &&
                    text.includes(alias.normalize('NFC').toLocaleLowerCase('vi')),
                ),
              );
              return legacyDistrict ? 1 : 2;
            };
            const budgetOrdering = Boolean(
              budgetAdjustment ||
              extremePriceRequest ||
              (typeof stated.maxPrice === 'number' && stated.minPrice === undefined),
            );
            if (!budgetOrdering) ordered.sort((left, right) => locationOrder(left) - locationOrder(right));
            if (budgetAdjustment?.direction === 'cheaper') {
              ordered.sort((left, right) => {
                const leftPrice = typeof left.price === 'number' ? left.price : Number.POSITIVE_INFINITY;
                const rightPrice = typeof right.price === 'number' ? right.price : Number.POSITIVE_INFINITY;
                return leftPrice - rightPrice;
              });
            } else if (extremePriceRequest) {
              ordered.sort((left, right) => {
                const leftPrice =
                  typeof left.price === 'number'
                    ? left.price
                    : extremePriceRequest && /rẻ|thấp/iu.test(source)
                      ? Number.POSITIVE_INFINITY
                      : Number.NEGATIVE_INFINITY;
                const rightPrice =
                  typeof right.price === 'number'
                    ? right.price
                    : extremePriceRequest && /rẻ|thấp/iu.test(source)
                      ? Number.POSITIVE_INFINITY
                      : Number.NEGATIVE_INFINITY;
                return /rẻ|thấp/iu.test(source) ? leftPrice - rightPrice : rightPrice - leftPrice;
              });
            } else if (typeof stated.maxPrice === 'number' && stated.minPrice === undefined) {
              const approximateMatch = searchQuery.match(
                /(?:tầm|khoảng)[^\d]{0,12}([\d.,]+\s*(?:tỷ|tỉ|ty|triệu|tr|million|billion))/iu,
              );
              const budgetTarget = approximateMatch ? moneyAmounts(approximateMatch[1])[0] : stated.maxPrice;
              ordered.sort((left, right) => {
                const leftDistance =
                  typeof left.price === 'number'
                    ? Math.abs((budgetTarget as number) - left.price)
                    : Number.POSITIVE_INFINITY;
                const rightDistance =
                  typeof right.price === 'number'
                    ? Math.abs((budgetTarget as number) - right.price)
                    : Number.POSITIVE_INFINITY;
                return leftDistance - rightDistance;
              });
            }
            return ordered.slice(0, extremePriceRequest ? 1 : 15);
          } catch (error) {
            console.warn(
              JSON.stringify({
                event: 'structured_retrieval_fallback',
                error: error instanceof Error ? error.message : 'RETRIEVAL_UNAVAILABLE',
              }),
            );
          }
        }
        try {
          for (const key of ['minPrice', 'maxPrice'])
            if (typeof effective[key] === 'number') filterAmounts.push(effective[key] as number);
          rag = await this.retrieval.search(searchQuery, effective, { propertyId, propertyIds: referenceIds });
          timing.embed += rag.timings?.embed || 0;
          timing.rerank += rag.timings?.rerank || 0;
          const mapped = rag.sources
            .filter((item) => item.id)
            .map((item) => ({
              ...item,
              id: item.id as string,
              name: item.title as string,
              reason: item.reason as string,
            }));
          const live = await retrieveIds(mapped.map((item) => item.id));
          timing.kb_search += performance.now() - searchStarted;
          const found = live
            .map((item) => ({ ...item, ...mapped.find((candidate) => candidate.id === item.id) }))
            .filter((item) => propertyId || matchesFilters(item, effective)) as Evidence[];
          const inStated = found.filter(
            (item) =>
              (typeof stated.minArea !== 'number' || typeof item.area !== 'number' || item.area >= stated.minArea) &&
              (typeof stated.maxArea !== 'number' || typeof item.area !== 'number' || item.area <= stated.maxArea),
          );
          const near = found
            .filter((item) => !inStated.includes(item) && typeof item.area === 'number')
            .map((item) => ({ ...item, areaNearCriteria: true }));
          return [...inStated, ...near];
        } catch (error) {
          timing.kb_search += performance.now() - searchStarted;
          console.warn(
            JSON.stringify({
              event: 'retrieval_fallback',
              error: error instanceof Error ? error.message : 'RETRIEVAL_UNAVAILABLE',
            }),
          );
          return retrieve(searchFilters, propertyId);
        }
      };
      if (searchPerformed && !viewedPropertyId)
        items = await search({ ...inferSearch(source), ...filters }, (input.property_id as string | null) || null);
      const initialRag = rag as RetrievalResult | null;
      if (
        searchPerformed &&
        (!items.length || (initialRag && !initialRag.found)) &&
        Object.keys(filters).length &&
        !input.property_id &&
        strictCashBudget === null
      ) {
        const relaxed = { transaction_type: filters.transaction_type, location: relaxedLocation(filters.location) };
        const relaxedItems = await search(
          Object.fromEntries(Object.entries(relaxed).filter(([, value]) => value !== undefined)),
          null,
        );
        related = relaxedItems
          .filter((item) => typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0)
          .slice(0, 3)
          .map((item) => ({
            ...item,
            number: undefined,
            relaxed_reason:
              filters.maxPrice !== undefined || filters.minPrice !== undefined
                ? 'Ngoài ngân sách đã nêu'
                : filters.location
                  ? 'Khác khu vực: ' + String(filters.location)
                  : 'Gợi ý gần với tiêu chí đã nêu',
            reason: deterministicReason(String(item.reason || '')),
            related: true,
          }));
        if (filters.transaction_type)
          related = related.filter((item) => item.transaction_type === filters.transaction_type);
        rag = null;
      }
      // Small models rarely ask for a search on their own; search the catalogue from the
      // question itself, and if nothing matches widen once so the answer can compare.
      const inferred = searchPerformed ? null : { ...rememberedCriteria, ...(budgetAdjustment?.filters || {}) };
      // `inferSearch` is only an input to the validated query step below.
      const actions: { tool: string; args_hash: string; decision: string; reason: string; rule_version: string }[] = [];
      const log = (tool: string, args: unknown, reason: string | null, decision?: 'flagged') =>
        actions.push({
          tool,
          args_hash: hash(JSON.stringify(args) || 'null'),
          decision: decision || (reason ? 'blocked' : 'allowed'),
          reason: reason || 'VALIDATED',
          rule_version: GUARD_VERSION,
        });
      const safeEvidence = (list: Evidence[]) =>
        list.filter((item) => {
          const reason = this.guard.evidenceReason(item);
          if (reason) log('retrieval', { id: item.id }, reason);
          if (!isValidListingPrice(item)) {
            log(
              'retrieval',
              { id: item.id, code: item.code, price: item.price, transaction_type: item.transaction_type },
              'INVALID_PRICE_FLOOR',
            );
            return false;
          }
          return !reason;
        });
      items = dedupeListings(safeEvidence(items)).filter(isValidListingPrice);
      const locationTextIsConsistent = (item: { name?: unknown; location?: unknown }) =>
        !String(item.name || '').match(/Lạc Thủy/iu) || /Lạc Thủy/iu.test(String(item.location || ''));
      items = items.filter(locationTextIsConsistent);
      related = related.filter(locationTextIsConsistent).filter(isValidListingPrice);
      const suspected =
        this.guard.injection(input.message) || sanitizedHistory.some((t) => this.guard.injection(t.content));
      if (suspected) log('input', source, 'PROMPT_INJECTION', 'flagged');
      // Query understanding is a separate, validated step. The deterministic
      // inference is deliberately only the fallback (or the no-history fast path).
      const inferredFilterValues = inferred
        ? Object.fromEntries(Object.entries(inferred).filter(([key]) => key !== 'keywords'))
        : {};
      let standalone = source,
        queryKeywords: string[] = inferred?.keywords ? [...new Set(inferred.keywords)].slice(0, 8) : [],
        queryFilters: Record<string, unknown> = { ...explicitInputCriteria, ...inferredFilterValues };
      const realEstateIntent =
        !!budgetAdjustment ||
        Object.keys(queryFilters).length > 0 ||
        /căn|nhà|đất|phòng|giá|thuê|mua|bất động sản|Q\d|RV-/i.test(source);
      const propertyHistory = history.some((turn) => realEstateWordsForHistory(turn.content)) || interestIds.length > 0;
      let referenceIds: string[] = [];
      // Scope: the validated query step's `topic` decides; the keyword guard is only the
      // fallback when that step is skipped (explicit property request) or fails.
      let outOfScope = isOutOfScope(
        source,
        realEstateIntent || input.property_id ? 'real_estate' : 'unknown',
        propertyHistory,
      );
      let modelTopic: 'real_estate' | 'smalltalk' | 'out_of_scope' | null = null;
      if (!input.property_id && !adviceOnly && !(history.length === 0 && Object.keys(queryFilters).length)) {
        try {
          const query = await querySearch(source, sanitizedHistory as never[]);
          modelTopic = query.topic;
          outOfScope = scopeFromTopic(query.topic, source, propertyHistory);
          if (query.topic !== 'real_estate') throw new Error('NOT_A_PROPERTY_QUERY');
          standalone = query.standalone_question;
          queryKeywords = query.keywords;
          const qf = Object.fromEntries(Object.entries(query.filters).filter(([, v]) => v !== null));
          queryFilters = {
            location: qf.location,
            type: qf.property_type,
            types: qf.property_types,
            minPrice: qf.min_price_vnd,
            maxPrice: qf.max_price_vnd,
            minArea: qf.min_area_m2,
            maxArea: qf.max_area_m2,
            transaction_type: qf.transaction_type,
            bedrooms: qf.bedrooms,
          };
          queryFilters.location = locationFilter(queryFilters.location);
          queryFilters = Object.fromEntries(
            Object.entries(queryFilters).filter(([, v]) => v !== null && v !== undefined),
          );
          queryFilters = { ...explicitInputCriteria, ...queryFilters };
          queryFilters = retainUserCriteria(queryFilters, rememberedCriteria);
          const inferredTransaction = inferTransactionType(source);
          if (inferredTransaction) queryFilters.transaction_type = inferredTransaction;
          // The model rarely fills area bounds and reads "có 2 tỷ… vay" as a 2 tỷ ceiling; the deterministic parse wins there.
          const inferredFilters = inferSearch(source);
          for (const key of [
            'location',
            'locations',
            'location_aliases',
            'type',
            'types',
            'transaction_type',
            'minPrice',
            'maxPrice',
            'maxPriceExclusive',
            'minArea',
            'maxArea',
            'bedrooms',
          ] as const)
            if (queryFilters[key] === undefined && rememberedCriteria[key] !== undefined)
              queryFilters[key] = rememberedCriteria[key];
          if (inferredFilters?.keywords?.length)
            queryKeywords = [...new Set([...queryKeywords, ...inferredFilters.keywords])].slice(0, 8);
          if (inferredFilters?.keywords?.length) queryFilters.keywords = inferredFilters.keywords;
          if (inferredFilters?.minArea !== undefined && queryFilters.minArea === undefined)
            queryFilters.minArea = inferredFilters.minArea;
          if (inferredFilters?.maxArea !== undefined && queryFilters.maxArea === undefined)
            queryFilters.maxArea = inferredFilters.maxArea;
          if (/(?<![\p{L}])vay(?![\p{L}])/iu.test(source) && inferredFilters?.maxPrice !== undefined) {
            queryFilters.maxPrice = inferredFilters.maxPrice;
            delete queryFilters.minPrice;
          }
          if (/gần\s+(?:Quận\s*1|trung tâm)|đi\s+làm\s+(?:Quận\s*1|trung tâm)/iu.test(source)) {
            queryFilters.locations = centralFormerDistricts;
            delete queryFilters.location;
          }
          // The newest message wins: what it states explicitly replaces the model's reading of earlier turns,
          // and a price from an earlier turn is never carried into a message that names none.
          if (inferredFilters) {
            for (const key of [
              'location',
              'locations',
              'location_aliases',
              'type',
              'types',
              'transaction_type',
              'minPrice',
              'maxPrice',
              'maxPriceExclusive',
              'minArea',
              'maxArea',
              'bedrooms',
              'minBedrooms',
              'maxBedrooms',
            ] as const)
              if (inferredFilters[key] !== undefined) queryFilters[key] = inferredFilters[key];
            if (inferredFilters.location) delete queryFilters.locations;
            if (inferredFilters.locations) delete queryFilters.location;
          }
          // The query model may echo a district or price from a different turn. When the
          // newest message does not state that field, the deterministic active-search value wins.
          for (const key of [
            'location',
            'locations',
            'location_aliases',
            'type',
            'types',
            'transaction_type',
            'minPrice',
            'maxPrice',
            'maxPriceExclusive',
            'minArea',
            'maxArea',
            'bedrooms',
            'minBedrooms',
            'maxBedrooms',
          ] as const) {
            if (inferredFilters?.[key] === undefined && rememberedCriteria[key] !== undefined)
              queryFilters[key] = rememberedCriteria[key];
          }
          if (inferredFilters?.types) delete queryFilters.type;
          if (
            inferredFilters?.minPrice !== undefined &&
            inferredFilters?.maxPrice !== undefined &&
            inferredFilters.maxPriceExclusive === undefined
          )
            queryFilters.maxPriceExclusive = false;
          if (inferredFilters?.location === undefined && rememberedCriteria.location !== undefined)
            delete queryFilters.locations;
          if (inferredFilters?.locations === undefined && rememberedCriteria.locations !== undefined)
            delete queryFilters.location;
          if (/gần\s+(?:Quận\s*1|trung tâm)|đi\s+làm\s+(?:Quận\s*1|trung tâm)/iu.test(source)) {
            queryFilters.locations = centralFormerDistricts;
            delete queryFilters.location;
          }
          const startsFreshSearchWithoutBudget =
            !moneyAmounts(source).length &&
            inferredFilters?.minPrice === undefined &&
            inferredFilters?.maxPrice === undefined &&
            (inferredFilters?.transaction_type !== undefined ||
              inferredFilters?.type !== undefined ||
              inferredFilters?.types !== undefined) &&
            /(?:tìm|kiếm|muốn|cần|gợi ý|tư vấn)\s+/iu.test(source);
          if (startsFreshSearchWithoutBudget) {
            delete queryFilters.minPrice;
            delete queryFilters.maxPrice;
            delete queryFilters.maxPriceExclusive;
          }
          if (areaOnlyRefinement) queryFilters = preserveAreaSwitchCriteria(queryFilters, rememberedCriteria);
          if (
            !moneyAmounts(source).length &&
            inferredFilters?.minPrice === undefined &&
            rememberedCriteria.minPrice === undefined &&
            rememberedCriteria.maxPrice !== undefined
          )
            delete queryFilters.minPrice;
          if (
            !moneyAmounts(source).length &&
            rememberedCriteria.minPrice === undefined &&
            rememberedCriteria.maxPrice === undefined
          ) {
            delete queryFilters.minPrice;
            delete queryFilters.maxPrice;
            delete queryFilters.maxPriceExclusive;
          }
          referenceIds = query.refers_to_previous
            .map((index) => interestIds[index - 1])
            .filter((value): value is string => typeof value === 'string');
        } catch (error) {
          if (!(error instanceof Error && error.message === 'NOT_A_PROPERTY_QUERY'))
            log('query_step', source, 'invalid_query', 'flagged');
        }
      }
      // "Có 2 tỷ, vay thêm thì mua được căn nào": the cash is the equity, not the ceiling. With the
      // stated 60% loan assumption the total budget is cash / 0.4 (2 tỷ -> 5 tỷ).
      if (loanBudget) {
        queryFilters.maxPrice = loanBudget;
        delete queryFilters.minPrice;
      }
      if (!adviceOnly && genericSearchQuestion(source) && !queryFilters.transaction_type)
        queryFilters.transaction_type = 'Sale';
      if (discountQuestion) delete queryFilters.transaction_type;
      if (budgetAdjustment) {
        queryFilters = { ...queryFilters, ...budgetAdjustment.filters };
        if (budgetAdjustment.filters.maxPrice !== undefined && budgetAdjustment.filters.minPrice === undefined)
          delete queryFilters.minPrice;
        if (budgetAdjustment.filters.minPrice !== undefined && budgetAdjustment.filters.maxPrice === undefined)
          delete queryFilters.maxPrice;
        standalone = source;
      }
      const directCriteria = { ...(inferSearch(source) || {}), ...budgetFilters(source) };
      const directBudget = directCriteria;
      if (directBudget?.minPrice !== undefined || directBudget?.maxPrice !== undefined) {
        for (const key of ['minPrice', 'maxPrice', 'maxPriceExclusive'] as const) {
          if (directBudget[key] === undefined) delete queryFilters[key];
          else queryFilters[key] = directBudget[key];
        }
        if (directBudget.minPrice !== undefined && directBudget.maxPrice !== undefined)
          queryFilters.maxPriceExclusive = false;
      }
      if (directCriteria?.types?.length) delete queryFilters.type;
      else if (directCriteria?.type) delete queryFilters.types;
      if (Array.isArray(queryFilters.types) && queryFilters.types.length) delete queryFilters.type;
      else if (typeof queryFilters.type === 'string') delete queryFilters.types;
      if (
        typeof queryFilters.minPrice === 'number' &&
        typeof queryFilters.maxPrice === 'number' &&
        queryFilters.minPrice > queryFilters.maxPrice
      )
        delete queryFilters.minPrice;
      if (extremePriceRequest && !queryFilters.transaction_type) queryFilters.transaction_type = 'Sale';
      if (
        directCriteria?.transaction_type &&
        directCriteria.minPrice === undefined &&
        directCriteria.maxPrice === undefined
      ) {
        delete queryFilters.minPrice;
        delete queryFilters.maxPrice;
        delete queryFilters.maxPriceExclusive;
      }
      const structuredTransaction = queryFilters.transaction_type || inferTransactionType(source);
      const hasStructuredCriteria = [
        'location',
        'locations',
        'type',
        'types',
        'minPrice',
        'maxPrice',
        'minArea',
        'maxArea',
        'bedrooms',
        'minBedrooms',
        'maxBedrooms',
      ].some((key) => queryFilters[key] !== undefined);
      structuredCatalogueSearch =
        structuredCatalogueSearch || extremePriceRequest || Boolean(structuredTransaction && hasStructuredCriteria);
      if (
        !input.property_id &&
        sanitizedHistory.some((turn) => turn.role === 'user' && genericSearchQuestion(turn.content)) &&
        !inferSearch(source)?.type
      )
        delete queryFilters.type;
      if (budgetAdjustment?.direction === 'cheaper') {
        items.sort((left, right) => {
          const leftPrice = typeof left.price === 'number' ? left.price : Number.POSITIVE_INFINITY;
          const rightPrice = typeof right.price === 'number' ? right.price : Number.POSITIVE_INFINITY;
          return leftPrice - rightPrice;
        });
      } else if (typeof queryFilters.maxPrice === 'number' && queryFilters.minPrice === undefined) {
        items.sort((left, right) => {
          const leftDistance =
            typeof left.price === 'number'
              ? Math.abs((queryFilters.maxPrice as number) - left.price)
              : Number.POSITIVE_INFINITY;
          const rightDistance =
            typeof right.price === 'number'
              ? Math.abs((queryFilters.maxPrice as number) - right.price)
              : Number.POSITIVE_INFINITY;
          return leftDistance - rightDistance;
        });
      }
      // Refuse before retrieval and before constructing an agent with tools.
      if (outOfScope) {
        log('scope', source, 'OUT_OF_SCOPE', 'flagged');
        const committed = await systemClient().rpc('pose_system_ai_commit_chat', {
          p_session: id,
          p_user: who.session?.user.id || null,
          p_hash: who.guestHash,
          p_store: false,
          p_message: source,
          p_reply: outOfScopeReply,
          p_sources: [],
          p_actions: actions,
          p_fields: {},
          p_score: null,
        });
        if (committed.error) return catalogDatabaseError(committed.error);
        return guestCatalog({
          session: committed.data,
          reply: outOfScopeReply,
          scope: 'out_of_scope',
          sources: [],
          related: [],
          blocked: false,
          proposals: [],
          pending_actions: [],
          inquiry_url: '/customer/inquiries/new',
        });
      }
      const pureReference =
        referenceIds.length > 0 &&
        Object.keys(queryFilters).length === 0 &&
        /\b(?:căn|can|nhà|nha|lô|lo|khu|kết quả|ket qua|đó|do|vừa|vua|thứ|thu|nào|nao|tiếp|tiep|trước|truoc|nêu|neu)\b/i.test(
          source,
        );
      if (codeReference.codes.length) {
        const priorNumbers = new Map<string, number>();
        for (const turn of sanitizedHistory.filter((turn) => turn.role === 'assistant')) {
          const cited = [...turn.content.matchAll(/\[(\d{1,3})\]/g)].map((match) => Number(match[1]));
          (turn.sources || []).forEach((source, index) => {
            if (typeof source.code !== 'string') return;
            const number =
              typeof (source as { number?: number }).number === 'number'
                ? (source as { number: number }).number
                : cited[index] || index + 1;
            priorNumbers.set(source.code.toLowerCase(), number);
          });
        }
        items = renumberReferencedListings(await retrieveCodes(codeReference.codes), codeReference.codes, priorNumbers);
        searchPerformed = false;
      } else if (pureReference) {
        items = await retrieveIds(referenceIds);
        searchPerformed = false;
      } else if (
        (realEstateIntent || modelTopic === 'real_estate') &&
        !searchPerformed &&
        !detailReference &&
        !contactOnly &&
        !adviceOnly
      ) {
        items = await search(queryFilters, null, referenceIds, [standalone, ...queryKeywords].join(' '));
        searchPerformed = true;
        console.info(
          JSON.stringify({
            event: 'search_filters',
            filters: queryFilters,
            found: items.length,
            related: related.length,
          }),
        );
      } else if (adviceOnly && !contactOnly) {
        try {
          const faqOnlyResult = await this.retrieval.search(source, {}, {});
          const faqChunks = faqOnlyResult.chunks.filter((chunk) => chunk.source_type === 'Faq');
          const rendered = renderRetrievedContextWithCards(faqChunks);
          rag = { ...faqOnlyResult, ...rendered, chunks: rendered.chunks };
        } catch {
          rag = null;
        }
      }
      if (discountQuestion && searchPerformed) {
        items = items.slice(0, 3);
        if (!items.length) {
          const newestFilters = Object.fromEntries(
            Object.entries(queryFilters).filter(([key]) => !['minPrice', 'maxPrice', 'transaction_type'].includes(key)),
          );
          items = safeEvidence(await retrieve(newestFilters, null).catch(() => [] as Evidence[])).slice(0, 3);
        }
      }
      // A broad request ("thuê nhà 6 tháng") can rerank to nothing; with only a type to go on, show the newest matching listings.
      if (
        searchPerformed &&
        !items.length &&
        Object.keys(queryFilters).length &&
        !queryFilters.location &&
        !queryFilters.locations &&
        queryFilters.maxPrice === undefined &&
        queryFilters.minPrice === undefined &&
        !contactOnly &&
        !input.property_id
      )
        items = safeEvidence(await retrieve(queryFilters, null).catch(() => [] as Evidence[])).slice(0, 3);
      // A budget follow-up should still be useful when the adjusted range is empty:
      // keep every other criterion, remove only the budget, and show the closest listings.
      let cheaperNoMatch = false;
      if (budgetAdjustment && !items.length && !input.property_id) {
        const relaxedBudget = Object.fromEntries(
          Object.entries(budgetAdjustment.filters).filter(([key]) => key !== 'minPrice' && key !== 'maxPrice'),
        );
        const closest = (
          await search(relaxedBudget, null, referenceIds, [standalone, ...queryKeywords].join(' '))
        ).filter(isValidListingPrice);
        const shownPrices =
          sanitizedHistory
            .slice()
            .reverse()
            .find((turn) => turn.role === 'assistant' && Array.isArray(turn.sources))
            ?.sources?.map((source) => source.price)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) || [];
        const budgetCeiling =
          typeof budgetAdjustment.filters.maxPrice === 'number' ? budgetAdjustment.filters.maxPrice : undefined;
        const closestCandidates = closest.filter(
          (item) =>
            item.price !== null &&
            (budgetAdjustment.direction === 'cheaper' ? true : item.price > Math.max(...shownPrices, 0)),
        );
        const inBudget =
          budgetCeiling === undefined
            ? closestCandidates
            : closestCandidates.filter((item) => typeof item.price === 'number' && item.price <= budgetCeiling);
        const overBudget =
          budgetCeiling === undefined
            ? []
            : closestCandidates.filter((item) => typeof item.price === 'number' && item.price > budgetCeiling);
        items = inBudget.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity)).slice(0, 3);
        related.push(
          ...overBudget
            .filter(isValidListingPrice)
            .sort(
              (a, b) =>
                Math.abs((budgetCeiling || 0) - (a.price || 0)) - Math.abs((budgetCeiling || 0) - (b.price || 0)),
            )
            .slice(0, 3)
            .map((item) => ({
              ...item,
              number: undefined,
              relaxed_reason: 'Ngoài ngân sách đã nêu',
              reason: 'Ngoài ngân sách đã nêu',
              related: true,
            })),
        );
        cheaperNoMatch = budgetAdjustment.direction === 'cheaper' && !items.length;
        if (items.length)
          console.info(
            JSON.stringify({ event: 'budget_closest', direction: budgetAdjustment.direction, found: items.length }),
          );
      }
      const priceFilteredSearch =
        typeof queryFilters.minPrice === 'number' || typeof queryFilters.maxPrice === 'number';
      if (
        priceFilteredSearch &&
        !items.some((item) => typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0)
      )
        items = [];
      // Nothing matches every criterion: show the closest listings instead of a bare "chưa có".
      // Relax in the order customers can evaluate: price, then area, then location.
      let nearestReason = '';
      let availableAreasLine = '';
      let nearbyAreaCriteria: { areas: string[]; matched: string[]; unmatched: string[] } | undefined;
      let sameAreaTypesLine = '';
      if (
        searchPerformed &&
        !items.length &&
        structuredCatalogueSearch &&
        !contactOnly &&
        !input.property_id &&
        strictCashBudget === null &&
        (queryFilters.location || queryFilters.locations || queryFilters.maxPrice !== undefined)
      ) {
        const query = [standalone, ...queryKeywords].join(' ');
        const nearestSearch = async (filters: Record<string, unknown>) => {
          const found = await search(filters, null, referenceIds, query, false);
          const fallback = found.length ? found : await retrieve(filters, null).catch(() => [] as Evidence[]);
          return fallback
            .filter(isValidListingPrice)
            .filter((item) => typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0);
        };
        let near: Evidence[] = [];
        for (const stage of nearestRelaxationStages(queryFilters, true)) {
          near = await nearestSearch(stage.filters);
          if (near.length) {
            nearestReason = stage.reason;
            break;
          }
        }
        if (!near.length) {
          const finalFilters = Object.fromEntries(
            Object.entries(queryFilters).filter(
              ([key]) => key === 'transaction_type' || key === 'type' || key === 'types',
            ),
          );
          near = (await retrieve(finalFilters, null).catch(() => [] as Evidence[])).filter(
            (item) => typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0,
          );
          if (near.length) nearestReason = 'Nới ngân sách, diện tích, phòng ngủ và khu vực';
        }
        related = near
          .filter(isValidListingPrice)
          .filter((item) => typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0)
          .sort((left, right) => {
            if (typeof queryFilters.maxPrice !== 'number') return 0;
            const leftIn = left.price! <= queryFilters.maxPrice,
              rightIn = right.price! <= queryFilters.maxPrice;
            if (leftIn !== rightIn) return leftIn ? -1 : 1;
            return Math.abs(queryFilters.maxPrice - left.price!) - Math.abs(queryFilters.maxPrice - right.price!);
          })
          .slice(0, 5)
          .map((item) => ({
            ...item,
            number: undefined,
            relaxed_reason: nearestReason,
            reason: nearestReason,
            related: true,
          }));
      }
      if (
        searchPerformed &&
        !items.length &&
        !contactOnly &&
        !input.property_id &&
        typeof queryFilters.maxPrice === 'number' &&
        (queryFilters.location || queryFilters.locations) &&
        queryFilters.transaction_type
      ) {
        try {
          const overview = await catalogueOverview(
            'areas',
            queryFilters.transaction_type as 'Sale' | 'Rent',
            queryFilters.maxPrice as number,
            typeof queryFilters.type === 'string'
              ? queryFilters.type
              : Array.isArray(queryFilters.types)
                ? queryFilters.types
                : undefined,
            true,
          );
          const requested = withFormerDistrict(
            String(queryFilters.location || (Array.isArray(queryFilters.locations) ? queryFilters.locations[0] : '')),
          )
            .normalize('NFC')
            .toLocaleLowerCase('vi');
          const alternatives = (overview.areas || [])
            .filter(
              (area) =>
                Number(area.count) > 0 &&
                withFormerDistrict(area.label).normalize('NFC').toLocaleLowerCase('vi') !== requested,
            )
            .slice(0, 3);
          if (alternatives.length) {
            const monthly = queryFilters.transaction_type === 'Rent';
            const budget = priceLabel(queryFilters.maxPrice as number, monthly);
            const typeLabel =
              typeof queryFilters.type === 'string'
                ? typeLabels[queryFilters.type] || queryFilters.type
                : 'loại hình đã chọn';
            const unmatched = [
              typeof queryFilters.minArea === 'number' || typeof queryFilters.maxArea === 'number' ? 'area' : '',
              typeof queryFilters.bedrooms === 'number' ? 'bedrooms' : '',
            ].filter(Boolean);
            const unmatchedText = unmatched.length
              ? `; dữ liệu này chưa đủ xác nhận ${unmatched.map((criteria) => (criteria === 'area' ? 'diện tích' : 'số phòng ngủ')).join(' và ')}`
              : '';
            availableAreasLine = `\nKhu vực thực sự có tin phù hợp với ${typeLabel} và ngân sách ${budget}: ${alternatives.map((area) => `${area.label} (${Number(area.count)} căn ≤ ${budget})`).join(', ')}${unmatchedText}.`;
            nearbyAreaCriteria = {
              areas: alternatives.map((area) => String(area.label)),
              matched: ['type', 'budget'],
              unmatched,
            };
          }
        } catch (error) {
          console.warn(
            JSON.stringify({
              event: 'catalogue_overview_for_no_match_failed',
              error: error instanceof Error ? error.message : 'UNKNOWN',
            }),
          );
        }
      }
      if (moreRequest && !items.length && structuredCatalogueSearch && !input.property_id) {
        const exact = await search(
          queryFilters,
          null,
          referenceIds,
          [standalone, ...queryKeywords].join(' '),
          true,
          true,
        );
        exactMatchesExhausted = exact.length > 0 && exact.every((item) => shownIds.has(item.id));
      }
      if (
        searchPerformed &&
        !items.length &&
        !contactOnly &&
        !input.property_id &&
        typeof queryFilters.maxPrice === 'number' &&
        (queryFilters.location || queryFilters.locations) &&
        queryFilters.transaction_type &&
        typeof queryFilters.type === 'string'
      ) {
        try {
          const requestedArea = String(
            queryFilters.location || (Array.isArray(queryFilters.locations) ? queryFilters.locations[0] : ''),
          );
          const targetArea = catalogueAreaKey(requestedArea);
          const allTypes = await catalogueOverview(
            'areas',
            queryFilters.transaction_type as 'Sale' | 'Rent',
            queryFilters.maxPrice as number,
            undefined,
            true,
          );
          const otherTypes = [
            ...new Set(
              (allTypes.types || [])
                .map((row) => row.property_type)
                .filter((value): value is string => typeof value === 'string' && value !== queryFilters.type),
            ),
          ].slice(0, 5);
          const matches: string[] = [];
          for (const propertyType of otherTypes) {
            const overview = await catalogueOverview(
              'areas',
              queryFilters.transaction_type as 'Sale' | 'Rent',
              queryFilters.maxPrice as number,
              propertyType,
              true,
            );
            const area = overview.areas?.find((row) => {
              const key = catalogueAreaKey(row.label);
              return (
                (key === targetArea || key.includes(targetArea) || targetArea.includes(key)) && Number(row.count) > 0
              );
            });
            if (area) matches.push(`${typeLabels[propertyType] || propertyType} (${Number(area.count)} tin)`);
          }
          if (matches.length) {
            const monthly = queryFilters.transaction_type === 'Rent';
            sameAreaTypesLine = `\nTại ${requestedArea}, dữ liệu hiện có ${matches.join(', ')} khác cùng ${queryFilters.transaction_type === 'Rent' ? 'mức thuê' : 'giao dịch'} và ngân sách ${priceLabel(queryFilters.maxPrice as number, monthly)}.`;
          }
        } catch (error) {
          console.warn(
            JSON.stringify({
              event: 'catalogue_overview_for_same_area_types_failed',
              error: error instanceof Error ? error.message : 'UNKNOWN',
            }),
          );
        }
      }
      const textHistoryListings = textListingReferences(sanitizedHistory);
      const hasHistorySourceCards = sanitizedHistory.some(
        (turn) => turn.role === 'assistant' && Array.isArray(turn.sources) && turn.sources.length > 0,
      );
      if (
        !hasHistorySourceCards &&
        textHistoryListings.length >= 2 &&
        historyReferenceQuestion(source, sanitizedHistory)
      ) {
        items = textHistoryListings.map(
          (item) =>
            ({
              id: `history-${item.number}`,
              code: `HISTORY-${item.number}`,
              name: item.name || `Căn hộ ${item.number}`,
              price: item.price,
              availability: 'Available',
              updated_at: '',
              location: 'Thủ Đức',
              property_type: 'Apartment',
              transaction_type: 'Sale' as const,
              price_period: 'Total' as const,
              area: item.area,
              bedrooms: item.bedrooms,
              number: item.number,
              source_type: 'Property' as const,
            }) satisfies Evidence,
        );
        searchPerformed = false;
      }
      const extracted: Record<string, unknown> = {};
      // One known listing (detail page, a single code, or "căn đó"): answer from that listing's own text only.
      const focusIds = viewedPropertyId
        ? [viewedPropertyId]
        : (codeReference.codes.length === 1 || pureReference) && items.length === 1
          ? [items[0].id]
          : [];
      const details = new Map<string, string>();
      const addDetail = (row: RankedChunk) => {
        if (row.source_type !== 'Property' || !row.source_id) return;
        const prior = details.get(row.source_id) || '';
        if (prior.includes(row.content)) return;
        details.set(row.source_id, `${prior}${prior ? '\n' : ''}${row.content}`.slice(0, 1600));
      };
      let faqRows: RankedChunk[] = [];
      if (focusIds.length) {
        const focusStarted = performance.now();
        try {
          const focused = await this.retrieval.focused(standalone, focusIds);
          focused.own.forEach(addDetail);
          faqRows = focused.faq;
        } catch (error) {
          console.warn(
            JSON.stringify({
              event: 'focused_retrieval_failed',
              error: error instanceof Error ? error.message : 'RETRIEVAL_UNAVAILABLE',
            }),
          );
        }
        if (viewedPropertyId) {
          const viewed = safeEvidence(await retrieveIds([viewedPropertyId]));
          if (viewed.length) items = viewed;
        }
        timing.kb_search += performance.now() - focusStarted;
        rag = null;
      } else {
        const current = rag as RetrievalResult | null;
        current?.chunks.forEach(addDetail);
        faqRows = current?.chunks.filter((chunk) => chunk.source_type === 'Faq').slice(0, 2) || [];
      }
      if (similarQuestion && viewedPropertyId && items[0]) {
        try {
          let similar = await retrieveSimilar(viewedPropertyId);
          const sourceItem = items[0];
          const districtKey = (location: string) => {
            const text = withFormerDistrict(location || '');
            return (
              text
                .match(/\(([^)]+?) cũ\)/iu)?.[1]
                ?.normalize('NFC')
                .toLocaleLowerCase('vi') ||
              text
                .match(/(?:quận|huyện)\s+[\p{L}\d ]+/iu)?.[0]
                ?.normalize('NFC')
                .toLocaleLowerCase('vi') ||
              ''
            );
          };
          if (!similar.length && sourceItem.price != null) {
            const candidates = await search(
              {
                transaction_type: sourceItem.transaction_type,
                type: sourceItem.property_type,
                minPrice: sourceItem.price * 0.7,
                maxPrice: sourceItem.price * 1.3,
              },
              null,
              [],
              `${sourceItem.name || ''} ${sourceItem.location || ''} tương tự`,
            );
            const sourceDistrict = districtKey(sourceItem.location || '');
            similar = candidates
              .filter(
                (candidate) =>
                  candidate.id !== sourceItem.id &&
                  candidate.transaction_type === sourceItem.transaction_type &&
                  candidate.property_type === sourceItem.property_type &&
                  typeof candidate.price === 'number' &&
                  candidate.price > 0 &&
                  candidate.price >= sourceItem.price! * 0.7 &&
                  candidate.price <= sourceItem.price! * 1.3 &&
                  districtKey(candidate.location || '') === sourceDistrict,
              )
              .slice(0, 3);
          }
          related = similar
            .filter(isValidListingPrice)
            .filter((item) => typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0)
            .slice(0, 3)
            .map((item) => ({
              ...item,
              number: undefined,
              reason: 'Căn tương tự cùng loại, cùng giao dịch và cùng khu vực',
              related: true,
            }));
        } catch (error) {
          console.warn(
            JSON.stringify({
              event: 'similar_retrieval_failed',
              error: error instanceof Error ? error.message : 'RETRIEVAL_UNAVAILABLE',
            }),
          );
        }
      }
      const similarLine =
        similarQuestion && related.length
          ? `\nMình gửi bên dưới ${related.length} căn tương tự (cùng loại, cùng khu vực, giá gần bằng) để ${address} tham khảo nhé.`
          : '';
      const installmentBudget =
        loanWords(source) && viewedPropertyId && items[0]?.price != null
          ? Math.round(Number(items[0].price) * 0.6)
          : null;
      if (installmentBudget) filterAmounts.push(installmentBudget);
      // Observed numbers from the catalogue: districts within a budget, or the rent / price-per-m² level around one listing.
      let marketNote = '';
      try {
        if (
          focusIds.length &&
          items[0] &&
          (rentLevelQuestion(source) || landPriceQuestion(source) || comparisonQuestion)
        )
          marketNote = await marketSummary(items[0], rentLevelQuestion(source) ? 'rent' : 'per_m2');
        if (comparisonQuestion && items[0]?.price != null && items[0]?.area && Number(items[0].area) > 0) {
          const ownPerM2 = Math.round(Number(items[0].price) / Number(items[0].area) / 1e6) * 1e6;
          marketNote = `${marketNote ? `${marketNote} ` : ''}Căn đang xem có giá khoảng ${priceLabel(ownPerM2, false)} mỗi m² theo giá và diện tích trong tin đăng.`;
        } else if (
          !focusIds.length &&
          areaAdviceQuestion(source) &&
          !queryFilters.location &&
          !queryFilters.locations &&
          typeof queryFilters.maxPrice === 'number'
        )
          marketNote = await areaSummary({
            transaction_type: queryFilters.transaction_type === 'Rent' ? 'Rent' : 'Sale',
            type: typeof queryFilters.type === 'string' ? queryFilters.type : undefined,
            types: Array.isArray(queryFilters.types) ? queryFilters.types : undefined,
            maxPrice: queryFilters.maxPrice,
          });
      } catch (error) {
        console.warn(
          JSON.stringify({ event: 'market_summary_failed', error: error instanceof Error ? error.message : 'UNKNOWN' }),
        );
      }
      items = items.filter(locationTextIsConsistent);
      related = related
        .filter(locationTextIsConsistent)
        .filter((item) => typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0);
      const finalLocationFilters = withAreaAliases({
        location: queryFilters.location,
        locations: queryFilters.locations,
        location_aliases: queryFilters.location_aliases,
      });
      if (!codeReference.codes.length) items = items.filter((item) => matchesFilters(item, finalLocationFilters));
      if (!searchPerformed && !similarQuestion && !comparisonQuestion) related = [];
      if (
        extraCostsQuestion &&
        !faqRows.some(
          (row) =>
            row.source_type === 'Faq' &&
            /(?:Mua nhà đất thường phát sinh những chi phí nào|lệ phí trước bạ|thuế thu nhập cá nhân|phí bảo trì)/iu.test(
              `${row.header} ${row.content}`,
            ),
        )
      ) {
        try {
          const costFaq = await this.retrieval.search('Mua nhà đất thường phát sinh những chi phí nào?', {}, {});
          faqRows = [
            ...faqRows,
            ...costFaq.chunks
              .filter(
                (row) =>
                  row.source_type === 'Faq' &&
                  /(?:Mua nhà đất thường phát sinh những chi phí nào|lệ phí trước bạ|thuế thu nhập cá nhân|phí bảo trì)/iu.test(
                    `${row.header} ${row.content}`,
                  ),
              )
              .slice(0, 1),
          ];
        } catch (error) {
          console.warn(
            JSON.stringify({
              event: 'extra_costs_faq_failed',
              error: error instanceof Error ? error.message : 'RETRIEVAL_UNAVAILABLE',
            }),
          );
        }
      }
      const financeNote = financeNoteForQuestion(source, items[0]?.price ?? undefined, marketNote || undefined);
      const financeEvidence = financeEvidenceForQuestion(source, items[0]?.price ?? undefined, marketNote || undefined);
      const generalKnowledge = faqRows
        .map((chunk, index) => `[FAQ ${index + 1}] ${chunk.header}\n${chunk.content}`)
        .join('\n\n');
      const modelProperties = (list: Evidence[]) =>
        list.map((item) => ({
          ...item,
          name: shortListingName(item.name),
          availability: availabilityLabel(item.availability, item.transaction_type),
          details: details.get(item.id),
        }));
      const contextBlocks = items
        .map(
          (item, index) =>
            `[${item.number || index + 1}] ${item.code || ''} ${shortListingName(item.name)} ${withFormerDistrict(item.location || '')} loại=${item.property_type || ''} giá=${priceLabel(item.price, item.price_period === 'Month' || item.transaction_type === 'Rent')} trạng thái=${availabilityLabel(item.availability, item.transaction_type)}${details.get(item.id) ? `\nChi tiết: ${details.get(item.id)}` : ''}`,
        )
        .join('\n');
      const agentMessages = [
        { role: 'system' as const, content: assistantPrompt(customerName || undefined) },
        {
          role: 'user' as const,
          content: `BEGIN_UNTRUSTED_DATA\n${JSON.stringify({ question: standalone, history: sanitizedHistory, market_summary: marketNote || undefined, catalogue_overview: availableAreasLine || sameAreaTypesLine ? `${availableAreasLine}${sameAreaTypesLine}` : undefined, finance_calculation: financeNote || undefined, viewed_listing: viewedPropertyId ? 'Khách đang xem căn [1] trên trang chi tiết; "căn này" là căn [1].' : undefined, properties: contextBlocks, general_knowledge: generalKnowledge || undefined, customer_text: source, customer_name: customerName || undefined, contact_redacted: guest && source !== input.message, injection_suspected: suspected, search_performed: searchPerformed, budget_follow_up: budgetAdjustment ? `${budgetAdjustment.direction}; ${JSON.stringify(budgetAdjustment.filters)}` : undefined })}\nEND_UNTRUSTED_DATA`,
        },
      ];
      const proposals: { tool: string; args_hash: string; decision: string; reason: string; rule_version: string }[] =
        [];
      const pendingActions: unknown[] = [];
      let bookingAction: unknown;
      const execute = async (name: string, args: unknown) => {
        if (name === 'search_properties') {
          if (detailReference) {
            log(name, args, 'VIEWED_LISTING_REFERENCE', 'flagged');
            return { error: 'VIEWED_LISTING_REFERENCE' };
          }
          const a = args as Record<string, unknown>;
          const raw = object(a.filters) ? (a.filters as Record<string, unknown>) : {};
          const f = retainUserCriteria(
            Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined)),
            rememberedCriteria,
          );
          const found = await search(f, (input.property_id as string | null) || null);
          return found.length
            ? found.map((p, i) => {
                const rent = p.transaction_type === 'Rent';
                const labels: Record<string, string> = {
                  Available: rent ? 'Đang cho thuê' : 'Đang mở bán',
                  Sold: rent ? 'Đã cho thuê, không còn trống' : 'Đã bán, không còn mở bán',
                  Reserved: rent ? 'Đã có người giữ, không còn trống' : 'Đã giữ chỗ, không còn mở bán',
                  Unavailable: rent ? 'Chưa khả dụng, không còn trống' : 'Chưa khả dụng, không còn mở bán',
                };
                return `[${p.number || i + 1}] ${p.code}: ${p.name}, giá ${priceLabel(p.price, p.price_period === 'Month' || rent)}. ${labels[p.availability] || 'Chưa rõ khả dụng'}. Cập nhật ${formatReplyDate(p.updated_at) || p.updated_at}.`;
              })
            : [
                `Chưa có kết quả phù hợp trong nguồn công bố. ${addressStart} có thể nói ngân sách hoặc khu vực tìm kiếm không?`,
              ];
        }
        if (name === 'get_property_detail') {
          const code = (args as { code: string }).code;
          const result = await authClient()
            .from('property_public_catalog')
            .select('id,code,name,price,availability,updated_at,location,property_type,transaction_type,price_period')
            .eq('code', code)
            .maybeSingle();
          return result.error || !result.data ? { found: false } : { found: true, property: result.data };
        }
        if (name === 'list_my_appointments') {
          if (guest) return { requires_sign_in: true };
          const result = await who
            .client!.from('appointments')
            .select('*')
            .order('starts_at', { ascending: true })
            .limit(20);
          return result.error ? { error: 'unavailable' } : { appointments: result.data || [] };
        }
        return { error: 'unknown_read_tool' };
      };
      const createPending = async (name: string, args: unknown) => {
        if (!explicitWriteIntent(source)) {
          log(name, args, guest ? 'SIGN_IN_REQUIRED' : 'WRITE_NOT_REQUESTED', 'flagged');
          return null;
        }
        if (name === 'propose_appointment' && object(args) && !(args as Record<string, unknown>).preferred_start) {
          const code = String((args as Record<string, unknown>).code || '');
          const property = (await retrieveCodes([code]))[0];
          if (property) bookingAction = { type: 'booking_form', property, requires_sign_in: guest };
          log(name, args, guest ? 'SIGN_IN_REQUIRED' : null);
          return null;
        }
        if (guest) {
          log(name, args, 'SIGN_IN_REQUIRED', 'flagged');
          return null;
        }
        const summary =
          name === 'request_handoff'
            ? String((args as { summary: string }).summary)
            : name === 'propose_appointment'
              ? `Đề nghị lịch xem ${(args as { code?: string }).code || ''} lúc ${(args as { preferred_start: string }).preferred_start}`
              : `Lưu ${(args as { code: string }).code} vào yêu thích`;
        const pending = await who.client!.rpc('pose_ai_create_pending', {
          p_session: id,
          p_tool: name,
          p_args: args,
          p_summary: summary,
          p_key: `${id}:${hash(JSON.stringify({ name, args }))}`,
        });
        if (pending.error) throw new Error(pending.error.message || 'PENDING_FAILED');
        pendingActions.push(pending.data);
        return String((pending.data as { id: string }).id);
      };
      const streamedDeltas: string[] = [];
      const streamRequested = request.headers.get('accept')?.includes('text/event-stream') === true;
      const step = streamRequested
        ? (((messages: Parameters<typeof streamAgentStep>[0]) =>
            streamAgentStep(messages, (text) => streamedDeltas.push(text))) as never)
        : undefined;
      const run = async (messages: typeof agentMessages) =>
        runAgent(messages as never, execute, createPending, undefined, step);
      // A catalogue answer is a read-only response. Calling the tool-capable agent
      // here made a plain search pay for several sequential assistant calls, even
      // though retrieval had already supplied all of the facts it needed. Reserve
      // the agent loop for explicit actions and use the compact structured answer
      // call for ordinary searches.
      const actionRequest =
        explicitWriteIntent(source) ||
        /(?:gọi|liên hệ|chuyên viên|tư vấn|lịch hẹn|cuộc hẹn|appointment|danh sách lịch)/iu.test(source);
      // The local fixture provider models the native tool contract and is kept on
      // that path so its existing guard/action fixtures remain deterministic.
      const compactAnswer = process.env.AI_MODEL !== 'fixture';
      const generationStarted = performance.now();
      let agent =
        actionRequest || !compactAnswer
          ? await run(agentMessages)
          : await (() => {
              const modelInput = {
                question: standalone,
                history: sanitizedHistory,
                market_summary: marketNote || undefined,
                finance_calculation: financeNote || undefined,
                loan_budget: loanBudget
                  ? `Tổng ngân sách khi vay 60%: ${priceLabel(loanBudget, false)}; giới thiệu căn trong mức này, không tự tính lại.`
                  : undefined,
                viewed_listing: viewedPropertyId
                  ? 'Khách đang xem căn [1] trên trang chi tiết; "căn này" là căn [1].'
                  : undefined,
                properties: modelProperties(items),
                general_knowledge: generalKnowledge || undefined,
                customer_text: source,
                customer_name: customerName || undefined,
                search_performed: searchPerformed,
                budget_follow_up: budgetAdjustment
                  ? `${budgetAdjustment.direction}; ${JSON.stringify(budgetAdjustment.filters)}`
                  : undefined,
              };
              return complete(modelInput).then((model) => ({
                text: model.reply,
                messages: [...agentMessages, { role: 'assistant' as const, content: model.reply }],
                pending: [],
                blocked: [],
                steps: 1,
              }));
            })();
      timing.generate = performance.now() - generationStarted;
      // Re-check cited/source rows after generation: availability and price may
      // have changed while the model was answering. Keep it as one batched read
      // and start it before the independent answer checks below.
      const sourceIds = [...new Set(items.map((item) => item.id).filter(Boolean))];
      const availabilityStarted = performance.now();
      const availabilityPromise = sourceIds.length
        ? retrieveIds(sourceIds).catch((error) => {
            console.warn(
              JSON.stringify({
                event: 'availability_recheck_failed',
                error: error instanceof Error ? error.message : 'RETRIEVAL_UNAVAILABLE',
              }),
            );
            return [] as Evidence[];
          })
        : Promise.resolve([] as Evidence[]);
      // An empty model answer is a provider failure: retry once, then fail the turn with AI_UNAVAILABLE.
      if (actionRequest && !agent.text.trim() && !agent.pending.length && !agent.blocked.length) {
        agent = await run(agentMessages);
        if (!agent.text.trim() && !agent.pending.length && !agent.blocked.length) throw new Error('AI_EMPTY_RESPONSE');
      }
      const calledWriteTools = new Set(
        agent.messages.flatMap((message) =>
          message.role === 'assistant'
            ? ((message as { tool_calls?: { type: string; function: { name: string } }[] }).tool_calls || [])
                .filter((call) => call.type === 'function')
                .map((call) => call.function.name)
            : [],
        ),
      );
      const normalizedSource = source.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase();
      const fallbackTool =
        /(lien he|goi lai|gap chuyen vien|nhan vien tu van|chuyen vien tu van|lien he tu van|de lai so|so dien thoai)/i.test(
          normalizedSource,
        )
          ? 'request_handoff'
          : /(dat lich|hen xem|di xem|xem truc tiep|xem (?:nha|can))/i.test(normalizedSource) &&
              (codeReference.codes.length || focusIds.length)
            ? 'propose_appointment'
            : /luu can/i.test(normalizedSource) && codeReference.codes.length
              ? 'save_favorite'
              : null;
      // A viewing request needs a time the customer has not given yet; signed-in users get it asked in the reply.
      if (
        explicitWriteIntent(source) &&
        fallbackTool &&
        !calledWriteTools.has(fallbackTool) &&
        (guest || fallbackTool !== 'propose_appointment' || !bookingAction)
      ) {
        const code = codeReference.codes[0] || null;
        const args =
          fallbackTool === 'request_handoff'
            ? { summary: source }
            : fallbackTool === 'propose_appointment'
              ? { code, preferred_start: null, preferred_end: null }
              : { code };
        if (fallbackTool === 'propose_appointment' && !guest) {
          const property = items.find((item) => item.code?.toLowerCase() === String(code).toLowerCase()) || items[0];
          if (property) bookingAction = { type: 'booking_form', property };
        } else if (fallbackTool === 'propose_appointment' && guest) {
          const property = items.find((item) => item.code?.toLowerCase() === String(code).toLowerCase()) || items[0];
          if (property) bookingAction = { type: 'booking_form', property, requires_sign_in: true };
        } else {
          const action_id = await createPending(fallbackTool, args);
          if (action_id) pendingActions.push({ id: action_id, tool: fallbackTool, args });
        }
        logAiRequest({
          kind: 'chat',
          model: 'deterministic',
          promptName: 'assistant',
          toolsCalled: [fallbackTool],
          latencyMs: 0,
          status: 'ok',
        });
      }
      for (const blockedReason of agent.blocked) log('agent', blockedReason, blockedReason, 'flagged');
      let result = {
        reply: agent.text || 'Hiện tôi chưa đủ dữ liệu để trả lời chính xác.',
        tool_calls: [] as unknown[],
        needs: {},
        flags: [] as never[],
      };
      result.reply = sanitizeReply(agent.text || result.reply);
      result.reply = correctUnknownReply(result.reply);
      result.reply = removeUnpromptedOwnerTemplate(result.reply, explicitWriteIntent(source));
      const scrubOutsideDetailViewing = (text: string) =>
        text.replace(/(?:căn|can)(?:\s+(?:hộ|ho))?\s+(?:bạn|ban)\s+(?:đang|dang)\s+xem/giu, 'căn này');
      // Only a detail-page chat may say the customer "is viewing" a listing.
      if (!viewedPropertyId)
        result.reply = result.reply.replace(
          /(^|[.!?]\s+)Bạn đang xem(?: các| những)? (?=căn|nhà|lô|đất)/gu,
          '$1Mình gợi ý ',
        );
      if (!viewedPropertyId) result.reply = scrubOutsideDetailViewing(result.reply);
      // Models occasionally put the raw catalogue code in brackets. Convert it
      // to the stable [n] citation before C3, the guard, and card selection.
      result.reply = normalizeCitations(result.reply, items);
      let violation: string | null = agent.blocked.length ? 'AGENT_BLOCKED' : null;
      if (!violation && (viewedPropertyId || codeReference.codes.length === 1) && isRawListingDump(result.reply)) {
        violation = 'RAW_LISTING_DUMP';
      }
      // C3: citations are read from the reply itself (deterministic); a small model's self-reported
      // `cited` list is unreliable. The model's grounding verdict only matters for uncited claims.
      if (!violation) {
        const numbers = new Set(items.map((x, index) => x.number ?? index + 1)),
          citedInReply = [...result.reply.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]));
        if (citedInReply.some((n) => !numbers.has(n))) violation = 'C3_CITATION_NOT_IN_CONTEXT';
        else if (!citedInReply.length) {
          try {
            const meta = await checkAnswer(result.reply, { sources: items, question: source });
            if (meta.grounding === 'none' && (/\b\d{3,}\b/.test(result.reply) || /RV-\w+/i.test(result.reply)))
              violation = 'C3_META_UNGROUNDED';
          } catch {
            /* C3 failure never fails the turn; guard remains authoritative. */
          }
        }
      }
      const refreshed = await availabilityPromise;
      timing.kb_search += performance.now() - availabilityStarted;
      if (refreshed.length) {
        const freshById = new Map(refreshed.map((item) => [item.id, item]));
        items = items.map((item) => ({ ...item, ...freshById.get(item.id) }));
      }
      // This is the intentional post-generation read for current availability.
      items = dedupeListings(safeEvidence(items)).slice(0, 5);
      const finalRag = rag as RetrievalResult | null;
      if (finalRag) {
        const rendered = renderRetrievedContextWithCards(finalRag.chunks, new Set(items.map((x) => x.id)));
        rag = { ...finalRag, ...rendered };
        items = items.map((item) => ({
          ...item,
          number:
            (rendered.sources.find((s) => (s as { id?: string }).id === item.id) as { number?: number } | undefined)
              ?.number ?? item.number,
          source_type: 'Property',
        }));
      } else
        items = items.map((item, index) => ({ ...item, number: item.number ?? index + 1, source_type: 'Property' }));
      const evidenceItems = items;
      const historicalQuestion =
        evidenceItems.length >= 2 && /(?:tổng\s+chi\s+phí|sở\s+hữu|5\s+năm|phí\s+quản\s+lý|bảo\s+trì)/iu.test(source);
      const historicalReply = historicalQuestion ? historicalOwnershipReply(evidenceItems, source) : null;
      const deterministicComparison = cardComparisonQuestion ? cardComparisonReply(evidenceItems) : null;
      if (deterministicComparison || historicalReply) result.reply = deterministicComparison || historicalReply!;
      const historicalFinanceAmounts = historicalQuestion
        ? evidenceItems.flatMap((item) => {
            if (typeof item.price !== 'number' || item.price <= 0) return [];
            const principal = Math.round(item.price * 0.7);
            const low = Math.round(annuityPayment(principal, 8, 20).monthlyPayment / 10_000) * 10_000;
            const high = Math.round(annuityPayment(principal, 10, 20).monthlyPayment / 10_000) * 10_000;
            return [principal, low, high];
          })
        : [];
      const previousPrices = sanitizedHistory.flatMap((turn) =>
        turn.role === 'assistant' && Array.isArray(turn.sources)
          ? turn.sources
              .map((source) => source.price)
              .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
          : [],
      );
      const relatedPrices = related
        .map((item) => item.price)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const rememberedBudgetAmounts = [rememberedCriteria.minPrice, rememberedCriteria.maxPrice].filter(
        (value): value is number => typeof value === 'number' && Number.isFinite(value),
      );
      const currentBudgetAmounts = ['minPrice', 'maxPrice']
        .map((key) => queryFilters[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const latestShownIds = new Set(
        (
          [...sanitizedHistory].reverse().find((turn) => turn.role === 'assistant' && Array.isArray(turn.sources))
            ?.sources || []
        )
          .map((item) => item.id)
          .filter((value): value is string => typeof value === 'string'),
      );
      const unchangedBudgetResults =
        budgetAdjustment?.direction === 'higher' &&
        latestShownIds.size === evidenceItems.length &&
        evidenceItems.length > 0 &&
        evidenceItems.every((item) => latestShownIds.has(item.id));
      // Listing titles and detail text are source evidence too. This covers
      // importer titles whose displayed price differs from the numeric field.
      const listingTextForGuard = [
        ...details.values(),
        ...evidenceItems.map(
          (item) =>
            `${item.name || ''} ${item.location || ''} ${String((item as { description?: unknown }).description || '')}`,
        ),
      ].join('\n');
      const guardContext = {
        retrievalFound: rag?.found ?? evidenceItems.length > 0,
        faqOnly: evidenceItems.length > 0 && evidenceItems.every((x) => x.source_type === 'Faq'),
        filterAmounts: [...new Set([...filterAmounts, ...rememberedBudgetAmounts, ...currentBudgetAmounts])],
        previousPrices: [...new Set([...previousPrices, ...relatedPrices])],
        sourceText: `${rag?.context || ''}\n${generalKnowledge}\n${marketNote}\n${listingTextForGuard}`,
        listingText: listingTextForGuard,
        practice: generalKnowledge.length > 0,
        nearbyAreaCriteria,
        criteriaBedrooms: [
          rememberedCriteria.bedrooms,
          rememberedCriteria.minBedrooms,
          rememberedCriteria.maxBedrooms,
          queryFilters.bedrooms,
          queryFilters.minBedrooms,
          queryFilters.maxBedrooms,
        ].filter((value): value is number => typeof value === 'number'),
      };
      const derivedFinance = derivedFinanceAmounts(
        source,
        [...evidenceItems, ...related]
          .map((item) => item.price)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      );
      Object.assign(guardContext, {
        financeAmounts: [...(financeEvidence?.amounts || []), ...derivedFinance, ...historicalFinanceAmounts],
        financeRanges: financeEvidence?.ranges || [],
        financePresent: Boolean(financeEvidence || derivedFinance.length || historicalFinanceAmounts.length),
        faqEvidence: faqRows.length > 0 || generalKnowledge.length > 0,
      });
      // Availability is inserted as a system notice during final assembly. Keep
      // the model body untouched here so status claims can be removed as whole
      // sentences by normalizeFinalReply.
      result.reply = repairUnsupportedRoomClaims(
        removeUnpromptedNegotiation(
          rewriteAvailabilityLabels(
            removeReplyArtifacts(
              discardInvalidCitations(
                normalizeListedPrices(
                  labelMonthlyRent(normalizeCitations(result.reply, evidenceItems), evidenceItems),
                  evidenceItems,
                ),
                evidenceItems,
              ),
              evidenceItems,
              moreRequest,
            ),
            evidenceItems,
          ),
          source,
        ),
        evidenceItems,
      );
      const legalDetail = [
        ...details.values(),
        ...(rag?.chunks || []).map((chunk) => String(chunk.content || '')),
        ...evidenceItems.map((item) => String((item as { description?: unknown }).description || '')),
      ].find((detail) => {
        const folded = [...detail.normalize('NFD')]
          .filter((char) => {
            const code = char.codePointAt(0) || 0;
            return code < 0x300 || code > 0x36f;
          })
          .join('')
          .replace(String.fromCodePoint(0x0111), 'd')
          .toLocaleLowerCase('vi');
        return (
          folded.includes('so hong') ||
          folded.includes('so do') ||
          folded.includes('san so') ||
          folded.includes('so rieng')
        );
      });
      const legalFactFromText = (detail: string) => {
        const folded = [...detail.normalize('NFD')]
          .filter((char) => {
            const code = char.codePointAt(0) || 0;
            return code < 0x300 || code > 0x36f;
          })
          .join('')
          .replace(String.fromCodePoint(0x0111), 'd')
          .toLocaleLowerCase('vi');
        if (/(?:chua|khong) co so (?:hong|do|rieng)/u.test(folded)) return 'được ghi là chưa có sổ hồng';
        if (/(?:san so|da co so (?:hong|do|rieng)|co so (?:hong|do|rieng))/u.test(folded))
          return 'được ghi là đã có sổ hồng (sẵn sổ)';
        return '';
      };
      const groundedLegalDetail = legalFactFromText(legalDetail || JSON.stringify(evidenceItems[0] || {}));
      const legalFactReply = (item: Evidence, fact: string) => {
        // The card may be renumbered as source [1]; name it by the number the customer asked about.
        const askedNumber = Number(source.match(/căn\s+(?:số\s+)?(\d+)/iu)?.[1]) || undefined;
        const number = item.number ?? 1;
        const label = askedNumber ?? number;
        return legalContradiction
          ? `Theo tin đăng, căn số ${label} [${number}] ${fact}. Tin đăng ghi căn này đã có sổ hồng, khác với thông tin bạn được nghe; mình không thể xác nhận lời hứa của nhân viên về thời hạn ra sổ. Bạn nên xem bản gốc giấy chứng nhận và kiểm tra tại cơ quan đăng ký đất đai.`
          : `Theo tin đăng, căn số ${label} [${number}] ${fact}. Mình không thể xác nhận pháp lý thay cho giấy tờ gốc; bạn nên kiểm tra bản gốc và cơ quan đăng ký đất đai.`;
      };
      const legalTarget = evidenceItems.find((item, index) => (item.number ?? index + 1) === 2) || evidenceItems[0];
      const legalQuestionDirect =
        /(?:pháp lý|sổ hồng|sổ đỏ|sổ riêng|giấy tờ|quy hoạch|thế chấp|tranh chấp)/iu.test(source) &&
        !/(?:không tự ý đoán|không đưa ra ý kiến|không cam kết)/iu.test(source);
      const legalContradiction =
        /(?:chưa có sổ|chưa có sổ hồng|bao giờ ra sổ|thời hạn ra sổ)/iu.test(source) &&
        /(?:đã có sổ|sẵn sổ|được ghi là đã có sổ)/iu.test(groundedLegalDetail);
      if (legalTarget && legalQuestionDirect && groundedLegalDetail) {
        result.reply = legalFactReply(legalTarget, groundedLegalDetail);
      }
      const guardStarted = performance.now();
      if (!violation && !cardComparisonQuestion && evidenceItems.length && !/\[\d{1,3}\]/.test(result.reply))
        violation = 'MISSING_CITATION';
      if (!violation && !cardComparisonQuestion) {
        violation = this.guard.outputReason(result.reply, evidenceItems, source, guardContext);
        if (violation) {
          const diagnostic = this.guard.outputDiagnostic(result.reply, evidenceItems, source, guardContext);
          log('output', result.reply, violation);
          console.warn(
            JSON.stringify({
              event: 'guard_block',
              reason: violation,
              detail: diagnostic.detail,
              cited: [...result.reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
              sources: evidenceItems.map((x) => x.number ?? null),
              preview: result.reply.slice(0, 300),
            }),
          );
        }
      }
      timing.guard = performance.now() - guardStarted;
      let blocked = false;
      if (violation) {
        log('final_output', result.reply, violation);
        const retryMessages = [
          ...agentMessages,
          {
            role: 'user' as const,
            content: `BEGIN_UNTRUSTED_DATA\n${JSON.stringify({ regeneration: true, violation, ...correctionData(violation) })}\nEND_UNTRUSTED_DATA`,
          },
        ];
        agent =
          actionRequest || !compactAnswer
            ? await run(retryMessages)
            : await complete({
                question: standalone,
                history: sanitizedHistory,
                market_summary: marketNote || undefined,
                finance_calculation: financeNote || undefined,
                viewed_listing: viewedPropertyId
                  ? 'Khách đang xem căn [1] trên trang chi tiết; "căn này" là căn [1].'
                  : undefined,
                properties: modelProperties(evidenceItems),
                general_knowledge: generalKnowledge || undefined,
                customer_text: source,
                customer_name: customerName || undefined,
                search_performed: searchPerformed,
                budget_follow_up: budgetAdjustment
                  ? `${budgetAdjustment.direction}; ${JSON.stringify(budgetAdjustment.filters)}`
                  : undefined,
              }).then((model) => ({ text: model.reply, messages: [], pending: [], blocked: [], steps: 1 }));
        result.reply = removeUnpromptedNegotiation(
          rewriteAvailabilityLabels(
            removeReplyArtifacts(
              discardInvalidCitations(
                labelMonthlyRent(
                  normalizeCitations(correctUnknownReply(sanitizeReply(agent.text || safeReply)), evidenceItems),
                  evidenceItems,
                ),
                evidenceItems,
              ),
              evidenceItems,
              moreRequest,
            ),
            evidenceItems,
          ),
          source,
        );
        result.reply = repairUnsupportedRoomClaims(normalizeListedPrices(result.reply, evidenceItems), evidenceItems);
        result.reply = removeUnpromptedOwnerTemplate(result.reply, explicitWriteIntent(source));
        const retryViolation =
          this.guard.outputReason(result.reply, evidenceItems, source, guardContext) ||
          ((viewedPropertyId || codeReference.codes.length === 1) && isRawListingDump(result.reply)
            ? 'RAW_LISTING_DUMP'
            : null);
        if (retryViolation) {
          const diagnostic = this.guard.outputDiagnostic(result.reply, evidenceItems, source, guardContext);
          log('regeneration', result.reply, retryViolation);
          console.warn(
            JSON.stringify({
              event: 'guard_block',
              phase: 'regeneration',
              reason: retryViolation,
              detail: diagnostic.detail,
              cited: [...result.reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
              sources: items.map((x) => x.number ?? null),
              preview: result.reply.slice(0, 300),
            }),
          );
          blocked = true;
        } else {
          violation = null;
          log('regeneration', {}, null);
        }
      }
      if (historicalReply) {
        result.reply = historicalReply;
        blocked = false;
        violation = null;
      }
      // Tool calls can mix result sets; the grounded summary and its cards share one fresh 1..n numbering.
      // A non-property question asked right after a listing (weather, small talk) does not get that listing's card.
      const referencedAnswer =
        (!!input.property_id || codeReference.codes.length > 0 || pureReference) &&
        modelTopic !== 'smalltalk' &&
        modelTopic !== 'out_of_scope';
      const structuredSearchCards =
        structuredCatalogueSearch &&
        searchPerformed &&
        !viewedPropertyId &&
        !codeReference.codes.length &&
        !pureReference;
      // Structured retrieval owns the card set. Guard regeneration may rewrite or
      // remove a sentence, but it must never make cards depend on regenerated citations.
      if (structuredSearchCards)
        items = evidenceItems.slice(0, 5).map((item, index) => ({ ...item, number: item.number ?? index + 1 }));
      else if (blocked) items = evidenceItems.map((item, index) => ({ ...item, number: item.number ?? index + 1 }));
      else items = sourcesFromCitations(result.reply, evidenceItems, referencedAnswer);
      items = items.map((item) => ({ ...item, name: shortListingName(item.name) }));
      related = related
        .map((item, index) => ({
          ...item,
          number: item.number ?? index + 1,
          name: shortListingName(String(item.name || '')),
        }))
        .filter((item) => isValidListingPrice(item as { price?: number | null; transaction_type?: string }));
      const turnTransaction =
        queryFilters.transaction_type === 'Sale' || queryFilters.transaction_type === 'Rent'
          ? queryFilters.transaction_type
          : inferTransactionType(source);
      related = searchPerformed
        ? related.filter((item) => !turnTransaction || item.transaction_type === turnTransaction)
        : [];
      const missedBedroomLabel = (item: Evidence) => {
        if (typeof queryFilters.bedrooms !== 'number' || bedroomMatchesFilter(item, queryFilters.bedrooms)) return '';
        return isStudioListing(item)
          ? `Lệch tiêu chí: studio, không đủ ${queryFilters.bedrooms} phòng ngủ`
          : `Lệch tiêu chí: không đủ ${queryFilters.bedrooms} phòng ngủ`;
      };
      related = related.map((item) => ({
        ...item,
        reason:
          missedBedroomLabel(item as unknown as Evidence) ||
          String(item.reason || item.relaxed_reason || '').trim() ||
          undefined,
      }));
      const areaToleranceItems = evidenceItems.filter((item) => item.areaNearCriteria && typeof item.area === 'number');
      const areaToleranceSuffix = areaToleranceItems.length
        ? `\nLưu ý: ${areaToleranceItems.map((item) => `Diện tích gần tiêu chí (${item.area} m²)`).join('; ')}.`
        : '';
      const moreNoNew = moreRequest && (evidenceItems.length === 0 || !/\[\d{1,3}\]/.test(result.reply));
      const moreStatus = moreRequest
        ? moreNoNew || structuredRemainingCount === 0
          ? '\nMình đã hiển thị tất cả căn phù hợp; bạn có thể nới diện tích/khu vực, tăng ngân sách 10%, hoặc nhờ chuyên viên tìm thêm.'
          : structuredRemainingCount !== null && structuredRemainingCount <= 5
            ? `\nMình chỉ còn ${structuredRemainingCount} căn khác đúng tiêu chí trong dữ liệu hiện có.`
            : structuredRemainingCount !== null
              ? `\nMình gửi 5 căn khác đúng tiêu chí; dữ liệu còn ${structuredRemainingCount} căn phù hợp.`
              : evidenceItems.length
                ? `\nMình gửi ${evidenceItems.length} căn khác đúng tiêu chí trong dữ liệu hiện có.`
                : '\nMình đã hiển thị tất cả căn phù hợp; bạn có thể nới diện tích/khu vực, tăng ngân sách 10%, hoặc nhờ chuyên viên tìm thêm.'
        : '';
      const followUpFees = /(?:phí\s+quản\s+lý|gửi\s+xe|điện\s+nước)/iu.test(source)
        ? 'phí quản lý, gửi xe, điện nước'
        : '';
      if (blocked && codeReference.codes.length && followUpFees) {
        result.reply = listingFollowUpFallback(evidenceItems, followUpFees);
        blocked = false;
      }
      // A general question answered from FAQ knowledge ("thuê ngắn hạn được không?", a loan question) is not a failed search.
      const generalQuestion =
        generalKnowledge.length > 0 &&
        ((!queryFilters.location && !queryFilters.locations) ||
          /(?:giữa|so sánh|phương án|nên (?:mua|chọn|đầu tư))/iu.test(source));
      const questionTurn =
        /\?|(?:chịu\s+trách\s+nhiệm|tại\s+sao|vì\s+sao|thế\s+nào|chính\s+sách|cam\s+kết|bảo\s+đảm|có\s+được\s+không)/iu.test(
          source,
        ) && !listingRequestIntent;
      const noMatch =
        searchPerformed &&
        !input.property_id &&
        !contactOnly &&
        !generalQuestion &&
        !evidenceItems.length &&
        !related.length;
      const criteriaLabels = unsupportedCriteria(source);
      // The model already said what is missing and offered the hand-off: a second, canned line only repeats it.
      // An answer from general FAQ knowledge still says once that the specific fact is not in the data.
      const replyCoversGap = /(?:chưa có thông tin|chưa có dữ liệu|chưa được cung cấp|không có thông tin)/iu.test(
        result.reply,
      );
      // Never say "chưa có thông tin về tiền cọc" when the listing itself states the deposit.
      const listingText = [...details.values()].join(' ');
      // Only when the question asks exactly what the listing states: "cọc mấy tháng" is answered by "cọc 2 tháng",
      // but "trả nhà sớm có mất cọc không" or "có bị thế chấp không" is not.
      const statedInListing: Record<string, [RegExp, RegExp]> = {
        'tiền cọc / thời hạn hợp đồng': [/cọc/iu, /(?:cọc|đặt cọc)\s*(?:mấy|bao nhiêu)/iu],
        'pháp lý chi tiết': [
          /sổ hồng|sổ đỏ|sẵn sổ|sổ riêng/iu,
          /^(?!.*(?:thế chấp|tranh chấp|quy hoạch|thổ cư|nông nghiệp|có vấn đề)).*sổ (?:hồng|đỏ|riêng)/iu,
        ],
        'khả năng thương lượng / giá chốt': [/thương lượng|giá chốt/iu, /thương lượng|giá chốt/iu],
        'chủ đầu tư / tiến độ': [/chủ đầu tư/iu, /chủ đầu tư/iu],
      };
      const uncovered = criteriaLabels
        .filter((label) => !(statedInListing[label]?.[0].test(listingText) && statedInListing[label]?.[1].test(source)))
        .filter(
          (label) =>
            !new RegExp(
              `(?:chưa có thông tin|chưa có dữ liệu|chưa được cung cấp|không có thông tin).*${label.split(' / ')[0]}`,
              'iu',
            ).test(result.reply),
        );
      const unsupportedSuffix =
        !blocked && uncovered.length && !replyCoversGap
          ? `\n${unsupportedLine(uncovered, generalKnowledge ? (focusIds.length ? 'listing' : 'general') : false)}`
          : '';
      const ownerSuffix =
        !blocked && !/chuyên viên|nhân viên tư vấn/iu.test(result.reply) && ownerRequest(source)
          ? `\nChuyên viên tư vấn của TERAVA có thể liên hệ để hỗ trợ ${address} đăng tin và quản lý giao dịch.`
          : '';
      const loanSuffix =
        installmentBudget && !financeNote
          ? `\nTheo giả định vay khoảng 60% giá trị căn, khoản vay tham khảo là khoảng ${priceLabel(installmentBudget, false)}; số tiền trả mỗi tháng còn phụ thuộc lãi suất và thời hạn vay, chuyên viên có thể nhờ ngân hàng lập bảng cụ thể.`
          : loanBudget
            ? `\nVới khoản vay khoảng 60% giá trị căn, ngân sách tổng của ${address} vào khoảng ${priceLabel(loanBudget, false)}; điều kiện vay cụ thể cần chuyên viên tư vấn xác nhận.`
            : loanWords(source) && moneyAmounts(source).length && !generalKnowledge
              ? `\n${loanAssumption}`
              : '';
      const bookingProperty = bookingAction as { property?: Evidence; requires_sign_in?: boolean } | undefined;
      const bookingLine =
        bookingProperty?.property &&
        !/(?:form|biểu mẫu|chọn (?:giờ|khung giờ|thời gian)|đăng nhập)/iu.test(result.reply)
          ? `\n${bookingProperty.requires_sign_in ? `${addressStart} đăng nhập rồi chọn khung giờ muốn xem trong form đặt lịch bên dưới, chuyên viên sẽ xác nhận lại với chủ nhà nhé.` : `${addressStart} chọn khung giờ muốn xem trong form đặt lịch bên dưới, chuyên viên sẽ xác nhận lại với chủ nhà nhé.`}`
          : '';
      // A guest has no contact on file, so the model must not promise an immediate call.
      const guestContact = contactOnly && guest;
      if (guestContact)
        result.reply = `Mình rất sẵn lòng nhờ chuyên viên tư vấn của TERAVA liên hệ lại với ${address}.`;
      const contactLine = guestContact
        ? `\nĐể chuyên viên có thông tin liên hệ, ${address} đăng nhập rồi nhắn lại yêu cầu này, hoặc gửi biểu mẫu tư vấn giúp mình nhé. ${addressStart} cũng có thể cho mình biết khu vực, loại nhà và ngân sách để chuyên viên chuẩn bị trước.`
        : '';
      const budgetQuestion = missingBudgetQuestion(source, sanitizedHistory);
      // Generic property requests are clarified before retrieval by clarificationFor. The old
      // post-search genericClarification path could leak random listings before asking for criteria.
      const genericClarification: { needed: boolean; question: string; options: string[] } | null = null;
      const hasAssistantTurn = sanitizedHistory.some((turn) => turn.role === 'assistant');
      const nearbyFor = (location?: string) => (location ? areaAliases(location).slice(0, 2) : []);
      const area = areaLabelForFilters(budgetAdjustment?.filters || queryFilters);
      const replyCriteriaFilters = { ...rememberedCriteria, ...queryFilters };
      const criteriaLabel = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '');
      const rememberedLocation = criteriaLabel(
        replyCriteriaFilters.location ||
          (Array.isArray(replyCriteriaFilters.locations) ? replyCriteriaFilters.locations[0] : ''),
      );
      const rememberedAliases = areaAliases(rememberedLocation);
      const rememberedAreaKey = rememberedLocation
        .normalize('NFC')
        .toLocaleLowerCase('vi')
        .replace(/\s+/gu, ' ')
        .trim();
      const isThuDucDistrict = /^(?:quận\s*)?[29]$|^quận\s*[29]$|^thủ đức$/iu.test(rememberedAreaKey);
      const locationForReply = rememberedLocation
        ? isThuDucDistrict && rememberedAreaKey !== 'thủ đức'
          ? `${rememberedLocation} (Thủ Đức)`
          : withFormerDistrict(rememberedLocation)
        : '';
      const rememberedType = typeof replyCriteriaFilters.type === 'string' ? replyCriteriaFilters.type : '';
      const typeForReply =
        rememberedType === 'House'
          ? 'Nhà'
          : rememberedType === 'Apartment'
            ? 'Căn hộ'
            : rememberedType === 'Villa'
              ? 'Biệt thự'
              : rememberedType === 'Land'
                ? 'Đất'
                : '';
      const transactionForReply =
        replyCriteriaFilters.transaction_type === 'Rent'
          ? `${typeForReply ? `${typeForReply} ` : ''}Thuê`
          : replyCriteriaFilters.transaction_type === 'Sale'
            ? `${typeForReply ? `${typeForReply} ` : ''}Mua`
            : '';
      const monthly = replyCriteriaFilters.transaction_type === 'Rent';
      const budgetForReply =
        typeof replyCriteriaFilters.minPrice === 'number' &&
        typeof replyCriteriaFilters.maxPrice === 'number' &&
        replyCriteriaFilters.minPrice !== replyCriteriaFilters.maxPrice
          ? `${priceLabel(replyCriteriaFilters.minPrice, monthly)}–${priceLabel(replyCriteriaFilters.maxPrice, monthly)}`
          : typeof replyCriteriaFilters.maxPrice === 'number'
            ? `${replyCriteriaFilters.maxPriceExclusive ? 'dưới' : 'tối đa'} ${priceLabel(replyCriteriaFilters.maxPrice, monthly)}`
            : typeof replyCriteriaFilters.minPrice === 'number'
              ? `từ ${priceLabel(replyCriteriaFilters.minPrice, monthly)}`
              : '';
      const areaForReply =
        typeof replyCriteriaFilters.minArea === 'number' &&
        typeof replyCriteriaFilters.maxArea === 'number' &&
        replyCriteriaFilters.minArea !== replyCriteriaFilters.maxArea
          ? `từ ${Math.round(replyCriteriaFilters.minArea)} đến ${Math.round(replyCriteriaFilters.maxArea)} m²`
          : typeof replyCriteriaFilters.minArea === 'number'
            ? `từ ${Math.round(replyCriteriaFilters.minArea)} m²`
            : typeof replyCriteriaFilters.maxArea === 'number'
              ? `dưới ${Math.round(replyCriteriaFilters.maxArea)} m²`
              : '';
      const roomsForReply =
        typeof replyCriteriaFilters.minBedrooms === 'number' || typeof replyCriteriaFilters.maxBedrooms === 'number'
          ? `${replyCriteriaFilters.minBedrooms ?? 0}–${replyCriteriaFilters.maxBedrooms ?? 100} phòng ngủ`
          : typeof replyCriteriaFilters.bedrooms === 'number'
            ? replyCriteriaFilters.bedrooms === 0
              ? 'studio'
              : `${replyCriteriaFilters.bedrooms} phòng ngủ`
            : '';
      const centralLocation =
        Array.isArray(replyCriteriaFilters.locations) &&
        replyCriteriaFilters.locations.some((value) => centralFormerDistricts.includes(String(value)));
      const locationPart = centralLocation
        ? 'gần trung tâm (các quận trung tâm)'
        : locationForReply
          ? `ở ${locationForReply}`
          : '';
      const criteriaParts = [
        transactionForReply && locationPart
          ? `${transactionForReply}, ${locationPart}`
          : transactionForReply || locationPart,
        budgetForReply,
        areaForReply,
        roomsForReply,
      ].filter(Boolean);
      const nonTransactionParts = [locationPart, budgetForReply, areaForReply, roomsForReply].filter(Boolean);
      const hasNonTransactionCriteria = nonTransactionParts.length > 0;
      const listingSearchTurn = showCriteriaLine({
        searchPerformed,
        propertyId: input.property_id,
        adviceOnly,
        cards: items.length,
        criteria: nonTransactionParts,
        transactionOnly: !hasNonTransactionCriteria,
      });
      const criteriaLine = listingSearchTurn && input.filters === undefined ? answerCriteriaLine(criteriaParts) : '';
      const structuredNoMatch =
        searchPerformed &&
        structuredCatalogueSearch &&
        !input.property_id &&
        !contactOnly &&
        !generalQuestion &&
        !evidenceItems.length;
      const blockerCandidates =
        structuredNoMatch &&
        typeof queryFilters.maxPrice === 'number' &&
        (typeof queryFilters.bedrooms === 'number' ||
          typeof queryFilters.minBedrooms === 'number' ||
          typeof queryFilters.maxBedrooms === 'number' ||
          typeof queryFilters.minArea === 'number' ||
          typeof queryFilters.maxArea === 'number')
          ? await retrieve(
              Object.fromEntries(
                Object.entries(queryFilters).filter(
                  ([key]) => !['minPrice', 'maxPrice', 'maxPriceExclusive'].includes(key),
                ),
              ),
              null,
            ).catch(() => [] as Evidence[])
          : [];
      const blockerLine = (() => {
        if (!structuredNoMatch) return '';
        const requestedArea = areaLabelForFilters(queryFilters) || '';
        const typeLabel =
          typeof queryFilters.type === 'string'
            ? (typeLabels[queryFilters.type] || queryFilters.type).toLocaleLowerCase('vi')
            : 'bất động sản';
        const budget =
          typeof queryFilters.maxPrice === 'number'
            ? `${queryFilters.maxPriceExclusive ? 'dưới' : 'tối đa'} ${priceLabel(queryFilters.maxPrice, queryFilters.transaction_type === 'Rent')}`
            : '';
        const rooms =
          typeof queryFilters.minBedrooms === 'number' || typeof queryFilters.maxBedrooms === 'number'
            ? `${queryFilters.minBedrooms ?? 0}–${queryFilters.maxBedrooms ?? 100} phòng ngủ`
            : typeof queryFilters.bedrooms === 'number'
              ? queryFilters.bedrooms === 0
                ? 'studio'
                : `${queryFilters.bedrooms} phòng ngủ`
              : '';
        const areaFilter =
          typeof queryFilters.minArea === 'number'
            ? `từ ${Math.round(queryFilters.minArea)} m²`
            : typeof queryFilters.maxArea === 'number'
              ? `dưới ${Math.round(queryFilters.maxArea)} m²`
              : '';
        const minimumComparablePrice = blockerCandidates
          .map((item) => item.price)
          .filter((price): price is number => typeof price === 'number' && Number.isFinite(price))
          .sort((left, right) => left - right)[0];
        const priceIsActuallyHigher =
          typeof queryFilters.maxPrice === 'number' &&
          minimumComparablePrice !== undefined &&
          minimumComparablePrice > queryFilters.maxPrice;
        if (requestedArea && budget && rooms)
          return priceIsActuallyHigher
            ? `Ở ${requestedArea}, ${typeLabel} ${budget} chưa có tin đủ ${rooms}; các tin ${rooms} trong khu vực này có giá từ ${priceLabel(minimumComparablePrice, queryFilters.transaction_type === 'Rent')}.`
            : `Ở ${requestedArea}, hiện chưa có ${typeLabel} phù hợp với ${budget} và tiêu chí ${rooms}.`;
        if (requestedArea && budget && areaFilter)
          return priceIsActuallyHigher
            ? `Ở ${requestedArea}, ${typeLabel} ${budget} chưa có tin ${areaFilter}; các tin ${areaFilter} trong khu vực này có giá từ ${priceLabel(minimumComparablePrice, queryFilters.transaction_type === 'Rent')}.`
            : `Ở ${requestedArea}, hiện chưa có ${typeLabel} phù hợp với ${budget} và tiêu chí ${areaFilter}.`;
        if (nearestReason)
          return `Ở ${requestedArea || 'khu vực bạn chọn'}, các tin gần nhất đang lệch tiêu chí: ${nearestReasonForReply(nearestReason)}.`;
        return '';
      })();
      const deterministicNoMatch = structuredNoMatch
        ? deterministicNoMatchReply({
            criteria: criteriaLine,
            area: areaLabelForFilters(queryFilters),
            blocker: blockerLine,
            related: related as unknown as {
              number?: number;
              name?: string;
              location?: string;
              price?: number | null;
              reason?: string;
              relaxed_reason?: string;
            }[],
            nearby: `${availableAreasLine}${sameAreaTypesLine}`.trim(),
            exactMatchesExhausted,
          })
        : '';
      const modelAlreadyNoMatch = hasNoMatchReply(result.reply);
      const followUpQuestion = budgetQuestion;
      const financeResultPresent =
        financeNote && /(?:dư nợ|lợi suất|không an toàn|40%|16[,.]7|21[,.]6|4[,.]9|4,5%|5%)/iu.test(result.reply);
      const financeSuffix = financeNote && !financeResultPresent ? `\n${financeNote}` : '';
      const areaDeviationSuffix =
        /\b76\s*(?:m²|m2)\b[\s\S]{0,80}\b80\s*(?:m²|m2)\b|\b80\s*(?:m²|m2)\b[\s\S]{0,80}\b76\s*(?:m²|m2)\b/iu.test(
          source,
        )
          ? '\n76/80 m² là thiếu 4 m², tương đương 5%; việc điều chỉnh giá hoặc hoàn tiền còn tùy điều khoản dung sai trong hợp đồng. Thực tế thường cần đo lại có biên bản và hỏi luật sư.'
          : '';
      const riskQuestion =
        /(?:không\s+muốn\s+chịu(?:\s+bất\s+kỳ)?\s+rủi\s+ro|chắc\s+chắn\s+sinh\s+lời|không\s+rủi\s+ro|đảm\s+bảo(?:\s+\p{L}+){0,2}\s+lời)/iu.test(
          source,
        );
      const riskFreeDenial =
        /(?:không\s+có|không\s+tồn\s+tại)(?:\s+\p{L}+){0,12}\s+(?:khoản\s+)?đầu\s+tư(?:\s+\p{L}+){0,12}\s+không\s+có\s+rủi\s+ro/iu.test(
          result.reply,
        );
      const investmentRiskLine =
        riskQuestion && !riskFreeDenial
          ? '\nKhông có khoản đầu tư nào không có rủi ro và TERAVA không cam kết lợi nhuận; bạn nên kiểm tra pháp lý, quy hoạch, thanh khoản và nhờ chuyên viên tư vấn.'
          : '';
      const appendBudget = followUpQuestion && !/[?？]\s*$/.test(result.reply.trim()) ? `\n${followUpQuestion}` : '';
      // No listing matched: always point to the consultant, even when the model only suggested widening the search.
      const handoffLine =
        searchPerformed &&
        !items.length &&
        Object.keys(queryFilters).length > 0 &&
        input.filters === undefined &&
        !input.property_id &&
        !contactOnly &&
        !ownerRequest(source) &&
        !/chuyên viên|nhân viên tư vấn/iu.test(result.reply)
          ? ` Nếu chưa ưng, mình nhờ chuyên viên tư vấn tìm thêm giúp ${address} nhé.`
          : '';
      const nearestLine =
        nearestReason && related.length && !items.length
          ? `\nMình gửi bên dưới ${related.length} căn gần tiêu chí nhất (${nearestReasonForReply(nearestReason)}) để ${address} tham khảo nhé.${handoffLine}`
          : handoffLine
            ? `\n${handoffLine.trim()}`
            : '';
      const noMatchPrefix = financeNote
        ? ''
        : noMatch && !modelAlreadyNoMatch
          ? `${noMatchReply(source)}\n`
          : related.length && !items.length && !modelAlreadyNoMatch
            ? `${noMatchReply(source).split('. ')[0]}.\n`
            : '';
      const postLegalSource = legalTarget ? String((legalTarget as { description?: unknown }).description || '') : '';
      const postLegalFact = legalFactFromText(postLegalSource) || groundedLegalDetail;
      const postLegalReply =
        legalTarget && legalQuestionDirect && postLegalFact ? legalFactReply(legalTarget, postLegalFact) : '';
      const finalLegalReply =
        evidenceItems.length === 1 && legalQuestionDirect && groundedLegalDetail
          ? legalFactReply(evidenceItems[0], groundedLegalDetail)
          : '';
      const deterministicListingReply = blocked
        ? questionTurn
          ? genericQuestionFallback()
          : evidenceItems.length
            ? deterministicComparison || groundedSummary(evidenceItems)
            : safeReply
        : result.reply;
      const specificListingReply = Boolean(viewedPropertyId || codeReference.codes.length === 1);
      const availabilityNotice = availabilityNoticeForReply(source, evidenceItems, specificListingReply);
      const systemBodyPrefix =
        moreNoNew || structuredNoMatch
          ? ''
          : cheaperNoMatch
            ? cheaperFallbackReply(items, area, nearbyFor(area))
            : noMatchPrefix;
      const modelBody = structuredNoMatch
        ? deterministicNoMatch
        : moreNoNew || cheaperNoMatch || (blocked && !items.length && noMatch && !modelAlreadyNoMatch)
          ? ''
          : postLegalReply || finalLegalReply || (blocked ? deterministicListingReply : result.reply);
      const exactMatchBody =
        structuredSearchCards && items.length && hasCatalogueNoMatchReply(result.reply)
          ? `Mình tìm thấy ${items.length} căn phù hợp với tiêu chí đã nêu.`
          : '';
      const reply = assembleFinalReply({
        intro: !hasAssistantTurn ? disclosure : '',
        notices: [availabilityNotice, investmentRiskLine, structuredNoMatch ? '' : criteriaLine, systemBodyPrefix],
        body: exactMatchBody || modelBody,
        trailing: [
          areaToleranceSuffix,
          moreStatus,
          unsupportedSuffix,
          ownerSuffix,
          loanSuffix,
          bookingLine,
          contactLine,
          structuredNoMatch ? '' : nearestLine,
          structuredNoMatch ? '' : availableAreasLine,
          structuredNoMatch ? '' : sameAreaTypesLine,
          similarLine,
          appendBudget,
        ],
      });
      const premiseCorrection =
        /chưa có sổ|chưa có sổ hồng/iu.test(source) && /sẵn sổ|sổ hồng/iu.test(listingText) && !legalContradiction
          ? '\nTheo dữ liệu tin đăng, căn này được ghi là đã có sổ hồng; mình không thể xác nhận lời hứa của bên thứ ba. Bạn nên xem bản gốc giấy chứng nhận và kiểm tra tại cơ quan đăng ký đất đai.'
          : '';
      const freshnessCorrection =
        /(?:bán rồi|đã bán|còn bán không|cập nhật lần cuối)/iu.test(source) && items[0]?.updated_at
          ? `\nMình xin lỗi vì tin có thể đã chậm so với thực tế. Dữ liệu tin đăng này cập nhật ngày ${formatReplyDate(items[0].updated_at) || String(items[0].updated_at).slice(0, 10)}; mình có thể nhờ chuyên viên kiểm tra lại và gửi các căn tương tự.`
          : '';
      const externalSiteCorrection =
        /(?:bên khác|website khác|trang khác|nơi khác)/iu.test(source) &&
        !/không thể kiểm tra|không kiểm chứng|không xác minh/iu.test(result.reply)
          ? '\nTERAVA không thể kiểm tra hoặc xác minh trực tiếp các tin đăng trên website khác; chuyên viên có thể xác nhận lại giá với chủ nhà.'
          : '';
      const extraCostsComplete =
        /(?:lệ phí trước bạ|trước bạ).*0[,.]5%/iu.test(result.reply) &&
        /thuế (?:thu nhập cá nhân|TNCN).*2%/iu.test(result.reply) &&
        /phí công chứng/iu.test(result.reply) &&
        /phí bảo trì.*2%/iu.test(result.reply);
      const extraCostsSuffix =
        extraCostsQuestion && !extraCostsComplete
          ? '\nThông thường, ngoài giá bán có thể phát sinh lệ phí trước bạ 0,5%, thuế TNCN 2% (thường bên bán chịu), phí công chứng và phí bảo trì 2% đối với căn hộ mới; bên chịu từng khoản và số tiền cụ thể cần xác nhận theo hợp đồng.'
          : '';
      const policyFallback =
        'Mình chưa có thông tin về chính sách của TERAVA cho trường hợp này; chuyên viên sẽ giải thích cụ thể giúp bạn.';
      const policyFixed = (text: string) => {
        const faqText = generalKnowledge.normalize('NFC').toLocaleLowerCase('vi');
        const policyPattern = /(?:TERAVA|bên\s+TERAVA)\s+(?:không\s+có|có|chưa\s+có)\s+chính\s+sách\s+([^.!?\n]+)/iu;
        if (!policyPattern.test(text)) return text;
        const protect = (value: string) =>
          value
            .replace(/\b(?:TP|Tp|Q|P)\./gu, (match) => `${match}${String.fromCodePoint(0xe000)}`)
            .replace(/\bv\.v\./giu, (match) => `${match}${String.fromCodePoint(0xe001)}`)
            .replace(/(?<=\d)[.,](?=\d)/gu, (match) => `${match}${String.fromCodePoint(0xe002)}`);
        const restore = (value: string) =>
          value
            .replace(new RegExp(String.fromCodePoint(0xe000), 'gu'), '')
            .replace(new RegExp(String.fromCodePoint(0xe001), 'gu'), '')
            .replace(new RegExp(String.fromCodePoint(0xe002), 'gu'), '');
        return restore(
          protect(text)
            .split(/(\n|(?<=[.!?])\s+)/gu)
            .map((part) => {
              if (part === '\n' || /^\s+$/u.test(part)) return part;
              const match = part.match(policyPattern);
              if (!match) return part;
              const terms = match[1]
                .normalize('NFC')
                .toLocaleLowerCase('vi')
                .split(/[^\p{L}\p{N}]+/u)
                .filter((term) => term.length >= 4)
                .slice(0, 3);
              return terms.length && terms.every((term) => faqText.includes(term)) ? part : policyFallback;
            })
            .join(''),
        );
      };
      const neighbourFixed = (text: string) => {
        const known =
          `${availableAreasLine} ${related.map((item) => withFormerDistrict(String(item.location || ''))).join(' ')}`
            .normalize('NFC')
            .toLocaleLowerCase('vi');
        const fallback = related.length
          ? `Mình gửi bên dưới ${related.length} căn gần tiêu chí nhất để ${address} tham khảo nhé.`
          : 'Mình chưa có căn lân cận trong dữ liệu hiện có; mình nhờ chuyên viên tư vấn tìm thêm giúp bạn.';
        return text.replace(
          /(?:các\s+)?quận\s+lân\s+cận\s+như\s+([\p{L}\p{N}\s,()]+)([.!?])/giu,
          (whole, names, punctuation) => {
            const districts = String(names)
              .split(/\s*(?:,|hoặc|và)\s*/u)
              .map((value) => value.trim())
              .filter(Boolean);
            return districts.every((district) => known.includes(district.normalize('NFC').toLocaleLowerCase('vi')))
              ? whole
              : `${fallback}${punctuation}`;
          },
        );
      };
      const enrichedReply = historicalReply
        ? reply
        : neighbourFixed(
            policyFixed(
              dedupeNoMatchReply(
                assembleFinalReply({
                  body: reply,
                  trailing: [
                    areaDeviationSuffix,
                    financeSuffix,
                    premiseCorrection,
                    freshnessCorrection,
                    externalSiteCorrection,
                    extraCostsSuffix,
                  ],
                }),
              ),
            ),
          );
      // Only a detail-page chat may say the customer "is viewing" a listing (also covers regenerated answers).
      const viewingFixed = viewedPropertyId
        ? enrichedReply
        : enrichedReply.replace(
            /(^|[.!?\n]\s*)Bạn đang xem(?: có)?(?: các| những)? (?=(?:hai|ba|\d+)?\s*(?:căn|nhà|lô|đất))/gu,
            '$1Mình gợi ý ',
          );
      // "tầng 12 của tòa nhà có 12 tầng": the unit floor never tells how tall the building is, unless the listing says so.
      const floorsFixed = viewingFixed.replace(
        /\s*(?:của|trong)\s+tòa(?: nhà)?(?: có)?\s+(\d+)\s+tầng(?=[\s,.;])/giu,
        (match, floors) =>
          evidenceItems.some((item) => item.property_type === 'Apartment') ||
          !new RegExp(`${floors}\\s*tầng`, 'iu').test(listingText.replace(/tầng\s*\d+/giu, ''))
            ? ''
            : match,
      );
      // Imported apartment details write the unit floor as "12 tầng", so for apartments the clause is always dropped.
      const finalSources = (items.length ? items : evidenceItems).map((item) => ({
        ...item,
        details: details.get(item.id) || item.details,
      }));
      const finalIntro = !hasAssistantTurn && !pureClosing ? disclosure : '';
      const finalNormalisedReply = normalizeFinalReply(
        viewedPropertyId ? floorsFixed : scrubOutsideDetailViewing(floorsFixed),
        source,
        finalSources,
        {
          specificListing: specificListingReply,
          includeAvailabilityNotice: false,
          relatedCount: related.length,
          nonFirstTurn: hasAssistantTurn,
        },
      );
      const finalWithExactMatchIntro =
        structuredSearchCards && history.length === 0 && items.length
          ? hasCatalogueNoMatchReply(finalNormalisedReply)
            ? `Mình tìm thấy ${items.length} căn phù hợp với tiêu chí đã nêu.`
            : hasNoMatchReply(finalNormalisedReply)
              ? finalNormalisedReply
              : /Mình tìm thấy\s+\d+\s+căn/iu.test(finalNormalisedReply)
                ? finalNormalisedReply
                : `${finalNormalisedReply}\nMình tìm thấy ${items.length} căn phù hợp với tiêu chí đã nêu.`
          : finalNormalisedReply;
      const finalReply = pureClosing
        ? closingReply
        : finalWithExactMatchIntro.trim() === finalIntro.trim() && modelBody.trim()
          ? assembleFinalReply({
              intro: finalIntro,
              body: '',
              originalBody: modelBody,
              fallbackNotice: availabilityNotice,
            })
          : finalWithExactMatchIntro;
      const stableBudgetReply = unchangedBudgetResults
        ? `${removeFutureListingPromise(finalReply)}
Với ngân sách mới, đây vẫn là các căn duy nhất khớp tiêu chí hiện có.`
        : finalReply;
      const refinement =
        !pureClosing && items.length && structuredCatalogueSearch && clarification.refine
          ? clarification.refine
          : undefined;
      // The model may already end with the same refining question; ask it once.
      const replyWithRefinement = refinement
        ? `${stableBudgetReply
            .split('\n')
            .filter((line) => line.trim() !== refinement.question.trim())
            .join('\n')}\n${refinement.question}`
        : stableBudgetReply;
      const replyWithoutListingCodes = redactListingCodesSafe(replyWithRefinement, evidenceItems).trimStart();
      // needs_v1 is deliberately not on the response path. The deterministic
      // extraction below remains available for the commit, while the richer LLM
      // extraction runs after the reply has been sent and can never fail the turn.
      const modelNeedsPromise = !blocked
        ? extractNeedsAfterReply(source, replyWithoutListingCodes)
        : Promise.resolve(null);
      if (process.env.AI_API_URL?.includes('127.0.0.1:3301')) {
        const modelNeeds = await modelNeedsPromise;
        if (modelNeeds) {
          for (const entry of modelNeeds.invalid) log('invalid_need', entry, 'invalid_need', 'flagged');
          for (const entry of modelNeeds.entries)
            extracted[entry.field] = { value: entry.value, confidence: 1, evidence: entry.evidence };
        }
      }
      const fields = blocked
        ? {}
        : this.extraction.extractNeeds(extracted, source, (key, field) =>
            log('invalid_need', { field: key, value: field }, 'invalid_need', 'flagged'),
          );
      const acceptedFields = guest || !input.store_transcript ? {} : fields;
      const merged: Record<string, { value: unknown; evidence?: string; confirmed_by?: unknown }> | null = scoring
        ? { ...scoring.needs, ...acceptedFields }
        : null;
      if (merged && scoring)
        for (const [k, f] of Object.entries(scoring.needs))
          if (object(f) && Object.hasOwn(f, 'confirmed_by')) merged[k] = f;
      const changed =
        merged && scoring
          ? Object.keys(acceptedFields).filter(
              (k) => JSON.stringify(merged[k]?.value) !== JSON.stringify(scoring!.needs[k]?.value),
            )
          : [];
      const commitSources = items.filter((item) => typeof item.id === 'string' && uuidPattern.test(item.id));
      if (commitSources.length !== items.length)
        console.warn(
          JSON.stringify({
            event: 'chat_commit_sources_filtered',
            provided: items.length,
            persisted: commitSources.length,
          }),
        );
      let score: object | null = null;
      if (merged && scoring && changed.length) {
        const interest = safeEvidence(
          await retrieveIds([...interestIds, ...(scoring.interest_ids || []), ...commitSources.map((p) => p.id)]),
        );
        const preserve: Dimension[] = [];
        if (!changed.some((k) => k.startsWith('budget_'))) preserve.push('budget');
        if (!changed.some((k) => ['locations', 'property_types'].includes(k))) preserve.push('area_type');
        score = {
          ...this.scoring.scoreNeeds(merged, interest, scoring.verified, scoring.score_result, preserve),
          needs_version: scoring.version,
        };
      }
      const commitStarted = performance.now();
      const commitPayload = {
        p_session: id,
        p_user: who.session?.user.id || null,
        p_hash: who.guestHash,
        p_store: input.store_transcript,
        p_message: source,
        p_reply: replyWithoutListingCodes,
        p_sources: commitSources,
        p_actions: actions,
        p_fields: acceptedFields,
        p_score: score,
      };
      let committed = await systemClient().rpc('pose_system_ai_commit_chat', commitPayload);
      const commitError = committed.error;
      const internalValidationFailure =
        commitError &&
        (['22023', '22P02', '23514', '23502', '22003'].includes(commitError.code || '') ||
          /INVALID_INPUT|invalid input/i.test(commitError.message || ''));
      if (internalValidationFailure) {
        console.warn(
          JSON.stringify({
            event: 'chat_commit_validation_fallback',
            error: commitError.message || commitError.code || 'INVALID_INPUT',
          }),
        );
        committed = await systemClient().rpc('pose_system_ai_commit_chat', {
          ...commitPayload,
          p_sources: [],
          p_fields: {},
          p_score: null,
        });
      }
      timing.commit = performance.now() - commitStarted;
      if (committed.error)
        return internalValidationFailure
          ? catalogError('CATALOG_UNAVAILABLE', 'Không thể lưu hội thoại lúc này.', 503)
          : catalogDatabaseError(committed.error);
      const backgroundNeeds = !blocked
        ? modelNeedsPromise
            .then((modelNeeds) => {
              if (!modelNeeds) return;
              for (const entry of modelNeeds.invalid) console.warn(JSON.stringify({ event: 'invalid_need', entry }));
              console.info(
                JSON.stringify({
                  event: 'needs_extraction_complete',
                  session_id: id,
                  fields: modelNeeds.entries.map((entry) => entry.field),
                }),
              );
            })
            .catch((error) =>
              console.warn(
                JSON.stringify({
                  event: 'needs_extraction_failed',
                  session_id: id,
                  error: error instanceof Error ? error.message : 'UNKNOWN',
                }),
              ),
            )
        : Promise.resolve();
      // Fixture stacks await this hook for deterministic assertions; production
      // requests intentionally return without waiting for the background work.
      if (process.env.AI_API_URL?.includes('127.0.0.1:3301')) await backgroundNeeds;
      if (guest)
        (await cookies()).set('pose-ai-session', who.token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 86400 * 7,
        });
      const action = pendingActions[0];
      const scope: 'in_scope' | 'out_of_scope' = 'in_scope';
      console.info(
        JSON.stringify({
          event: 'turn_timing',
          phases: {
            ...timing,
            other: Math.max(0, performance.now() - turnStarted - Object.values(timing).reduce((a, b) => a + b, 0)),
          },
          total: performance.now() - turnStarted,
        }),
      );
      const cheaperOptions = cheaperNoMatch
        ? ['Quận 8 hoặc Nhà Bè', `Giữ ${area || 'khu vực này'}, nới diện tích`, 'Gặp chuyên viên']
        : undefined;
      const outgoingClarify = pureClosing
        ? undefined
        : refinement
          ? { needed: false, question: null, options: [], refine: refinement }
          : cheaperOptions
            ? { needed: true, question: 'Bạn muốn thử hướng nào tiếp theo?', options: cheaperOptions }
            : genericClarification || undefined;
      const payload = {
        criteria: responseCriteria,
        session: committed.data,
        reply: replyWithoutListingCodes,
        scope,
        sources: pureClosing ? [] : items,
        related: pureClosing ? [] : related,
        blocked,
        proposals,
        pending_actions: pendingActions,
        action: bookingAction || action,
        inquiry_url: '/customer/inquiries/new',
        ...(outgoingClarify ? { clarify: outgoingClarify } : {}),
      };
      if (request.headers.get('accept')?.includes('text/event-stream')) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (type: string, value: unknown) =>
              controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`));
            send('meta', {
              session_id: committed.data.id,
              scope,
              sources: items,
              related,
              criteria: responseCriteria,
              clarify: outgoingClarify,
            });
            // The stream is sent after the guarded answer is final, so only the final reply is streamed
            // (never a draft that a guard later replaced).
            const deltas = Array.from({ length: Math.ceil(replyWithoutListingCodes.length / 48) }, (_, i) =>
              replyWithoutListingCodes.slice(i * 48, i * 48 + 48),
            );
            for (const text of deltas) send('delta', { text });
            for (const pending of pendingActions) send('action', { action: pending });
            if (bookingAction) send('action', { action: bookingAction });
            send('done', {
              message: replyWithoutListingCodes,
              scope,
              blocked,
              guard: violation,
              criteria: responseCriteria,
              clarify: outgoingClarify,
            });
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }
      return catalogJson(payload);
    } catch {
      return unavailable();
    }
  }
  async getChat(request: NextRequest, id: string) {
    try {
      if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy hội thoại.', 404);
      const who = await identity();
      if (who.error) return who.error;
      const result = await readSession(id, who);
      return result.error ? catalogDatabaseError(result.error) : catalogJson({ session: result.data });
    } catch {
      return unavailable();
    }
  }
  async getSessions(request: NextRequest) {
    const session = await authenticatedSession();
    if (!session || session.role !== 'User') return catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401);
    const pageValue = Number(new URL(request.url).searchParams.get('page') || 1);
    if (!Number.isInteger(pageValue) || pageValue < 1 || pageValue > 100)
      return catalogError('INVALID_INPUT', 'Trang không hợp lệ.', 400);
    const result = await authClient(session.access).rpc('pose_ai_list_sessions', { p_page: pageValue });
    return result.error ? catalogDatabaseError(result.error) : catalogJson({ items: result.data || [] });
  }
  async appointmentOptions(request: NextRequest) {
    try {
      const session = await authenticatedSession();
      if (!session || session.role !== 'User') return catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401);
      const url = new URL(request.url),
        propertyId = url.searchParams.get('property_id'),
        start = url.searchParams.get('start');
      if (!propertyId || !uuidPattern.test(propertyId) || (start && !Number.isFinite(Date.parse(start))))
        return catalogError('INVALID_INPUT', 'Bất động sản hoặc thời gian không hợp lệ.', 400);
      const result = await authClient(session.access).rpc('pose_ai_appointment_options', {
        p_property: propertyId,
        p_start: start || null,
      });
      if (result.error?.code === 'P0002') return catalogError('NOT_FOUND', 'Không tìm thấy bất động sản.', 404);
      return result.error
        ? catalogDatabaseError(result.error)
        : catalogJson(result.data || { property: null, sales: [] });
    } catch {
      return unavailable();
    }
  }
  async createAppointment(request: NextRequest) {
    try {
      if (!validOrigin(request)) return catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403);
      const session = await authenticatedSession();
      if (!session || session.role !== 'User') return catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401);
      const parsed = await catalogInput(request);
      if (parsed.error) return parsed.error;
      const i = parsed.input as Record<string, unknown>;
      if (
        Object.keys(i).some(
          (k) => !['property_id', 'start', 'end', 'sales_id', 'note', 'session_id', 'request_key', 'phone'].includes(k),
        ) ||
        typeof i.property_id !== 'string' ||
        !uuidPattern.test(i.property_id) ||
        typeof i.start !== 'string' ||
        !Number.isFinite(Date.parse(i.start)) ||
        (i.end != null && (typeof i.end !== 'string' || !Number.isFinite(Date.parse(i.end)))) ||
        (i.sales_id != null && (typeof i.sales_id !== 'string' || !uuidPattern.test(i.sales_id))) ||
        (i.note != null && (typeof i.note !== 'string' || i.note.length > 500)) ||
        (i.session_id != null && (typeof i.session_id !== 'string' || !uuidPattern.test(i.session_id))) ||
        typeof i.request_key !== 'string' ||
        !uuidPattern.test(i.request_key)
      )
        return catalogError('INVALID_INPUT', 'Kiểm tra thông tin đặt lịch.', 400);
      // Contact number from the booking form, used only when the profile phone is not verified.
      const phone = i.phone == null || i.phone === '' ? null : normalizePhone(i.phone);
      if (i.phone != null && i.phone !== '' && !phone)
        return catalogError('INVALID_PHONE', 'Số điện thoại chưa đúng định dạng, ví dụ 0912345678.', 400);
      const result = await authClient(session.access).rpc('pose_ai_create_appointment', {
        p_property: i.property_id,
        p_start: i.start,
        p_end: i.end || null,
        p_sales: i.sales_id || null,
        p_note: i.note || null,
        p_session: i.session_id || null,
        p_request_key: i.request_key,
        p_phone: phone,
      });
      const message = result.error?.message || '';
      if (message.includes('APPOINTMENT_OVERLAP'))
        return catalogError('APPOINTMENT_OVERLAP', 'Khung giờ đã có lịch. Vui lòng chọn giờ khác.', 409);
      if (message.includes('TIME_WINDOW_INVALID'))
        return catalogError(
          'TIME_WINDOW_INVALID',
          'Vui lòng chọn thời gian từ 1 giờ tới 60 ngày tới, trong khung 08:00–20:00.',
          400,
        );
      if (message.includes('SALES_NOT_AVAILABLE'))
        return catalogError('SALES_NOT_AVAILABLE', 'Chuyên viên này không còn khả dụng.', 409);
      if (message.includes('PHONE_VERIFICATION_REQUIRED'))
        return catalogError(
          'PHONE_VERIFICATION_REQUIRED',
          'Vui lòng nhập số điện thoại để chuyên viên liên hệ xác nhận lịch hẹn.',
          409,
        );
      if (message.includes('IDENTITY_REVIEW_REQUIRED'))
        return catalogError(
          'IDENTITY_REVIEW_REQUIRED',
          'Số điện thoại này đã gắn với một khách hàng khác. Vui lòng liên hệ TERAVA để được hỗ trợ.',
          409,
        );
      if (message.includes('PROPERTY_NOT_FOUND'))
        return catalogError('PROPERTY_NOT_FOUND', 'Căn này hiện không còn nhận lịch xem.', 404);
      if (!result.error && result.data && !result.data.replayed) inquiryEvents.emit('received');
      return result.error ? catalogDatabaseError(result.error) : catalogJson(result.data);
    } catch {
      return unavailable();
    }
  }
  async deleteSession(request: NextRequest, id: string) {
    try {
      if (!validOrigin(request)) return catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403);
      if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy hội thoại.', 404);
      const session = await authenticatedSession();
      if (!session || session.role !== 'User') return catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401);
      const result = await authClient(session.access).rpc('pose_ai_delete_session', { p_session: id });
      if (result.error?.code === 'P0002') return catalogError('NOT_FOUND', 'Không tìm thấy hội thoại.', 404);
      return result.error ? catalogDatabaseError(result.error) : catalogJson({ deleted: true });
    } catch {
      return unavailable();
    }
  }
  async getUsage(request: NextRequest) {
    // Read-only GET: browsers send no Origin on same-origin GETs; CSRF checks guard state changes only.
    const session = await authenticatedSession();
    if (!session) return catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401);
    if (session.role !== 'Admin') return catalogError('FORBIDDEN', 'Bạn không có quyền xem sử dụng AI.', 403);
    const url = new URL(request.url),
      from = url.searchParams.get('from'),
      to = url.searchParams.get('to');
    const result = await authClient(session.access).rpc('pose_system_admin_ai_usage', {
      p_from: from || null,
      p_to: to || null,
    });
    return result.error ? catalogDatabaseError(result.error) : catalogJson({ items: result.data || [] });
  }
  async getAiDashboard(
    request: NextRequest,
    kind: 'overview' | 'series' | 'kinds' | 'models' | 'turns' | 'turn',
    id?: string,
  ) {
    // Read-only GET (see getUsage): authorization is the Admin session check below.
    const session = await authenticatedSession();
    if (!session) return catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401);
    if (session.role !== 'Admin') return catalogError('FORBIDDEN', 'Bạn không có quyền xem dashboard AI.', 403);
    const url = new URL(request.url),
      from = url.searchParams.get('from'),
      to = url.searchParams.get('to');
    const parseDate = (value: string | null) => (value && Number.isFinite(Date.parse(value)) ? value : null);
    const pFrom = parseDate(from),
      pTo = parseDate(to);
    if ((from && !pFrom) || (to && !pTo) || (pFrom && pTo && Date.parse(pFrom) >= Date.parse(pTo)))
      return catalogError('INVALID_INPUT', 'Khoảng thời gian không hợp lệ.', 400);
    if (kind === 'overview') {
      const result = await authClient(session.access).rpc('pose_system_admin_ai_overview');
      return result.error ? catalogDatabaseError(result.error) : catalogJson({ items: result.data || [] });
    }
    if (kind === 'series' || kind === 'kinds' || kind === 'models') {
      const bucket = url.searchParams.get('bucket');
      if (kind === 'series' && bucket && !['day', 'week', 'month'].includes(bucket))
        return catalogError('INVALID_INPUT', 'Bucket không hợp lệ.', 400);
      const rpc =
        kind === 'series'
          ? 'pose_system_admin_ai_series'
          : kind === 'kinds'
            ? 'pose_system_admin_ai_by_kind'
            : 'pose_system_admin_ai_by_model';
      const result = await authClient(session.access).rpc(
        rpc,
        kind === 'series'
          ? {
              p_bucket: bucket || 'day',
              p_from: pFrom || new Date(Date.now() - 30 * 86400000).toISOString(),
              p_to: pTo || new Date().toISOString(),
            }
          : {
              p_from: pFrom || new Date(Date.now() - 30 * 86400000).toISOString(),
              p_to: pTo || new Date().toISOString(),
            },
      );
      return result.error ? catalogDatabaseError(result.error) : catalogJson({ items: result.data || [] });
    }
    if (kind === 'turn') {
      if (!id || !uuidPattern.test(id)) return catalogError('INVALID_INPUT', 'Mã lượt không hợp lệ.', 400);
      const result = await authClient(session.access).rpc('pose_system_admin_ai_turn_calls', { p_turn_id: id });
      return result.error ? catalogDatabaseError(result.error) : catalogJson({ items: result.data || [] });
    }
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = 25;
    const result = await authClient(session.access).rpc('pose_system_admin_ai_turns', {
      p_from: pFrom || new Date(Date.now() - 30 * 86400000).toISOString(),
      p_to: pTo || new Date().toISOString(),
      p_search: url.searchParams.get('q') || null,
      p_limit: limit,
      p_offset: (page - 1) * limit,
    });
    return result.error
      ? catalogDatabaseError(result.error)
      : catalogJson({ items: result.data || [], total: result.data?.[0]?.total_count || 0, page, limit });
  }
  async handoff(request: NextRequest) {
    try {
      if (!validOrigin(request)) return catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403);
      const who = await identity();
      if (who.error) return who.error;
      if (!who.session)
        return catalogJson(
          {
            code: 'SIGN_IN_REQUIRED',
            message: 'Vui lòng đăng nhập hoặc gửi biểu mẫu tư vấn.',
            inquiry_url: '/customer/inquiries/new',
          },
          401,
        );
      const parsed = await catalogInput(request);
      if (parsed.error) return parsed.error;
      const i = parsed.input;
      if (
        Object.keys(i).some(
          (k) => !['session_id', 'summary', 'preferred_start', 'preferred_end', 'request_key'].includes(k),
        ) ||
        typeof i.session_id !== 'string' ||
        !uuidPattern.test(i.session_id) ||
        typeof i.request_key !== 'string' ||
        !uuidPattern.test(i.request_key) ||
        typeof i.summary !== 'string' ||
        i.summary.trim().length < 3 ||
        i.summary.length > 2000 ||
        (i.preferred_start == null) !== (i.preferred_end == null) ||
        (i.preferred_start != null &&
          (typeof i.preferred_start !== 'string' ||
            typeof i.preferred_end !== 'string' ||
            !Number.isFinite(Date.parse(i.preferred_start)) ||
            !Number.isFinite(Date.parse(i.preferred_end)) ||
            Date.parse(i.preferred_end) <= Date.parse(i.preferred_start) ||
            Date.parse(i.preferred_start) <= Date.now()))
      )
        return catalogError('INVALID_INPUT', 'Kiểm tra nội dung và thời gian đề nghị.', 400);
      const result = await who.client!.rpc('pose_ai_request_handoff', {
        p_session: i.session_id,
        p_summary: i.summary,
        p_preferred_start: i.preferred_start || null,
        p_preferred_end: i.preferred_end || null,
        p_idempotency_key: i.request_key,
      });
      if (result.error?.message?.includes('PHONE_VERIFICATION_REQUIRED'))
        return catalogJson(
          {
            code: 'PHONE_VERIFICATION_REQUIRED',
            message: 'Vui lòng xác minh số điện thoại trong hồ sơ hoặc dùng biểu mẫu tư vấn.',
            inquiry_url: '/customer/inquiries/new',
            profile_url: '/account',
          },
          400,
        );
      if (
        result.error?.message?.includes('IDENTITY_REVIEW_REQUIRED') ||
        result.error?.message?.includes('REOPEN_REQUIRES_REVIEW')
      )
        return catalogJson(
          {
            code: 'NEEDS_REVIEW',
            message: 'Thông tin khách hàng cần được chuyên viên kiểm tra. Vui lòng dùng biểu mẫu tư vấn.',
            inquiry_url: '/customer/inquiries/new',
          },
          409,
        );
      if (result.error?.message?.includes('APPOINTMENT_OVERLAP'))
        return catalogError('APPOINTMENT_OVERLAP', 'Khung giờ đã có đề nghị khác. Vui lòng chọn giờ khác.', 409);
      return result.error
        ? catalogDatabaseError(result.error)
        : catalogJson({
            item: result.data,
            message: 'Chuyên viên sẽ liên hệ để tư vấn. Thời gian bạn chọn chỉ là đề nghị, lịch chưa được xác nhận.',
          });
    } catch {
      return unavailable();
    }
  }

  async decideAction(request: NextRequest, actionId: string, confirm: boolean) {
    try {
      if (!validOrigin(request)) return catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403);
      if (!uuidPattern.test(actionId)) return catalogError('NOT_FOUND', 'Không tìm thấy yêu cầu.', 404);
      const who = await identity();
      if (who.error) return who.error;
      if (!who.session) return catalogError('NOT_FOUND', 'Không tìm thấy yêu cầu.', 404);
      const parsed = await catalogInput(request);
      if (parsed.error) return parsed.error;
      const body = parsed.input as Record<string, unknown>;
      const consents =
        body.consents && object(body.consents)
          ? Object.fromEntries(
              Object.entries(body.consents).filter(
                ([k, v]) => (k === 'Call' || k === 'AIVoice') && typeof v === 'boolean',
              ),
            )
          : {};
      const result = await who.client!.rpc('pose_ai_decide_pending', {
        p_action: actionId,
        p_confirm: confirm,
        p_consents: consents,
      });
      if (result.error?.message?.includes('ACTION_EXPIRED'))
        return catalogJson({ code: 'ACTION_EXPIRED', message: 'Yêu cầu đã hết hạn. Vui lòng tạo lại yêu cầu.' }, 410);
      if (result.error?.code === 'P0002') return catalogError('NOT_FOUND', 'Không tìm thấy yêu cầu.', 404);
      if (result.error) return catalogDatabaseError(result.error);
      return catalogJson({ action: result.data, message: confirm ? 'Đã xử lý yêu cầu của bạn.' : 'Đã huỷ yêu cầu.' });
    } catch {
      return unavailable();
    }
  }
}
