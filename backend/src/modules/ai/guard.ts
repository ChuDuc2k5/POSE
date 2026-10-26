import { object, propertyTypes } from './extraction.ts';
import { moneyAmounts, priceLabel } from './money.ts';
export function sanitizeReply(reply:string) {
  return reply
    .replace(/\[n\]/gi,'')
    .replace(/\s*\[[^\]\r\n]*\]/giu, token => /^\s*\[\d+\]\s*$/u.test(token) ? token : '')
    .replace(/\bDATA\b/g,'dữ liệu')
    .replace(/([.!?]){2,}/gu,'$1')
    .replace(/[ \t]{2,}/g,' ')
    .trim();
}
export function redactListingCodes<T extends { code?: string; name?: string }>(reply:string, sources:T[]) {
  let result=reply;
  for(const source of sources.filter(item=>item.code)) {
    const escaped=source.code!.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    result=result.replace(new RegExp(`(?<![\\p{L}\\d])${escaped}(?![\\p{L}\\d])`,'giu'), source.name || 'căn này');
  }
  return result.replace(/(?<![\\p{L}\\d])(?:CFR|CFL|RVL|P)-[A-Z\\d][A-Z\\d_-]*(?![\\p{L}\\d])/giu,'căn này');
}
const word = (source:string) => new RegExp(`(?<![\\p{L}])(?:${source})(?![\\p{L}])`,'iu');
export function redactListingCodesSafe<T extends { code?: string; name?: string }>(reply:string, sources:T[]) {
  let result=reply;
  for(const source of sources.filter(item=>item.code)) result=result.replace(source.code!,source.name||'căn này');
  return result.replace(/(?:CFR|CFL|RVL|P)-[A-Z0-9][A-Z0-9_-]*/gi,'căn này');
}
export function explicitWriteIntent(text:string) {
  const normalized=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\u0111/g,'d').toLowerCase();
  return word('luu(?: can| lai)|yeu thich|dat lich|hen xem|xem (?:nha|can)|xem truc tiep|di xem|lich xem|goi lai|lien he(?: voi| lai)?(?: toi|minh|em|anh|chi)|gap chuyen vien|nhan vien tu van|chuyen vien tu van|dang tin|tim nguoi thue|ky gui|cho thue nha|ban nha cua toi').test(normalized);
}
const refusal=/(?:không thể|không được phép|chỉ) hỗ trợ (?:yêu cầu|nội dung|câu hỏi|tìm hiểu bất động sản)|không thể (?:trả lời|đáp ứng) (?:yêu cầu|câu hỏi|nội dung) này/iu;
// Vulgar or sexual messages are refused before any search, so no listing is attached to them.
const abusiveWords=/(?<!\p{L})(?:địt|đụ|đéo|lồn|cặc|buồi|chịch|đĩ|đm|đmm|dmm|vcl|vkl|clm|cđm|fuck|fucking|porn|gái gọi|gái bán dâm|mại dâm|sex)(?!\p{L})/iu;
export function isAbusive(text:string) { return abusiveWords.test(text.normalize('NFC')); }
export const abusiveReply='Mình không thể hỗ trợ nội dung này. Nếu bạn cần tìm hiểu bất động sản, giá, khu vực hay đặt lịch xem nhà, mình sẵn sàng giúp.';
/** "giá 5 triệu" for a listed rent of 5 triệu/tháng: add the missing "/tháng" instead of rejecting the answer. */
export function labelMonthlyRent(reply:string, sources:{price:number|null;transaction_type?:string}[]) {
  const rents=new Set(sources.filter(source=>source.transaction_type==='Rent'&&source.price!==null).map(source=>source.price));
  if(!rents.size)return reply;
  return reply.replace(/\d+(?:[.,]\d+)?\s*(?:triệu|tr)(?![\p{L}])(?:\s*đồng)?(?!\s*(?:đồng|\/\s*tháng|mỗi tháng|một tháng|hàng tháng|\/m|mỗi m|một m))/giu,match=>moneyAmounts(match).some(amount=>rents.has(amount)) ? `${match}/tháng` : match);
}
/** Convert raw grouped-digit prices that quote a cited listing to the UI priceLabel format. */
export function normalizeListedPrices(reply:string, sources:{price:number|null;transaction_type?:string;price_period?:string}[]) {
  const actualRaw=/(?<![\p{L}\d])\d{1,3}(?:[., ]\d{3})+(?![\p{L}\d])(?:\s*(?:đồng|VND)(?:\s*\/\s*tháng)?|\s*\/\s*tháng)?/giu;
  return reply.replace(actualRaw,whole=>{
    const amount=moneyAmounts(whole)[0];
    const source=sources.find(item=>item.price!==null&&item.price===amount);
    return source?.price===null || !source ? whole : priceLabel(source.price,source.transaction_type==='Rent'||source.price_period==='Month');
  });
  /*
  const rawAmount=/(?<![\p{L}\d])\d{1,3}(?:[., ]\d{3})+(?![\p{L}\d])(?:\s*(?:đồng|VND)(?:\s*\/\s*tháng)?|\s*\/\s*tháng)?/giu;
  return reply.replace(rawAmount,whole=>{
    const amount=moneyAmounts(whole)[0];
    const source=sources.find(item=>item.price!==null&&item.price===amount);
    if(!source||source.price===null)return whole;
    return priceLabel(source.price,source.transaction_type==='Rent'||source.price_period==='Month');
  });
  */
}
export function normalizeCitations<T extends { number?: number; code?: string }>(reply:string, sources:T[]) {
  const byCode = new Map(sources.filter(source => source.code && source.number != null).map(source => [source.code!.toLowerCase(), source.number!]));
  return reply.replace(/\[([^\]\n]{2,80})\]/g, (whole, value:string) => {
    const number = byCode.get(value.trim().toLowerCase());
    return number == null ? whole : `[${number}]`;
  });
}
/** Remove citations that do not exist in the evidence before the output guard runs. */
export function discardInvalidCitations<T extends { number?: number }>(reply:string, sources:T[]) {
  const valid = new Set(sources.map(source => source.number).filter((number): number is number => typeof number === 'number'));
  const invalid = (value:string) => [...value.matchAll(/\[(\d{1,3})\]/g)].some(match => !valid.has(Number(match[1])));
  const missingSourceSentence = (value:string) => {
    const text = value.replace(/\[\d{1,3}\]/g, '').replace(/^\s*[-•]\s*/u, '').trim();
    return !text || /(?:chưa có|không có|không tìm thấy|chưa được cung cấp|không thể xác nhận)[\s\S]*(?:thông tin|dữ liệu|nguồn|chi tiết|xác nhận|cung cấp|tìm thấy)/iu.test(text);
  };
  return reply.split(/(\r?\n+|(?<=[.!?])\s+)/u).map(part => invalid(part) && missingSourceSentence(part) ? '' : part.replace(/\[(\d{1,3})\]/g, (whole, number:string) => valid.has(Number(number)) ? whole : '')).join('').replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;!?])/gu, '$1').trim();
}
export function sourcesFromCitations<T extends { number?: number; code?: string; price?: number|null }>(reply:string, sources:T[], referencedListing=false) {
  // A refusal never carries cards, even while a listing is being discussed.
  if (refusal.test(reply)) return [];
  if (referencedListing) return sources;
  const cited=[...new Set([...reply.matchAll(/\[(\d{1,3})\]/g)].map(match=>Number(match[1])))];
  if (cited.length) return cited.map(number=>sources.find(source=>source.number===number) || sources[number-1]).filter((source):source is T=>Boolean(source));
  // Some models list listings without [n]; keep the ones the reply names by code or by their exact catalogue
  // price (outputReason has already checked every price in the reply against the catalogue).
  const amounts=new Set(moneyAmounts(reply));
  return sources.filter(source=>(source.code && reply.toLowerCase().includes(source.code.toLowerCase())) || (source.price!=null && amounts.has(source.price)));
}
export { stripPhones } from './privacy.ts';
import { withFormerDistrict } from './ward-label.js';
import { displayListingName } from './display.js';
export const GUARD_VERSION='guard.v3';
export const safeReply='Mình chưa đủ dữ liệu để trả lời chắc chắn câu này. Bạn muốn mình nhờ chuyên viên tư vấn kiểm tra và báo lại cho bạn không?';
export const disclosure='Tôi là trợ lý AI của TERAVA.';
const realEstateWords=/căn|nhà|đất|phòng|giá|thuê|mua|bất động sản|dự án|khu vực|diện tích|chuyên viên|lịch xem|yêu thích|Q\d|RV-/i;
// Fallback only: the validated query step (`topic`) decides scope. This list is used when
// that step is unavailable. JS \b is ASCII-only, so Unicode letter lookarounds delimit words.
const explicitOutOfScope=/(?<!\p{L})(?:code|python|lập trình|bài tập|giải toán|chính trị|bầu cử|bác sĩ|đau đầu|uống thuốc|chẩn đoán|homework|dịch sang|chứng khoán|tiền ảo|bitcoin)(?!\p{L})/iu;
export function isOutOfScope(text:string, intent:'real_estate'|'other'|'unknown'='unknown', hasPropertyHistory=false) {
  // Blocks an explicit non-property topic only when neither the turn nor the session
  // supplies a property signal; greetings, thanks, and contextual follow-ups stay in-chat.
  return explicitOutOfScope.test(text) && intent!=='real_estate' && !realEstateWords.test(text) && !hasPropertyHistory;
}
export function scopeFromTopic(topic:'real_estate'|'smalltalk'|'out_of_scope', text:string, hasPropertyHistory:boolean) {
  // A model "out_of_scope" never overrides a clear property request or a property conversation.
  return topic==='out_of_scope' && !realEstateWords.test(text) && !hasPropertyHistory;
}
export const outOfScopeReply='Tôi chỉ hỗ trợ tìm hiểu bất động sản TERAVA, xem thông tin căn hộ/dự án và kết nối chuyên viên. Bạn có thể hỏi về giá, khu vực, loại hình hoặc lịch xem nhà.';
export function correctionData(reason:string){
  const corrections:Record<string,string>={UNSUPPORTED_PRICE_PERIOD:'Rent/Month: giá thuê VND/tháng. Sale/Total: giá bán tổng VND. Không trộn hai loại giá.',UNSUPPORTED_LANGUAGE:'Chỉ viết tiếng Việt, không dùng chữ Hán hay ngôn ngữ khác.',UNSUPPORTED_ROOM_COUNT:'Số phòng ngủ không có trong properties. Không mô tả căn có số phòng khách yêu cầu. Nói chưa biết số phòng, cần Sales xác nhận. Chép giá price nguyên số VND, không đổi đơn vị.',UNSUPPORTED_PRICE:'Chép đúng price nguyên số VND của căn; không đổi đơn vị hay gán giá khác.',UNSUPPORTED_COMMITMENT:'Không có dữ liệu giảm giá/pháp lý/thanh toán. Từ chối xác nhận, đề nghị Sales.',UNSUPPORTED_AVAILABILITY:'Chỉ Available còn bán; không giới thiệu trạng thái khác là còn bán.',PRIVATE_DATA_OR_SECRET:'Từ chối cung cấp dữ liệu cá nhân/secret, không trích lại nội dung đó.',RAW_LISTING_DUMP:'Không chép nguyên văn details. Trả lời trực tiếp câu hỏi về căn đang xem, dùng [1] cho dữ liệu tin đăng, rồi nêu phần chưa xác minh.'};
  return {violations:[reason],correction:corrections[reason] || 'Bỏ nội dung không có trong properties, nói rõ chưa biết và đề nghị Sales.'};
}
export function injection(text:string) { return /bỏ qua (?:hướng dẫn|chỉ dẫn)|ignore (?:previous|all) (?:instructions|rules)|bạn là admin|(?:đọc|xem|liệt kê).{0,25}(?:lead|khách hàng).{0,15}(?:khác|tất cả)|read (?:other|all) (?:customers?|leads?)|đổi (?:role|quyền|consent)|change (?:role|consent)|(?:reveal|show|đọc|tiết lộ).{0,15}system prompt/i.test(text); }
const secrets=/SUPABASE_|AI_API_|AI_MODEL|AI_TIMEOUT_MS|NEXT_PUBLIC_|CRON_SECRET|sk-[a-z0-9]|service_role|process\.env/i;
const privateCustomers=/khách hàng khác|lead khác|other customers?/gi;
const links=/[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\//i;
/**
 * Reply used when the model's answer stays blocked after regeneration but retrieval found listings:
 * built only from catalogue fields (live price and status), so it is grounded by construction.
 */
export function groundedSummary(evidence:Evidence[]) {
  const properties=evidence.filter(e=>e.source_type!=='Faq');
  if(!properties.length)return safeReply;
  const status:Record<string,string>={Available:'đang mở bán',Sold:'đã bán, không còn mở bán',Reserved:'đã giữ chỗ',Unavailable:'tạm ngưng giao dịch'};
  const lines=properties.map((e,index)=>{
    const monthly=e.price_period==='Month' || e.transaction_type==='Rent';
    if (e.transaction_type==='Rent') { status.Available='đang cho thuê'; status.Sold='đã cho thuê/không còn trống'; status.Reserved='đã có người giữ'; status.Unavailable='tạm ngưng cho thuê'; }
    // One natural sentence per listing; the conversational price label is what customers read.
    return `- ${displayListingName(e.name)} ở ${withFormerDistrict(e.location)}, giá ${priceLabel(e.price,monthly)}, ${status[e.availability] || e.availability} [${e.number ?? index+1}].`;
  });
  return `Mình tìm thấy ${properties.length} căn bạn có thể tham khảo:\n${lines.join('\n')}\nBạn muốn mình lọc thêm theo phường/đường, điều chỉnh ngân sách hay hẹn chuyên viên xem căn nào?`;
}
export type Evidence={id:string;code:string;name:string;price:number|null;availability:string;updated_at:string;location:string;property_type:string;area?:number|null;bedrooms?:number|null;transaction_type?:'Sale'|'Rent';price_period?:'Total'|'Month';number?:number;source_type?:'Property'|'Faq';reason?:string;areaNearCriteria?:boolean};
export function isValidListingPrice(item:{price?:number|null;transaction_type?:string}) {
  if(item.price === null || item.price === undefined) return true;
  if(!Number.isFinite(item.price)) return false;
  // A rent amount above 1 billion VND/month is not a valid catalogue rent
  // ceiling. Keeping this invariant at the evidence boundary also prevents a
  // malformed rent row from becoming a "tỷ/tháng" answer or criteria line.
  return item.transaction_type === 'Rent' ? item.price >= 500_000 && item.price <= 1_000_000_000 : item.price >= 50_000_000;
}

export function availabilityLabel(value: string | null | undefined, transactionType?: string) {
  const rent = transactionType === 'Rent';
  if (value === 'Available') return rent ? 'Đang cho thuê' : 'Đang mở bán';
  if (value === 'Sold') return rent ? 'Đã cho thuê, không còn trống' : 'Đã bán, không còn mở bán';
  if (value === 'Reserved') return rent ? 'Đã có người giữ, không còn trống' : 'Đã giữ chỗ, không còn mở bán';
  if (value === 'Unavailable') return rent ? 'Chưa khả dụng, không còn trống' : 'Chưa khả dụng, không còn mở bán';
  return value || 'Chưa rõ khả dụng';
}

/** Replace raw catalogue enum values before a model reply can reach a customer. */
export function rewriteAvailabilityLabels<T extends { transaction_type?: string }>(reply: string, sources: T[] = []) {
  const rent = sources.some(source => source.transaction_type === 'Rent');
  return reply
    .replace(/\bAvailable\b/giu, rent ? 'Đang cho thuê' : 'Đang mở bán')
    .replace(/\bSold\b/giu, rent ? 'Đã cho thuê, không còn trống' : 'Đã bán, không còn mở bán')
    .replace(/\bReserved\b/giu, rent ? 'Đã có người giữ, không còn trống' : 'Đã giữ chỗ, không còn mở bán')
    .replace(/\bUnavailable\b/giu, rent ? 'Chưa khả dụng, không còn trống' : 'Chưa khả dụng, không còn mở bán');
}
const clauses=(text:string)=>text.split(/\n|[;!?]|(?<!\d)[.,](?!\d)/).filter(Boolean);
function negated(text:string,index:number){
  const sentencePrefix=text.slice(0,index).split(/[.!?;\n]/u).at(-1) || '';
  const prefix=sentencePrefix.slice(Math.max(0,sentencePrefix.length-240)).split(/nhưng|tuy nhiên|\bbut\b|\bhowever\b/i).at(-1) || '';
  if(/(?:không|chưa)\s+(?:có\s+(?:thông tin(?:\s+xác nhận)?|xác nhận)|thể\s+(?:cung cấp|chia sẻ)|được phép\s+(?:cung cấp|chia sẻ))\s*$/iu.test(prefix))return true;
  if(/(?:không|chưa)\s+có\s+(?:thông tin(?:\s+xác nhận)?|xác nhận)(?:\s+\p{L}+){0,12}\s*$/iu.test(prefix))return true;
  if(/(?:không|chưa|chẳng)\s*$/iu.test(prefix))return true;
  if(/không\s+thể(?:\s+\p{L}+){0,12}\s*$/iu.test(prefix))return true;
  if(/không\s+còn\s*$/iu.test(prefix))return true;
  if(/không\s+có(?:\s+\p{L}+){0,8}\s+nào(?:\s+\p{L}+){0,12}\s*$/iu.test(prefix))return true;
  if(/không\s+có(?:\s+\p{L}+|\s*[,]){0,32}\s+nào(?:\s+\p{L}+|\s*[,]){0,32}\s*$/iu.test(prefix))return true;
  if(/không\s+phải\s+lúc\s+nào\s+cũng\s*$/iu.test(prefix))return true;
  if(/không\s+(?:cam\s+kết|bảo\s+đảm|chắc\s+chắn)\s*$/iu.test(prefix))return true;
  if(/không(?:\s+\p{L}+){0,6}\s+(?:hay|hoặc)\s*$/iu.test(prefix))return true;
  if(/không\s+nên\s+xem(?:\s+\p{L}+){0,8}\s+là\s*$/iu.test(prefix))return true;
  return /có\s+thể\s+chỉ(?:\s+được)?\s*$/iu.test(prefix);
}
// `grounded.legal`: the cited listing text itself states its papers (sổ hồng, sẵn sổ…).
// `grounded.practice`: general FAQ knowledge was supplied, so usual-practice advice about deposits,
// payments and percentages is allowed. Promises ("cam kết"), and asking to pay now are never allowed.
function commitment(text:string,grounded:{legal?:boolean;practice?:boolean}={}){
  const patterns:[RegExp,'strict'|'legal'|'practice'][]=[[/(?<!\p{L})(?:cam kết|(?<!(?:để|giúp|nhằm|nhằm mục đích)\s)(?:đảm bảo|bảo đảm)|guarantee)(?!\p{L})(?!\s+(?:quốc phòng|an ninh|quyền lợi))/giu,'strict'],[/(?<!\p{L})chắc chắn sinh lời(?!\p{L})/giu,'strict'],[/(?:pháp lý|sổ đỏ|sổ hồng|legal).{0,30}(?:đầy đủ|hợp lệ|hoàn chỉnh|an toàn|approved)/giu,'legal'],[/(?:có|được cấp|sở hữu).{0,20}(?:sổ đỏ|sổ hồng|giấy phép)/giu,'legal'],[/(?:đã có|đầy đủ|hợp lệ).{0,20}(?:pháp lý|sổ đỏ|sổ hồng)/giu,'legal'],[/(?:có|được|sẽ|áp dụng|tặng|giảm giá|chiết khấu).{0,30}(?:khuyến mãi|khuyến mại|ưu đãi|miễn phí|\d+\s*%)/giu,'practice'],[/(?:hãy|vui lòng|cần|phải|có thể|nên).{0,30}(?:thanh toán|chuyển khoản|đặt cọc)/giu,'practice'],[/(?:thanh toán|chuyển khoản|đặt cọc).{0,30}(?:ngay|tài khoản|cho tôi|cho TERAVA)/giu,'strict']];
  // Advice from the FAQ is general, never a request about this listing right now.
  const generalPractice=!/(?:căn|nhà|lô|đất) này|ngay|hôm nay/iu.test(text);
  // "Chưa có căn … đã có sổ hồng" restates a search criterion, not a claim about a listing.
  const noListing=/(?:chưa|không) (?:có|tìm thấy) (?:căn|nhà|lô|bất động sản)/iu.test(text);
  return patterns.some(([p,kind])=>(kind==='strict'||kind==='legal'&&!grounded.legal&&!noListing||kind==='practice'&&!(grounded.practice&&generalPractice)) && [...text.matchAll(p)].some(m=>!negated(text,m.index!) && !/không|chưa|chẳng|\bnot\b/i.test(m[0])));
}
export function evidenceReason(item:Evidence){
  const text=`${item.code} ${item.name} ${item.location}`;
  return secrets.test(text) || /khách hàng khác|lead khác|other customers?/i.test(text) || injection(text) || links.test(text) || commitment(text) ? 'UNSAFE_RETRIEVED_DATA':null;
}
export function toolAllowed(tool:unknown): tool is {name:string;arguments:Record<string,unknown>} {
  if (!object(tool) || Object.keys(tool).some(k=>!['name','arguments'].includes(k)) || !object(tool.arguments)) return false;
  const args=tool.arguments;
  if (tool.name==='search_properties') return Object.keys(args).every(k=>['location','type','minPrice','maxPrice','bedrooms','transaction_type'].includes(k)) && Object.entries(args).every(([k,v])=>k==='transaction_type' ? ['Sale','Rent'].includes(v as string):k==='type' ? propertyTypes.includes(v as string):k==='location' ? typeof v==='string' && v.length>0 && v.length<=120:typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1e15) && !(typeof args.minPrice==='number' && typeof args.maxPrice==='number' && args.minPrice>args.maxPrice);
  if (tool.name==='get_property_detail') return Object.keys(args).length===1 && typeof args.code==='string' && args.code.length>0 && args.code.length<=40;
  if (tool.name==='list_my_appointments') return Object.keys(args).length===0;
  if (tool.name==='save_favorite') return Object.keys(args).length===1 && typeof args.code==='string' && args.code.length>0 && args.code.length<=40;
  if (tool.name==='request_handoff') return Object.keys(args).length===0 || (Object.keys(args).length===1 && typeof args.summary==='string' && args.summary.trim().length>=3 && args.summary.length<=2000);
  if (tool.name==='propose_appointment') return Object.keys(args).length===3 && typeof args.code==='string' && Number.isFinite(Date.parse(args.preferred_start as string)) && (args.preferred_end===null || Number.isFinite(Date.parse(args.preferred_end as string)));
  return false;
}
function references(text:string,evidence:Evidence[]){return evidence.filter(e=>[e.code,e.id,e.name].some(v=>new RegExp(`(?<![a-z0-9_-])${v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![a-z0-9_-])`,'i').test(text)));}
function moneyText(text:string,evidence:Evidence[]){
  let result=text.replace(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi,'').replace(/(?<![a-z\d_-])\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?/gi,'');
  for(const e of evidence)result=result.replace(new RegExp(`(?<![a-z0-9_-])${e.code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![a-z0-9_-])`,'gi'),'');
  return result;
}
export type GuardContext = {retrievalFound?:boolean;faqOnly?:boolean;filterAmounts?:number[];previousPrices?:number[];financeAmounts?:number[];financeRanges?:[number,number][];financePresent?:boolean;faqEvidence?:boolean;sourceText?:string;listingText?:string;practice?:boolean};
export function outputReason(reply:string,evidence:Evidence[],customerText='',context?:GuardContext) {
  const returned=new Set(evidence.map(e=>e.number).filter((n):n is number=>typeof n==='number'));
  for(const match of reply.matchAll(/\[(\d+)\]/g))if(returned.size&&!returned.has(Number(match[1])))return 'INVALID_CITATION';
  const customerAmounts=moneyAmounts(customerText);
  const ungroundedReplyAmounts=moneyAmounts(reply).filter(amount=>!customerAmounts.includes(amount));
  const honestNoData=/(?:chưa có(?:\s+căn)?|hiện chưa có căn|không có căn|chưa tìm thấy căn|chưa có .*?phù hợp|chưa có (?:thông tin|dữ liệu)|chưa được cung cấp|không có dữ liệu)/iu.test(reply);
  const effectiveLimits=new Set([...(context?.filterAmounts || []), ...(context?.previousPrices || [])]);
  const onlyLimits=ungroundedReplyAmounts.every(amount=>effectiveLimits.has(amount));
  const financeTolerance=(value:number)=>Math.max(value*0.01,100_000);
  const financeAmountGrounded=(amount:number)=>(context?.financeAmounts || []).some(value=>Math.abs(value-amount)<=financeTolerance(value)) || (context?.financeRanges || []).some(([low,high])=>amount>=low-financeTolerance(low)&&amount<=high+financeTolerance(high));
  const financeGroundedAnswer=Boolean(context?.financePresent) && ungroundedReplyAmounts.every(financeAmountGrounded);
  if(context?.retrievalFound===false&&!evidence.length&&!financeGroundedAnswer && (/\b(?:rv[-_][a-z0-9]+|q\d+[-_][a-z0-9]+)\b/i.test(reply)||ungroundedReplyAmounts.length&&!onlyLimits||(/\b(?:available|còn bán|đang mở bán|có sẵn)\b/i.test(reply))||(/\bcho thuê\b/i.test(reply)&&!honestNoData)))return 'NO_ANSWER_UNGROUNDED';
  if(context?.faqOnly && (moneyAmounts(reply).length||/\b(?:rv[-_][a-z0-9]+|q\d+[-_][a-z0-9]+)\b/i.test(reply)))return 'FAQ_UNGROUNDED';
  // Small local models sometimes slip Chinese/Japanese/Korean words into Vietnamese replies.
  if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(reply))return 'UNSUPPORTED_LANGUAGE';
  if(secrets.test(reply) || clauses(reply).some(clause=>[...clause.matchAll(privateCustomers)].some(m=>!negated(clause,m.index!))))return 'PRIVATE_DATA_OR_SECRET';
  if(links.test(reply))return 'PRIVATE_OR_UNSUPPORTED_LINK';
  const grounded={legal:/sổ hồng|sổ đỏ|sẵn sổ|sổ riêng|có sổ|pháp lý/iu.test(context?.listingText||''),practice:!!context?.practice};
  Object.assign(grounded,{legal:grounded.legal || !!context?.faqEvidence});
  if(clauses(reply).some(clause=>commitment(clause,grounded)))return 'UNSUPPORTED_COMMITMENT';
  // Travel times and distances ("khoảng 15-30 phút", "3 km") are only allowed when a cited source states them.
  const sourceText=`${context?.sourceText||''} ${evidence.map(e=>`${e.name||''} ${e.location||''}`).join(' ')}`;
  for(const m of reply.matchAll(/\d+(?:[,.]\d+)?(?:\s*[-–]\s*\d+(?:[,.]\d+)?)?\s*(?:phút|km|cây số)(?![\p{L}])/giu))if(!sourceText.replace(/\s+/gu,'').includes(m[0].replace(/\s+/gu,'')) && !customerText.includes(m[0].replace(/\s+/gu,' ')) && !customerText.replace(/\s+/gu,'').includes(m[0].replace(/\s+/gu,'')))return 'UNSUPPORTED_TRAVEL';
  const uuid=/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi;
  if([...reply.matchAll(uuid)].some(m=>!evidence.some(e=>e.id.toLowerCase()===m[0].toLowerCase())))return 'UNSUPPORTED_PROPERTY';
  const withoutDates=reply.replace(/(?<![a-z\d_-])\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?/gi,'').replace(uuid,'');
  // Listing codes look like CFR-79F29F4A…, RVL-…, P-1 (uppercase prefix + hyphen) or follow an explicit
  // "mã"/"code" label. Plain tokens such as "Q7", "M8", "2PN" are building/district words, not codes,
  // and anything already present in the cited listings' names or locations is allowed.
  const evidenceText=evidence.map(e=>`${e.name||''} ${e.location||''}`).join(' ').toLowerCase();
  const codes=[...withoutDates.matchAll(/(?<![\p{L}\d])[A-Z][A-Z\d]{0,5}-[A-Z\d]{1,24}(?![\p{L}\d])|(?:mã sản phẩm|mã căn hộ|mã căn|mã|code)\s*:?\s*([A-Za-z\d][A-Za-z\d_-]{1,40})/gu)];
  if(codes.some(m=>{const code=(m[1] || m[0]).toLowerCase();return !evidence.some(e=>e.code.toLowerCase()===code) && !evidenceText.includes(code);}))return 'UNSUPPORTED_PROPERTY';
  // Amounts stated in the listing text or FAQ, and a listing's price per m², are grounded too.
  const perSquareMetre=evidence.flatMap(e=>e.price!==null&&e.area ? [e.price/e.area] : []);
  const sourceAmounts=moneyAmounts(context?.sourceText||'');
  const sourced=(amount:number)=>sourceAmounts.includes(amount)||perSquareMetre.some(value=>Math.abs(value-amount)<=value*0.03)||financeAmountGrounded(amount);
  const allowed=[...customerAmounts,...effectiveLimits,...(context?.previousPrices || []),...evidence.flatMap(e=>e.price===null ? []:[e.price])];
  // A listing price rounded for reading (5.199.900.000 → "5,2 tỷ") is still that price.
  const listed=(amount:number)=>evidence.some(p=>p.price!==null&&Math.abs(p.price-amount)<=p.price*0.01);
  const boundPattern=/(?:dưới|trên|khoảng|tầm|hơn|từ|đến)/iu;
  const approximateBound=(amount:number)=>boundPattern.test(reply) && evidence.some(item=>item.price!==null&&Math.abs(item.price-amount)<=item.price*0.1);
  const grounds=(amount:number)=>allowed.includes(amount)||listed(amount)||sourced(amount)||approximateBound(amount);
  if(moneyAmounts(moneyText(reply,evidence)).some(amount=>!grounds(amount)))return 'UNSUPPORTED_PRICE';
  for(let clause of clauses(reply)){
    for(const room of clause.matchAll(/(\d+)\s*(?:PN|ph\u00f2ng ng\u1ee7)/giu)){
      const count=Number(room[1]);
      if(evidence.some(p=>p.bedrooms===count || new RegExp('(?:^|[^\\d])'+count+'\\s*(?:PN|ph\u00f2ng ng\u1ee7)', 'iu').test(p.name))) clause=clause.replace(room[0],'');
    }
    const mentioned=references(clause,evidence);
    const prefix=reply.slice(0,reply.indexOf(clause)).toLowerCase();
    const last=(e:Evidence)=>Math.max(...[e.code,e.id,e.name].map(v=>prefix.lastIndexOf(v.toLowerCase())));
    const related=mentioned.length ? mentioned:references(prefix,evidence).sort((a,b)=>last(b)-last(a)).slice(0,1);
    const monthly=/\/\s*tháng|mỗi tháng|hàng tháng|một tháng|per month/i.test(clause);
    // "trung tâm mua sắm" is a shopping centre, not a purchase.
    const rent=/thuê/i.test(clause)||monthly,sale=/giá bán|(?<![\p{L}])mua(?! sắm)(?![\p{L}])|còn bán|mở bán|chào bán|for sale/iu.test(clause);
    if(related.some(p=>p.transaction_type==='Rent' && sale || p.transaction_type==='Sale' && rent))return 'UNSUPPORTED_PRICE_PERIOD';
    for(const amount of moneyAmounts(moneyText(clause,evidence))){
      if(/ngân sách|tiêu chí|bạn cần|bạn muốn/i.test(clause) && !/giá|price/i.test(clause))continue;
      const matching=(related.length ? related:evidence).filter(p=>p.price===amount);
      if(matching.some(p=>p.transaction_type==='Rent' && sale || p.transaction_type==='Sale' && rent))return 'UNSUPPORTED_PRICE_PERIOD';
      if(matching.some(p=>p.price_period==='Month') && !monthly || matching.some(p=>p.price_period==='Total' && p.transaction_type!=='Rent') && rent)return 'UNSUPPORTED_PRICE_PERIOD';
    }
    for(const room of clause.matchAll(/\d+\s*phòng ngủ/gi)){
      // Grounded when a listing states it (name, bedrooms field or listing text) or the customer asked for it.
      const said=room[0].toLowerCase(),count=Number(room[0].match(/\d+/)![0]);
      if(evidence.some(p=>p.name.toLowerCase().includes(said)||p.bedrooms===count) || customerText.toLowerCase().includes(said) || sourceText.toLowerCase().includes(said) || new RegExp(`(?<!\\d)${count}\\s*(?:pn|phòng ngủ|phòng)(?![\\p{L}])`,'iu').test(sourceText))continue;
      const prefix=clause.slice(0,room.index!).split(/nhưng|tuy nhiên/i).at(-1) || '';
      const uncertain=/(?:không|chưa) (?:có|đủ) (?:thông tin|dữ liệu|căn cứ|bằng chứng)(?:\s+(?:để|có thể|khẳng định|xác nhận|cho biết|có)){0,6}\s*$/i.test(prefix)
        || /(?:không|chưa)(?: thể)? (?:xác nhận|xác định|khẳng định)(?: được| có)?\s*$/i.test(prefix);
      if(negated(clause,room.index!) || uncertain || /(?:chưa biết|chưa rõ|chưa xác nhận)/i.test(prefix) || /(?:bạn cần|bạn muốn|bạn tìm|nhu cầu|tiêu chí|yêu cầu)/i.test(prefix) && customerText.includes(room[0]))continue;
      return 'UNSUPPORTED_ROOM_COUNT';
    }
    // A price stated in a clause must be a listed product price; the customer's own
    // budget figures are only allowed when the clause talks about the budget.
    // "giá dưới 15 triệu/tháng" repeats the customer's own limit, not a listing price.
    const echoesLimit=(amount:number)=>(customerAmounts.includes(amount)||effectiveLimits.has(amount)) && /dưới|trên|tối đa|tối thiểu|không quá|khoảng|tầm|từ|đến|mức/i.test(clause);
    const priorPrice=(amount:number)=>(context?.previousPrices || []).some(value=>Math.abs(value-amount)<=value*0.01);
     if(/giá|price/i.test(clause) && !/ngân sách|bạn (?:đề nghị|nêu|có)|theo yêu cầu/i.test(clause) && moneyAmounts(moneyText(clause,evidence)).some(amount=>!echoesLimit(amount) && !priorPrice(amount) && !(mentioned.length ? mentioned:evidence).some(p=>p.price!==null&&Math.abs(p.price-amount)<=p.price*0.01) && !sourced(amount) && !approximateBound(amount)))return 'UNSUPPORTED_PRICE';
    const availability=[...clause.matchAll(/\bAvailable\b|còn (?:bán|hàng|để bán|cho thuê)|đang (?:mở bán|bán|cho thuê)|mở bán|chào bán|sẵn hàng|có sẵn|có thể (?:mua|thuê)|for (?:sale|rent)/gi)].filter(m=>!negated(clause,m.index!));
    if(!availability.length)continue;
    if(related.some(e=>e.availability!=='Available'))return 'UNSUPPORTED_AVAILABILITY';
  }
  return null;
}

