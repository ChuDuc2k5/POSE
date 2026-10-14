import { object, propertyTypes } from './extraction';
export const GUARD_VERSION='guard.v1';
export const safeReply='Tôi chưa thể xác nhận thông tin này. Bạn có thể yêu cầu chuyên viên tư vấn hỗ trợ.';
export const disclosure='Tôi là trợ lý AI của TERAVA.';
export const phonePattern=/\+?\d(?:[\d\s().-]{6,}\d)/g;
export function stripPhones(text:string) { return text.replace(phonePattern,'[đã ẩn số liên hệ]'); }
export function injection(text:string) { return /bỏ qua hướng dẫn|ignore previous|ignore.*instructions|bạn là admin|đọc.*lead|other (?:customers?|leads?)|đổi (?:role|quyền|consent)|change (?:role|consent)|system prompt|SUPABASE_.*KEY|AI_API_KEY/i.test(text); }
const privateOrCommitment=/SUPABASE_|AI_API_|AI_MODEL|NEXT_PUBLIC_|CRON_SECRET|sk-[a-z0-9]|service_role|environment|process\.env|khách hàng khác|lead khác|other customer|pháp lý|sổ đỏ|cam kết|đảm bảo|khuyến mãi|khuyến mại|thanh toán|chuyển khoản|discount|guarantee|legal|payment/i;
export function evidenceReason(item:Evidence){
  const text=`${item.code} ${item.name}`;
  return privateOrCommitment.test(text) || injection(text) || /[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\//i.test(text) ? 'UNSAFE_RETRIEVED_DATA':null;
}
export type Evidence={id:string;code:string;name:string;price:number|null;availability:string;updated_at:string;location:string;property_type:string};
export function toolAllowed(tool:unknown): tool is {name:string;arguments:Record<string,unknown>} {
  if (!object(tool) || Object.keys(tool).some(k=>!['name','arguments'].includes(k)) || !object(tool.arguments)) return false;
  const args=tool.arguments;
  if (tool.name==='search_properties') return Object.keys(args).every(k=>['location','type','minPrice','maxPrice'].includes(k)) && Object.entries(args).every(([k,v])=>k==='type' ? propertyTypes.includes(v as string):k==='location' ? typeof v==='string' && v.length>0 && v.length<=120:typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1e15) && !(typeof args.minPrice==='number' && typeof args.maxPrice==='number' && args.minPrice>args.maxPrice);
  if (tool.name==='request_handoff') return Object.keys(args).length===0;
  if (tool.name==='propose_appointment') return Object.keys(args).length===2 && ['start','end'].every(k=>typeof args[k]==='string' && Number.isFinite(Date.parse(args[k] as string))) && Date.parse(args.end as string)>Date.parse(args.start as string);
  return false;
}
export function outputReason(reply:string, evidence:Evidence[]) {
  if (privateOrCommitment.test(reply)) return 'UNSUPPORTED_COMMITMENT_OR_PRIVATE_DATA';
  const ids=reply.match(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/gi)||[];
  if(ids.some(id=>!evidence.some(e=>e.id===id)))return 'UNSUPPORTED_PROPERTY';
  // Product facts are rendered from current evidence only; prose stays qualitative.
  if (/\d|\bAvailable\b|\bSold\b|còn hàng|đang bán|giá\s+(?:là|chỉ|từ)|\bVND\b|tỷ|triệu|nghìn|ngàn/i.test(reply)) return 'UNSUPPORTED_FACT';
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\//i.test(reply)) return 'PRIVATE_OR_UNSUPPORTED_LINK';
  if (!reply.trim().endsWith('?') && !['Tôi chưa có đủ thông tin để tư vấn.','Tôi có thể hỗ trợ tìm bất động sản dựa trên dữ liệu công bố.'].includes(reply.trim())) return 'UNSUPPORTED_ASSERTION';
  return null;
}
export function evidenceReply(items:Evidence[]) {
  if (!items.length) return 'Chưa có sản phẩm phù hợp trong dữ liệu công bố. Bạn có thể nới ngân sách, khu vực hoặc loại bất động sản không?';
  const labels:Record<string,string>={Available:'Đang mở bán',Sold:'Đã bán, không còn mở bán',Reserved:'Đã giữ chỗ, không còn mở bán',Unavailable:'Chưa khả dụng, không còn mở bán'};
  return items.map(e=>`${e.code} · ${e.name}: ${e.price===null ? 'giá chưa công bố':`${e.price.toLocaleString('vi-VN')} VND`}. ${labels[e.availability] || 'Chưa xác định tình trạng'}. Cập nhật lúc ${e.updated_at}.`).join('\n');
}
