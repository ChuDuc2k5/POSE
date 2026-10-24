import { WebRequest as NextRequest } from '../../common/http.js';
import { catalogAdmin, catalogDatabaseError, catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { uuidPattern } from '../../common/catalog.js';
import { telephonyConfigured } from '../../common/telephony.js';
import { campaignErrors, filterErrors } from './validation.js';
import { conversation, scriptErrors, type ScriptContent } from './script.js';

export function campaignDatabaseError(error:{code?:string;message?:string;details?:string}) {
 if(error.message?.includes('PREFLIGHT_FAILED')){
  let missing:unknown=[];try{missing=JSON.parse(error.details || '[]');}catch{}
  return catalogJson({code:'PREFLIGHT_FAILED',message:'Chưa đủ điều kiện vận hành chiến dịch.',missing},400);
 }
 if(error.code==='22023')return catalogJson({code:error.message || 'INVALID_INPUT',message:'Kiểm tra cấu hình, trạng thái và lý do thay đổi.',details:error.details},400);
 return catalogDatabaseError(error);
}
const unavailable=()=>catalogError('CAMPAIGN_UNAVAILABLE','Không thể xử lý chiến dịch. Vui lòng thử lại.',503);
export async function campaignRoute(request:NextRequest,path:string[]=[],scheduler?:()=>object) {
 try {
  const mutate=request.method!=='GET',access=await catalogAdmin(mutate ? request:undefined);if(access.error)return access.error;
  const client=access.client;
  const rpc=async(name:string,args:Record<string,unknown>,status=200)=>{const r=await client.rpc(name,args);return r.error ? campaignDatabaseError(r.error):catalogJson({item:r.data},status);};
  if(!mutate){
   if(path.length===1 && path[0]==='scheduler' && scheduler)return catalogJson(scheduler());
   if(!path.length){
    const search=request.nextUrl.searchParams.get('search') || '',page=Number(request.nextUrl.searchParams.get('page') || 1);
    if(search.length>160 || !Number.isSafeInteger(page) || page<1 || page>10000)return catalogError('INVALID_INPUT','Từ khóa hoặc trang không hợp lệ.',400);
    let q=client.from('campaigns').select('*',{count:'exact'});
    if(search)q=q.ilike('name',`%${search.replace(/[\\%_]/g,'\\$&')}%`);
    const r=await q.order('updated_at',{ascending:false}).order('id').range((page-1)*20,page*20-1);
    return r.error ? campaignDatabaseError(r.error):catalogJson({items:r.data,total:r.count,page});
   }
   if(path[0]==='scripts' && path.length===1){
    const [s,v]=await Promise.all([client.from('call_scripts').select('*').order('created_at',{ascending:false}),client.from('call_script_versions').select('*').order('version_no',{ascending:false})]);
    return s.error || v.error ? campaignDatabaseError(s.error || v.error!):catalogJson({scripts:s.data,versions:v.data});
   }
   if(!uuidPattern.test(path[0]))return catalogError('NOT_FOUND','Không tìm thấy chiến dịch.',404);
   if(path.length===2 && path[1]==='progress')return rpc('pose_campaign_progress',{p_campaign:path[0]});
   if(path.length===2 && path[1]==='preflight')return rpc('pose_campaign_preflight',{p_campaign:path[0],p_provider_ready:telephonyConfigured()});
   if(path.length===1){
    const r=await client.from('campaigns').select('*').eq('id',path[0]).maybeSingle();
    if(r.error)return campaignDatabaseError(r.error);if(!r.data)return catalogError('NOT_FOUND','Không tìm thấy chiến dịch.',404);
    return catalogJson({item:r.data,provider_ready:telephonyConfigured()});
   }
   return catalogError('NOT_FOUND','Không tìm thấy dữ liệu.',404);
  }
  const parsed=await catalogInput(request);if(parsed.error)return parsed.error;const i=parsed.input;
  const invalid=(fields:Record<string,string>)=>catalogError('VALIDATION_FAILED','Kiểm tra thông tin trước khi lưu.',400,fields);
  const only=(keys:string[])=>Object.keys(i).every(k=>keys.includes(k));
  if(!path.length && request.method==='POST' || path.length===1 && uuidPattern.test(path[0]) && request.method==='PATCH'){
   const errors=campaignErrors(i,!path.length);if(Object.keys(errors).length)return invalid(errors);
   const {version,reason='',...data}=i;
   return rpc('pose_save_campaign',{p_id:path[0] || null,p_version:version,p_data:data,p_reason:reason},path.length ? 200:201);
  }
  if(request.method!=='POST')return catalogError('METHOD_NOT_ALLOWED','Thao tác không hợp lệ.',405);
  if(path[0]==='scripts' && path.length===1){
   if(!only(['script_id','name']) || typeof i.name!=='string' || i.name.trim().length<2 || i.name.length>160 || i.script_id!=null && (typeof i.script_id!=='string' || !uuidPattern.test(i.script_id)))return invalid({name:'Tên kịch bản cần 2–160 ký tự.'});
   return rpc('pose_save_call_script',{p_script:i.script_id || null,p_name:i.name});
  }
  if(path[0]==='scripts' && path.length===3 && uuidPattern.test(path[1]) && path[2]==='versions'){
   const errors=scriptErrors(i.content);
   if(!only(['version_id','content']) || i.version_id!=null && (typeof i.version_id!=='string' || !uuidPattern.test(i.version_id)))errors.version='Phiên bản không hợp lệ.';
   if(Object.keys(errors).length)return invalid(errors);
   return rpc('pose_save_script_version',{p_script:path[1],p_version_id:i.version_id || null,p_content:i.content});
  }
  if(path[0]==='versions' && path.length===3 && uuidPattern.test(path[1]) && ['publish','clone','preview'].includes(path[2])){
   if(Object.keys(i).length)return invalid({input:'Không gửi thêm dữ liệu.'});
   if(path[2]==='preview'){
    const r=await client.from('call_script_versions').select('content').eq('id',path[1]).maybeSingle();
    if(r.error)return campaignDatabaseError(r.error);if(!r.data)return catalogError('NOT_FOUND','Không tìm thấy phiên bản.',404);
    const errors=scriptErrors(r.data.content);if(Object.keys(errors).length)return invalid(errors);
    return catalogJson({turns:conversation(r.data.content as ScriptContent)});
   }
   return rpc(path[2]==='publish' ? 'pose_publish_script_version':'pose_new_script_version_from',{p_version_id:path[1]});
  }
  if(uuidPattern.test(path[0]) && path.length===2){
   if(path[1]==='audience-preview' || path[1]==='audience'){
    const errors:Record<string,string>=filterErrors(i.filter);
    if(errors.filter)return catalogError('INVALID_FILTER',errors.filter,400,errors);
    if(!only(path[1]==='audience' ? ['version','filter','reason']:['filter']))errors.input='Trường không hợp lệ.';
    if(path[1]==='audience' && (!Number.isSafeInteger(i.version) || Number(i.version)<0 || i.reason!==undefined && (typeof i.reason!=='string' || i.reason.length>1000)))errors.version='Phiên bản hoặc lý do không hợp lệ.';
    if(Object.keys(errors).length)return invalid(errors);
    return rpc(path[1]==='audience' ? 'pose_set_campaign_audience':'pose_preview_campaign_audience',{p_campaign:path[0],p_filter:i.filter,...(path[1]==='audience' ? {p_version:i.version,p_reason:i.reason || ''}:{})});
   }
   if(path[1]==='action'){
    if(!only(['version','action','reason']) || !Number.isSafeInteger(i.version) || Number(i.version)<0 || !['schedule','start','pause','resume','cancel'].includes(String(i.action)) || i.reason!==undefined && (typeof i.reason!=='string' || i.reason.length>1000) || i.action==='cancel' && String(i.reason || '').trim().length<3)return invalid({action:'Kiểm tra hành động, phiên bản và lý do dừng (ít nhất 3 ký tự).'});
    return rpc('pose_campaign_action',{p_campaign:path[0],p_version:i.version,p_action:i.action,p_reason:i.reason || '',p_provider_ready:telephonyConfigured()});
   }
  }
  return catalogError('NOT_FOUND','Không tìm thấy thao tác.',404);
 }catch{return unavailable();}
}