/** Return the guard code plus the concrete token that caused a preview to be blocked. */
export function outputDiagnostic(reply:string,evidence:Evidence[],customerText='',context?:GuardContext) {
  const reason=outputReason(reply,evidence,customerText,context);
  if(!reason)return {reason:null as null, detail:null as null};
  if(reason==='UNSUPPORTED_COMMITMENT') {
    const phrase=clauses(reply).find(clause=>commitment(clause,{legal:/sổ hồng|sổ đỏ|sẵn sổ|sổ riêng|có sổ|pháp lý/iu.test(context?.listingText||'') || !!context?.faqEvidence,practice:!!context?.practice}));
    return {reason,detail:phrase ? `commitment: "${phrase.trim()}"` : 'commitment: unknown'};
  }
  if(reason==='UNSUPPORTED_PRICE') {
    const customerAmounts=moneyAmounts(customerText);
    const effectiveLimits=new Set([...(context?.filterAmounts || []), ...(context?.previousPrices || [])]);
    const allowed=[...customerAmounts,...effectiveLimits,...evidence.flatMap(e=>e.price===null ? []:[e.price])];
    const listed=(amount:number)=>evidence.some(p=>p.price!==null&&Math.abs(p.price-amount)<=p.price*0.01);
    const unsupported=moneyAmounts(moneyText(reply,evidence)).find(amount=>!allowed.includes(amount)&&!listed(amount));
    return {reason,detail:unsupported === undefined ? 'unsupported: unknown amount' : `unsupported: "${priceLabel(unsupported)}"`};
  }
  return {reason,detail:null as null};
}

