import { availabilityLabels, propertyTypeLabels, uuidPattern, type CatalogItem } from './catalog';
import { normalizePhone } from './profile-validation';

export type PublicProperty = CatalogItem & { project_name: string; subdivision_name: string | null; amenities: string; cover_id: string | null };
export type SearchResult = { items: PublicProperty[]; total: number; page: number; pageSize: number; snapshot: string; expiresAt: string };
export type Favorite = { property_id: string; created_at: string; property: PublicProperty | null };
export const inquiryLabels = { PendingVerification: 'Chờ xác minh số điện thoại', Received: 'Đã tiếp nhận', NeedsReview: 'Chờ kiểm tra thông tin' };
export type Inquiry = { id: string; property_id: string | null; property_name: string | null; name: string; phone: string; email: string; channel: 'Email' | 'Phone'; preferred_time: string; message: string; status: keyof typeof inquiryLabels; phone_verified: boolean; created_at: string; consent: Record<string, boolean> };
export const sortLabels = { newest: 'Mới cập nhật', priceAsc: 'Giá tăng dần', priceDesc: 'Giá giảm dần', areaAsc: 'Diện tích tăng dần', areaDesc: 'Diện tích giảm dần' };

export function searchParameters(params: URLSearchParams) {
  const fields: Record<string,string> = {};
  const filters: Record<string,string|number> = {};
  const known = ['q','location','project','type','minPrice','maxPrice','minArea','maxArea','bedrooms','availability','sort','page','pageSize','snapshot'];
  for (const [key,value] of params) {
    if (!known.includes(key) || params.getAll(key).length > 1) fields.form = 'Bộ lọc không hợp lệ.';
    if (['q','location'].includes(key) && value.trim()) { if (value.length>120) fields[key]='Nhập tối đa 120 ký tự.'; else filters[key]=value.trim(); }
  }
  for (const key of ['project','type','availability','sort']) {
    const value=params.get(key); if (!value) continue;
    const valid=key==='project' ? uuidPattern.test(value) : Object.hasOwn(key==='type' ? propertyTypeLabels:key==='availability' ? availabilityLabels:sortLabels,value);
    if (!valid) fields[key]='Lựa chọn không hợp lệ.'; else filters[key]=value;
  }
  for (const key of ['minPrice','maxPrice','minArea','maxArea','bedrooms']) {
    const value=params.get(key); if (value===null || value==='') continue;
    const n=Number(value),max=key.includes('Price') ? 1e15:key==='bedrooms' ? 100:1e9;
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(n) || n<0 || n>max || key==='bedrooms' && !Number.isInteger(n)) fields[key]='Giá trị không hợp lệ.';
    else filters[key]=n;
  }
  for (const [min,max] of [['minPrice','maxPrice'],['minArea','maxArea']]) if (filters[min]!==undefined && filters[max]!==undefined && Number(filters[min])>Number(filters[max])) fields[max]='Giá trị tối đa phải lớn hơn hoặc bằng tối thiểu.';
  const page=Number(params.get('page') || 1),pageSize=Number(params.get('pageSize') || 12),snapshot=params.get('snapshot') || null;
  if (!Number.isSafeInteger(page) || page<1 || page>10000 || !Number.isSafeInteger(pageSize) || pageSize<1 || pageSize>50) fields.page='Trang không hợp lệ.';
  if (snapshot && !uuidPattern.test(snapshot)) fields.snapshot='Phiên tìm kiếm không hợp lệ.';
  return { filters,page,pageSize,snapshot,fields };
}

export function inquiryInput(input: Record<string,unknown>) {
  const fields: Record<string,string> = {};
  const allowed=['property_id','name','phone','country','channel','preferred_time','message','consent','request_key'];
  if (Object.keys(input).some(key=>!allowed.includes(key))) fields.form='Dữ liệu chứa trường không được phép.';
  if (typeof input.request_key!=='string' || !uuidPattern.test(input.request_key)) fields.form='Mã yêu cầu không hợp lệ.';
  if (input.property_id!==null && (typeof input.property_id!=='string' || !uuidPattern.test(input.property_id))) fields.property_id='Sản phẩm không hợp lệ.';
  if (typeof input.name!=='string' || input.name.trim().length<2 || input.name.trim().length>80) fields.name='Họ tên từ 2 đến 80 ký tự.';
  const country=input.country,rawPhone=typeof input.phone==='string' ? input.phone:'';
  const phone=country==='VN' ? normalizePhone(rawPhone):/^\+[1-9]\d{7,14}$/.test(rawPhone.trim()) ? rawPhone.trim():null;
  if (!['VN','International'].includes(country as string)) fields.country='Chọn quốc gia của số liên hệ.';
  if (!phone || country==='VN' && !/^\+84\d{9}$/.test(phone)) fields.phone=country==='VN' ? 'Nhập số Việt Nam hợp lệ.':'Nhập số có mã quốc gia, ví dụ +12025550123.';
  if (!['Email','Phone'].includes(input.channel as string)) fields.channel='Chọn kênh liên hệ.';
  if (typeof input.preferred_time!=='string' || input.preferred_time.length>200) fields.preferred_time='Nhập tối đa 200 ký tự.';
  if (typeof input.message!=='string' || input.message.length>3000 || input.property_id===null && input.message.trim().length<10) fields.message='Nhập nhu cầu từ 10 đến 3.000 ký tự khi chưa chọn sản phẩm.';
  const consent=input.consent as Record<string,unknown> | undefined;
  if (!consent || typeof consent!=='object' || Array.isArray(consent) || Object.keys(consent).length!==5 || ['contact','call','ai','transcript','recording'].some(key=>typeof consent[key]!=='boolean')) fields.consent='Chọn rõ các mục đồng ý sử dụng dữ liệu.';
  else if (!consent.contact) fields.consent='Cần đồng ý sử dụng thông tin để tiếp nhận yêu cầu tư vấn.';
  else if (input.channel==='Phone' && !consent.call) fields.channel='Để chọn điện thoại, hãy đồng ý nhận cuộc gọi; bạn cũng có thể chọn email.';
  const data={ property_id:input.property_id,name:typeof input.name==='string' ? input.name.trim():'',phone,country,channel:input.channel,preferred_time:input.preferred_time,message:typeof input.message==='string' ? input.message.trim():'',consent };
  return { data,key:input.request_key,fields };
}
