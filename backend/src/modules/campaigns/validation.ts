import { uuidPattern } from '../../common/catalog.ts';
import { object } from './script.ts';
export const campaignFields=['name','description','objective','property_ids','start_time','end_time','timezone','window_start','window_end','weekdays','max_concurrent_calls','max_call_seconds','max_attempts','retry_after_hours','daily_call_limit','budget_limit_vnd','cost_reserve_per_call_vnd','script_version_id'];
export const labels:Record<string,string>={name:'Tên chiến dịch',description:'Mô tả',objective:'Mục tiêu',timezone:'Múi giờ IANA',start_time:'Bắt đầu',end_time:'Kết thúc',window_start:'Giờ gọi từ',window_end:'Giờ gọi đến',max_concurrent_calls:'Cuộc gọi đồng thời',max_call_seconds:'Thời lượng tối đa (giây)',max_attempts:'Số lần thử tối đa',retry_after_hours:'Khoảng cách thử lại (giờ)',daily_call_limit:'Hạn mức (cuộc/ngày)',budget_limit_vnd:'Ngân sách (VND)',cost_reserve_per_call_vnd:'Dự phòng mỗi cuộc (VND)'};
export function campaignErrors(v:Record<string,unknown>,create=false) {
 const e:Record<string,string>={};
 if(Object.keys(v).some(k=>![...campaignFields,'version','reason'].includes(k)))e.input='Thông tin có trường không hợp lệ.';
 if(!Number.isSafeInteger(v.version) || Number(v.version)<0 || create && v.version!==0)e.version='Phiên bản không hợp lệ.';
 if(v.reason!==undefined && (typeof v.reason!=='string' || v.reason.length>1000))e.reason='Lý do tối đa 1.000 ký tự.';
 if(create && v.name===undefined || v.name!==undefined && (typeof v.name!=='string' || v.name.trim().length<2 || v.name.length>160))e.name='Tên cần 2–160 ký tự.';
 for(const k of ['description','objective'])if(v[k]!==undefined && (typeof v[k]!=='string' || (v[k] as string).length>2000))e[k]='Tối đa 2.000 ký tự.';
 for(const [k,min,max] of [['max_concurrent_calls',1,2],['max_call_seconds',30,300],['max_attempts',1,3],['retry_after_hours',24,2147483647],['daily_call_limit',1,2147483647]] as const)if(v[k]!==undefined && !(k==='daily_call_limit' && v[k]===null) && (!Number.isSafeInteger(v[k]) || Number(v[k])<min || Number(v[k])>max))e[k]=`${labels[k]}: từ ${min} đến ${max}.`;
 for(const k of ['budget_limit_vnd','cost_reserve_per_call_vnd'])if(v[k]!==undefined && v[k]!==null && (typeof v[k]!=='number' || !Number.isFinite(v[k]) || Number(v[k])<=0 || Number(v[k])>1e16))e[k]='Nhập số tiền VND lớn hơn 0.';
 if(v.timezone!==undefined){try{if(typeof v.timezone!=='string')throw Error();new Intl.DateTimeFormat('vi',{timeZone:v.timezone});}catch{e.timezone='Múi giờ IANA không hợp lệ.';}}
 for(const k of ['window_start','window_end'])if(v[k]!==undefined && (typeof v[k]!=='string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v[k] as string)))e[k]='Nhập giờ HH:mm.';
 if(typeof v.window_start==='string' && typeof v.window_end==='string' && v.window_end<=v.window_start)e.window_end='Giờ kết thúc phải sau giờ bắt đầu.';
 for(const k of ['start_time','end_time'])if(v[k]!==undefined && v[k]!==null && (typeof v[k]!=='string' || !/T.*(Z|[+-]\d\d:\d\d)$/.test(v[k] as string) || !Number.isFinite(Date.parse(v[k] as string))))e[k]='Thời gian cần kèm múi giờ.';
 if(typeof v.start_time==='string' && typeof v.end_time==='string' && Date.parse(v.end_time)<=Date.parse(v.start_time))e.end_time='Kết thúc phải sau bắt đầu.';
 if(v.weekdays!==undefined && (!Array.isArray(v.weekdays) || !v.weekdays.length || v.weekdays.length>7 || v.weekdays.some(x=>!Number.isInteger(x) || x<0 || x>6)))e.weekdays='Chọn ngày gọi từ Chủ nhật (0) đến Thứ bảy (6).';
 if(v.property_ids!==undefined && (!Array.isArray(v.property_ids) || v.property_ids.length>500 || v.property_ids.some(x=>typeof x!=='string' || !uuidPattern.test(x))))e.property_ids='Chọn tối đa 500 sản phẩm đã công bố.';
 if(v.script_version_id!==undefined && v.script_version_id!==null && (typeof v.script_version_id!=='string' || !uuidPattern.test(v.script_version_id)))e.script_version_id='Chọn phiên bản đã công bố.';
 return e;
}
export function filterErrors(v:unknown):Record<string,string> {
 if(!object(v))return {filter:'Bộ lọc không hợp lệ.'};
 if(Object.keys(v).some(k=>!['temperature','lead_status','source','created_from','created_to','lead_ids','match_campaign_products','min_match','needs_location','needs_property_type','timeline','interacted_days','exclude_called_days','confirmed_needs_only'].includes(k)))return {filter:'Bộ lọc có trường không hợp lệ.'};
 const choices:Record<string,string[]>={temperature:['HOT','WARM','COLD','UNRATED'],lead_status:['NEW','CONTACTED','QUALIFIED','FOLLOW_UP','CONVERTED','LOST'],source:['Inquiry','WebChat','Call','Manual','Import']};
 for(const k of ['temperature','lead_status','source','lead_ids'])if(v[k]!==undefined && (!Array.isArray(v[k]) || v[k].length>500 || v[k].some(x=>typeof x!=='string' || (k==='lead_ids' ? !uuidPattern.test(x):!choices[k].includes(x)))))return {filter:'Kiểm tra bộ lọc; tối đa 500 Lead.'};
 for(const k of ['needs_location','needs_property_type','timeline'])if(v[k]!==undefined && (!Array.isArray(v[k]) || v[k].length>500 || v[k].some(x=>typeof x!=='string')))return {filter:'Bộ lọc mới không hợp lệ.'};
 if(v.match_campaign_products!==undefined && typeof v.match_campaign_products!=='boolean' || v.confirmed_needs_only!==undefined && typeof v.confirmed_needs_only!=='boolean')return {filter:'Bộ lọc mới không hợp lệ.'};
 if(v.min_match!==undefined && (!Number.isInteger(v.min_match) || Number(v.min_match)<0 || Number(v.min_match)>85))return {filter:'Điểm phù hợp phải từ 0 đến 85.'};
 if(v.interacted_days!==undefined && (!Number.isInteger(v.interacted_days) || Number(v.interacted_days)<1 || Number(v.interacted_days)>365) || v.exclude_called_days!==undefined && (!Number.isInteger(v.exclude_called_days) || Number(v.exclude_called_days)<1 || Number(v.exclude_called_days)>90))return {filter:'Khoảng ngày không hợp lệ.'};
 for(const k of ['created_from','created_to'])if(v[k]!==undefined && (typeof v[k]!=='string' || !Number.isFinite(Date.parse(v[k] as string))))return {filter:'Ngày tạo không hợp lệ.'};
 if(typeof v.created_from==='string' && typeof v.created_to==='string' && Date.parse(v.created_from)>Date.parse(v.created_to))return {filter:'Khoảng ngày tạo không hợp lệ.'};
 return {};
}