export function rewriteUnsupportedPolicy(text:string,faqKnowledge:string,fallback:string) {
  const faqText=faqKnowledge.normalize('NFC').toLocaleLowerCase('vi');
  const policyPattern=/(?:TERAVA|bên\s+TERAVA)\s+(?:không\s+có|có|chưa\s+có)\s+chính\s+sách\s+([^.!?\n]+)/iu;
  if(!policyPattern.test(text))return text;
  const protect=(value:string)=>value
    .replace(/\b(?:TP|Tp|Q|P)\./gu,match=>`${match}\uE000`)
    .replace(/\bv\.v\./giu,match=>`${match}\uE001`)
    .replace(/(?<=\d)[.,](?=\d)/gu,match=>`${match}\uE002`);
  const restore=(value:string)=>value.replace(/\uE000/gu,'').replace(/\uE001/gu,'').replace(/\uE002/gu,'');
  return restore(protect(text).split(/(\n|(?<=[.!?])\s+)/gu).map(part=>{
    if(part==='\n'||/^\s+$/u.test(part))return part;
    const match=part.match(policyPattern);
    if(!match)return part;
    const terms=match[1].normalize('NFC').toLocaleLowerCase('vi').split(/[^\p{L}\p{N}]+/u).filter(term=>term.length>=4).slice(0,3);
    return terms.length&&terms.every(term=>faqText.includes(term)) ? part : fallback;
  }).join(''));
}

