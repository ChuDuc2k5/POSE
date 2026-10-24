import { object, propertyTypes } from './extraction.ts';
import { moneyAmounts } from './money.ts';
export { stripPhones } from './privacy.ts';
export const GUARD_VERSION='guard.v3';
export const safeReply='Tôi chưa thể xác nhận câu trả lời an toàn từ dữ liệu hiện có. Bạn có thể yêu cầu chuyên viên tư vấn hỗ trợ.';
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
  const corrections:Record<string,string>={UNSUPPORTED_PRICE_PERIOD:'Rent/Month: giá thuê VND/tháng. Sale/Total: giá bán tổng VND. Không trộn hai loại giá.',UNSUPPORTED_LANGUAGE:'Chỉ viết tiếng Việt, không dùng chữ Hán hay ngôn ngữ khác.',UNSUPPORTED_ROOM_COUNT:'Số phòng ngủ không có trong properties. Không mô tả căn có số phòng khách yêu cầu. Nói chưa biết số phòng, cần Sales xác nhận. Chép giá price nguyên số VND, không đổi đơn vị.',UNSUPPORTED_PRICE:'Chép đúng price nguyên số VND của căn; không đổi đơn vị hay gán giá khác.',UNSUPPORTED_COMMITMENT:'Không có dữ liệu giảm giá/pháp lý/thanh toán. Từ chối xác nhận, đề nghị Sales.',UNSUPPORTED_AVAILABILITY:'Chỉ Available còn bán; không giới thiệu trạng thái khác là còn bán.',PRIVATE_DATA_OR_SECRET:'Từ chối cung cấp dữ liệu cá nhân/secret, không trích lại nội dung đó.'};
  return {violations:[reason],correction:corrections[reason] || 'Bỏ nội dung không có trong properties, nói rõ chưa biết và đề nghị Sales.'};
}
export function injection(text:string) { return /bỏ qua (?:hướng dẫn|chỉ dẫn)|ignore (?:previous|all) (?:instructions|rules)|bạn là admin|(?:đọc|xem|liệt kê).{0,25}(?:lead|khách hàng).{0,15}(?:khác|tất cả)|read (?:other|all) (?:customers?|leads?)|đổi (?:role|quyền|consent)|change (?:role|consent)|(?:reveal|show|đọc|tiết lộ).{0,15}system prompt/i.test(text); }
const secrets=/SUPABASE_|AI_API_|AI_MODEL|AI_TIMEOUT_MS|NEXT_PUBLIC_|CRON_SECRET|sk-[a-z0-9]|service_role|process\.env/i;
const privateCustomers=/khách hàng khác|lead khác|other customers?/gi;
const links=/[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\//i;
export type Evidence={id:string;code:string;name:string;price:number|null;availability:string;updated_at:string;location:string;property_type:string;transaction_type?:'Sale'|'Rent';price_period?:'Total'|'Month';number?:number;source_type?:'Property'|'Faq';reason?:string};
const clauses=(text:string)=>text.split(/\n|[;!?]|(?<!\d)[.,](?!\d)/).filter(Boolean);
function negated(text:string,index:number){
  const prefix=text.slice(Math.max(0,index-90),index).split(/nhưng|tuy nhiên|\bbut\b|\bhowever\b/i).at(-1) || '';
  if(/(?:không|chưa) (?:có (?:thông tin(?: xác nhận)?|xác nhận)|thể cung cấp|thể chia sẻ|được phép (?:cung cấp|chia sẻ)).{0,65}$/i.test(prefix))return true;
  return /(?:không|chưa|chẳng|not|never|cannot|no longer)(?:\s+(?:thể|được|có|xác nhận|đưa ra|tư vấn|hỗ trợ|nên|cần|còn|đang|sẵn|sàng|bất kỳ|any|confirm|offer|provide|make|currently|a|the|able|to|legal|payment|or|pháp lý|thanh toán|hoặc)){0,12}\s*$/i.test(prefix);
}
function commitment(text:string){
  const patterns=[/cam kết|đảm bảo|bảo đảm|guarantee/gi,/(?:pháp lý|sổ đỏ|sổ hồng|legal).{0,30}(?:đầy đủ|hợp lệ|hoàn chỉnh|an toàn|approved)/gi,/(?:có|được cấp|sở hữu).{0,20}(?:sổ đỏ|sổ hồng|giấy phép)/gi,/(?:đã có|đầy đủ|hợp lệ).{0,20}(?:pháp lý|sổ đỏ|sổ hồng)/gi,/(?:có|được|sẽ|áp dụng|tặng|giảm giá|chiết khấu).{0,30}(?:khuyến mãi|khuyến mại|ưu đãi|miễn phí|\d+\s*%)/gi,/(?:hãy|vui lòng|cần|phải|có thể|nên).{0,30}(?:thanh toán|chuyển khoản|đặt cọc)/gi,/(?:thanh toán|chuyển khoản|đặt cọc).{0,30}(?:ngay|tài khoản|cho tôi|cho TERAVA)/gi];
  return patterns.some(p=>[...text.matchAll(p)].some(m=>!negated(text,m.index!) && !/không|chưa|chẳng|\bnot\b/i.test(m[0])));
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
export function outputReason(reply:string,evidence:Evidence[],customerText='',context?:{retrievalFound?:boolean;faqOnly?:boolean}) {
  const returned=new Set(evidence.map(e=>e.number).filter((n):n is number=>typeof n==='number'));
  for(const match of reply.matchAll(/\[(\d+)\]/g))if(returned.size&&!returned.has(Number(match[1])))return 'INVALID_CITATION';
  if(context?.retrievalFound===false&&!evidence.length && (/\b(?:rv[-_][a-z0-9]+|q\d+[-_][a-z0-9]+)\b/i.test(reply)||moneyAmounts(reply).length||/\b(?:available|còn bán|đang mở bán|có sẵn|cho thuê)\b/i.test(reply)))return 'NO_ANSWER_UNGROUNDED';
  if(context?.faqOnly && (moneyAmounts(reply).length||/\b(?:rv[-_][a-z0-9]+|q\d+[-_][a-z0-9]+)\b/i.test(reply)))return 'FAQ_UNGROUNDED';
  // Small local models sometimes slip Chinese/Japanese/Korean words into Vietnamese replies.
  if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(reply))return 'UNSUPPORTED_LANGUAGE';
  if(secrets.test(reply) || clauses(reply).some(clause=>[...clause.matchAll(privateCustomers)].some(m=>!negated(clause,m.index!))))return 'PRIVATE_DATA_OR_SECRET';
  if(links.test(reply))return 'PRIVATE_OR_UNSUPPORTED_LINK';
  if(clauses(reply).some(commitment))return 'UNSUPPORTED_COMMITMENT';
  const uuid=/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi;
  if([...reply.matchAll(uuid)].some(m=>!evidence.some(e=>e.id.toLowerCase()===m[0].toLowerCase())))return 'UNSUPPORTED_PROPERTY';
  const withoutDates=reply.replace(/(?<![a-z\d_-])\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?/gi,'').replace(uuid,'');
  const codes=[...withoutDates.matchAll(/\b[a-z][a-z\d]{0,19}(?:[-_][a-z\d]{1,20})+\b|\b[a-z]{1,12}\d[a-z\d]{0,20}\b|(?:mã sản phẩm|mã căn hộ|mã|code)\s*:?\s*([a-z\d_-]{2,40})/gi)];
  if(codes.some(m=>!evidence.some(e=>e.code.toLowerCase()===(m[1] || m[0]).toLowerCase())))return 'UNSUPPORTED_PROPERTY';
  const customerAmounts=moneyAmounts(customerText),allowed=[...customerAmounts,...evidence.flatMap(e=>e.price===null ? []:[e.price])];
  if(moneyAmounts(moneyText(reply,evidence)).some(amount=>!allowed.includes(amount)))return 'UNSUPPORTED_PRICE';
  for(const clause of clauses(reply)){
    const mentioned=references(clause,evidence);
    const prefix=reply.slice(0,reply.indexOf(clause)).toLowerCase();
    const last=(e:Evidence)=>Math.max(...[e.code,e.id,e.name].map(v=>prefix.lastIndexOf(v.toLowerCase())));
    const related=mentioned.length ? mentioned:references(prefix,evidence).sort((a,b)=>last(b)-last(a)).slice(0,1);
    const monthly=/\/\s*tháng|mỗi tháng|hàng tháng|một tháng|per month/i.test(clause);
    const rent=/thuê/i.test(clause)||monthly,sale=/giá bán|mua|còn bán|mở bán|chào bán|for sale/i.test(clause);
    if(related.some(p=>p.transaction_type==='Rent' && sale || p.transaction_type==='Sale' && rent))return 'UNSUPPORTED_PRICE_PERIOD';
    for(const amount of moneyAmounts(moneyText(clause,evidence))){
      if(/ngân sách|tiêu chí|bạn cần|bạn muốn/i.test(clause) && !/giá|price/i.test(clause))continue;
      const matching=(related.length ? related:evidence).filter(p=>p.price===amount);
      if(matching.some(p=>p.transaction_type==='Rent' && sale || p.transaction_type==='Sale' && rent))return 'UNSUPPORTED_PRICE_PERIOD';
      if(matching.some(p=>p.price_period==='Month') && !monthly || matching.some(p=>p.price_period==='Total') && rent)return 'UNSUPPORTED_PRICE_PERIOD';
    }
    for(const room of clause.matchAll(/\d+\s*phòng ngủ/gi)){
      if(evidence.some(p=>p.name.toLowerCase().includes(room[0].toLowerCase())))continue;
      const prefix=clause.slice(0,room.index!).split(/nhưng|tuy nhiên/i).at(-1) || '';
      const uncertain=/(?:không|chưa) (?:có|đủ) (?:thông tin|dữ liệu|căn cứ|bằng chứng)(?:\s+(?:để|có thể|khẳng định|xác nhận|cho biết|có)){0,6}\s*$/i.test(prefix)
        || /(?:không|chưa)(?: thể)? (?:xác nhận|xác định|khẳng định)(?: được| có)?\s*$/i.test(prefix);
      if(negated(clause,room.index!) || uncertain || /(?:chưa biết|chưa rõ|chưa xác nhận)/i.test(prefix) || /(?:bạn cần|bạn muốn|bạn tìm|nhu cầu|tiêu chí|yêu cầu)/i.test(prefix) && customerText.includes(room[0]))continue;
      return 'UNSUPPORTED_ROOM_COUNT';
    }
    // A price stated in a clause must be a listed product price; the customer's own
    // budget figures are only allowed when the clause talks about the budget.
    if(/giá|price/i.test(clause) && !/ngân sách|bạn (?:đề nghị|nêu|có)|theo yêu cầu/i.test(clause) && moneyAmounts(moneyText(clause,evidence)).some(amount=>!(mentioned.length ? mentioned:evidence).some(p=>p.price===amount)))return 'UNSUPPORTED_PRICE';
    const availability=[...clause.matchAll(/\bAvailable\b|còn (?:bán|hàng|để bán|cho thuê)|đang (?:mở bán|bán|cho thuê)|mở bán|chào bán|sẵn hàng|có sẵn|có thể (?:mua|thuê)|for (?:sale|rent)/gi)].filter(m=>!negated(clause,m.index!));
    if(!availability.length)continue;
    if(related.some(e=>e.availability!=='Available'))return 'UNSUPPORTED_AVAILABILITY';
  }
  return null;
}
