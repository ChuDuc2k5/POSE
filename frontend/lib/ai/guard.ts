import { object, propertyTypes } from './extraction';
import { moneyAmounts } from './money';
export { stripPhones } from './privacy';
export const GUARD_VERSION='guard.v2';
export const safeReply='Tôi chưa thể xác nhận câu trả lời an toàn từ dữ liệu hiện có. Bạn có thể yêu cầu chuyên viên tư vấn hỗ trợ.';
export const disclosure='Tôi là trợ lý AI của TERAVA.';
export function injection(text:string) { return /bỏ qua (?:hướng dẫn|chỉ dẫn)|ignore (?:previous|all) (?:instructions|rules)|bạn là admin|(?:đọc|xem|liệt kê).{0,25}(?:lead|khách hàng).{0,15}(?:khác|tất cả)|read (?:other|all) (?:customers?|leads?)|đổi (?:role|quyền|consent)|change (?:role|consent)|(?:reveal|show|đọc|tiết lộ).{0,15}system prompt/i.test(text); }
const secrets=/SUPABASE_|AI_API_|AI_MODEL|AI_TIMEOUT_MS|NEXT_PUBLIC_|CRON_SECRET|sk-[a-z0-9]|service_role|process\.env|khách hàng khác|lead khác|other customer/i;
const links=/[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\//i;
export type Evidence={id:string;code:string;name:string;price:number|null;availability:string;updated_at:string;location:string;property_type:string};
const clauses=(text:string)=>text.split(/\n|[;!?]|(?<!\d)[.,](?!\d)/).filter(Boolean);
function negated(text:string,index:number){
  const prefix=text.slice(Math.max(0,index-90),index).split(/nhưng|tuy nhiên|\bbut\b|\bhowever\b/i).at(-1) || '';
  return /(?:không|chưa|chẳng|not|never|cannot|no longer)(?:\s+(?:thể|được|có|xác nhận|đưa ra|tư vấn|hỗ trợ|nên|cần|còn|đang|sẵn|sàng|bất kỳ|any|confirm|offer|provide|make|currently|a|the|able|to|legal|payment|or|pháp lý|thanh toán|hoặc)){0,12}\s*$/i.test(prefix);
}
function commitment(text:string){
  const patterns=[/cam kết|đảm bảo|bảo đảm|guarantee/gi,/(?:pháp lý|sổ đỏ|sổ hồng|legal).{0,30}(?:đầy đủ|hợp lệ|hoàn chỉnh|an toàn|approved)/gi,/(?:có|được cấp|sở hữu).{0,20}(?:sổ đỏ|sổ hồng|giấy phép)/gi,/(?:đã có|đầy đủ|hợp lệ).{0,20}(?:pháp lý|sổ đỏ|sổ hồng)/gi,/(?:có|được|sẽ|áp dụng|tặng|giảm giá|chiết khấu).{0,30}(?:khuyến mãi|khuyến mại|ưu đãi|miễn phí|\d+\s*%)/gi,/(?:hãy|vui lòng|cần|phải|có thể|nên).{0,30}(?:thanh toán|chuyển khoản|đặt cọc)/gi,/(?:thanh toán|chuyển khoản|đặt cọc).{0,30}(?:ngay|tài khoản|cho tôi|cho TERAVA)/gi];
  return patterns.some(p=>[...text.matchAll(p)].some(m=>!negated(text,m.index!) && !/không|chưa|chẳng|\bnot\b/i.test(m[0])));
}
export function evidenceReason(item:Evidence){
  const text=`${item.code} ${item.name} ${item.location}`;
  return secrets.test(text) || injection(text) || links.test(text) || commitment(text) ? 'UNSAFE_RETRIEVED_DATA':null;
}
export function toolAllowed(tool:unknown): tool is {name:string;arguments:Record<string,unknown>} {
  if (!object(tool) || Object.keys(tool).some(k=>!['name','arguments'].includes(k)) || !object(tool.arguments)) return false;
  const args=tool.arguments;
  if (tool.name==='search_properties') return Object.keys(args).every(k=>['location','type','minPrice','maxPrice'].includes(k)) && Object.entries(args).every(([k,v])=>k==='type' ? propertyTypes.includes(v as string):k==='location' ? typeof v==='string' && v.length>0 && v.length<=120:typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1e15) && !(typeof args.minPrice==='number' && typeof args.maxPrice==='number' && args.minPrice>args.maxPrice);
  if (tool.name==='request_handoff') return Object.keys(args).length===0;
  if (tool.name==='propose_appointment') return Object.keys(args).length===2 && ['start','end'].every(k=>typeof args[k]==='string' && Number.isFinite(Date.parse(args[k] as string))) && Date.parse(args.end as string)>Date.parse(args.start as string);
  return false;
}
function references(text:string,evidence:Evidence[]){return evidence.filter(e=>[e.code,e.id].some(v=>new RegExp(`(?<![a-z0-9_-])${v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![a-z0-9_-])`,'i').test(text)));}
function moneyText(text:string,evidence:Evidence[]){
  let result=text.replace(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi,'').replace(/(?<![a-z\d_-])\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?/gi,'');
  for(const e of evidence)result=result.replace(new RegExp(`(?<![a-z0-9_-])${e.code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![a-z0-9_-])`,'gi'),'');
  return result;
}
export function outputReason(reply:string,evidence:Evidence[],customerText='') {
  if(secrets.test(reply))return 'PRIVATE_DATA_OR_SECRET';
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
    if(mentioned.length && /giá|price/i.test(clause) && !/ngân sách|bạn (?:đề nghị|nêu|có)|theo yêu cầu/i.test(clause) && moneyAmounts(moneyText(clause,evidence)).some(amount=>!mentioned.some(p=>p.price===amount)))return 'UNSUPPORTED_PRICE';
    const availability=[...clause.matchAll(/\bAvailable\b|còn (?:bán|hàng|để bán)|đang (?:mở bán|bán)|mở bán|chào bán|sẵn hàng|có sẵn|có thể mua|for sale/gi)].filter(m=>!negated(clause,m.index!));
    if(!availability.length)continue;
    let related=mentioned;
    if(!related.length)related=evidence.filter(e=>clause.toLowerCase().includes(e.name.toLowerCase()));
    if(!related.length){const prefix=reply.slice(0,reply.indexOf(clause));const prior=references(prefix,evidence).sort((a,b)=>Math.max(prefix.lastIndexOf(b.code),prefix.lastIndexOf(b.id))-Math.max(prefix.lastIndexOf(a.code),prefix.lastIndexOf(a.id)));related=prior.length ? [prior[0]]:evidence;}
    if(!related.length || related.some(e=>e.availability!=='Available'))return 'UNSUPPORTED_AVAILABILITY';
  }
  return null;
}