export function removeReplyArtifacts<T extends { number?: number; name?: string; availability?: string }>(reply:string, sources:T[], allowMore=false) {
  let result=reply.replace(/\[market_summary\]/giu,'');
  if(!allowMore) result=result.replace(/(?:^|\n)\s*Mình (?:chỉ còn \d+ căn khác đúng tiêu chí trong dữ liệu hiện có|gửi \d+ căn khác đúng tiêu chí trong dữ liệu hiện có|gửi 5 căn khác đúng tiêu chí; dữ liệu còn \d+ căn phù hợp|gửi \d+ căn khác đúng tiêu chí trong dữ liệu hiện có)\.\s*/giu,'');
  const sourceNumbers=new Set(sources.map(source=>source.number).filter((number):number is number=>typeof number==='number'));
  return result.split(/\n/u).map(line=>{
    // Only a bare "[n] title – price" line (a raw citation title) is replaced; descriptive lines stay.
    const match=line.match(/^\s*\[(\d+)\]\s+([^\n]+?)\s+[–-]\s+[\d.,]+\s*(?:tỷ|triệu)(?:\s*đồng)?(?:\s*\/\s*tháng)?\s*$/u);
    if(!match || !sourceNumbers.has(Number(match[1])) || !moneyAmounts(line).length)return line;
    const source=sources.find(item=>item.number===Number(match[1]));
    const status=source?.availability==='Sold' ? 'Đã bán, không còn mở bán' : source?.availability==='Reserved' ? 'Đã giữ chỗ, không còn mở bán' : source?.availability==='Unavailable' ? 'Chưa khả dụng, không còn mở bán' : source?.availability==='Available' ? 'Đang mở bán' : '';
    return `[${match[1]}]${status ? ` ${status}.` : ''}`;
  }).join('\n').replace(/\n{3,}/gu,'\n\n').trim();
}

export function dedupeListings<T extends { name?: string; price?: number|null; area?: number|null }>(list:T[]) {
  const seen=new Set<string>();
  return list.filter(item=>{
    const key=[item.name?.normalize('NFC').trim().toLocaleLowerCase('vi') || '',item.price ?? '',item.area ?? ''].join('|');
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}

export function rewriteUnverifiedAvailability(reply:string, question:string, sources:{ availability?: string }[]) {
  if(!sources.some(source=>source.availability==='Available') || !/(?:còn\s+trống|còn\s+bán|thực\s+sự|kiểm\s+tra.*còn)/iu.test(question))return reply;
  let result=reply
    .replace(/tin đăng đang cập nhật tình trạng tin đăng đang ghi là còn bán/giu, 'tin đăng đang ghi là còn bán')
    .replace(/(?:căn(?:\s+hộ)?|nhà)\s+tin\s+đăng\s+(?:đang|được)\s+ghi\s+là\s+còn\s+bán(?:\s+hay\s+không)?/giu,'tin đăng đang ghi là còn bán; mình không thể xác nhận theo thời gian thực')
    .replace(/căn(?:\s+này)?\s+hiện\s+trạng(?:\s+là)?\s+còn\s+trống/giu,'căn này vẫn được tin đăng ghi là còn bán')
    .replace(/hiện\s+trạng(?:\s+là)?\s+còn\s+trống/giu,'tin đăng đang ghi là còn bán')
    .replace(/căn(?:\s+này)?(?:\s+vẫn)?\s+còn\s+trống/giu,'căn này vẫn được tin đăng ghi là còn bán');
  result=result.replace(/tin đăng (?:đang|được) ghi là còn\s+trống/giu,'tin đăng đang ghi là còn bán');
  result=result.replace(/còn\s+trống/giu,(match,index,whole:string)=>{
    const prefix=whole.slice(0,index);
    return /tin\s+đăng(?:\s+\p{L}+){0,4}\s*$/iu.test(prefix) ? match : 'tin đăng đang ghi là còn bán';
  });
  const canonical='tin đăng đang ghi là còn bán';
  return result.replace(new RegExp(`(${canonical})([^.!?\\n]*?)(?:,?\\s*(?:tức là|nghĩa là)[^.!?\\n]*?${canonical})`,'giu'),'$1$2');
}

export function removeUnpromptedNegotiation(reply:string, question:string) {
  if(/(?:thương\s+lượng|chiết\s+khấu|giảm\s+giá|giá\s+chốt)/iu.test(question))return reply;
  return reply.replace(/(?:nếu\s+)?bạn\s+thanh\s+toán\s+(?:nhanh|một\s+lần)[^.?!\n]*(?:thương\s+lượng|chiết\s+khấu)[^.?!\n]*[.!]?/giu,'').replace(/\n{3,}/gu,'\n\n').trim();
}

export function correctUnknownReply(reply:string) {
  if (/chưa có thông tin/iu.test(reply)) return reply;
  return reply.replace(/(^|[.!?\n]\s*)(?:Mình\s+)?không tự ý đoán hay nói không biết(?=[.!?\n]|$)/giu, '$1Tin đăng chưa có thông tin; mình sẽ nhờ chuyên viên tư vấn kiểm tra giúp bạn');
}

export function isRawListingDump(reply: string) {
  const markers = [/Mã căn:/iu, /Nguồn: dữ liệu/iu, /Bất động sản bán ·/iu];
  return markers.filter(pattern => pattern.test(reply)).length >= 2;
}

export function removeUnpromptedOwnerTemplate(reply: string, allowed: boolean) {
  if (allowed) return reply;
  return reply.replace(/(?:Chuyên viên tư vấn của TERAVA|TERAVA) có thể liên hệ[^.!?\n]*(?:đăng tin|quản lý giao dịch)[^.!?\n]*[.!?]?/giu, '').replace(/\n{3,}/gu, '\n\n').trim();
}
