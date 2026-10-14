import { createHash, randomUUID } from 'node:crypto';
import { WebRequest as NextRequest, validOrigin } from '../../common/http.js';
import { authenticatedSession, authClient } from '../auth/session.js';
import { systemClient } from '../supabase/supabase.service.js';
import { callConcurrency } from './config.js';
import { catalogDatabaseError, catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { uuidPattern } from '../../common/catalog.js';
import { callingProvider, ProviderRejected, type CallEvent } from './provider.js';
import { converse, type Conversation, type Script } from './conversation.js';
import type { Evidence } from '../ai/guard.js';
import { complete } from '../ai/llm.js';
import { extractNeeds } from '../ai/extraction.js';
import { scoreNeeds } from '../ai/lead-scoring.js';
const unavailable=()=>catalogError('CALLS_UNAVAILABLE','Không thể xử lý cuộc gọi. Vui lòng thử lại.',503);
export async function callAccess(request?:NextRequest,admin=false){
 if(request&&!validOrigin(request))return {error:catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403)} as const;
 const session=await authenticatedSession();if(!session)return {error:catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401)} as const;
 if(!['Admin','Sales'].includes(session.role)||admin&&session.role!=='Admin')return {error:catalogError('FORBIDDEN','Bạn không có quyền truy cập.',403)} as const;
 return {session,client:authClient(session.access)} as const;
}
async function rpc(name:string,args:Record<string,unknown>){const result=await systemClient().rpc(name,args);if(result.error)throw result.error;return result.data;}
async function properties(script:Script&{product_source?:{property_ids:string[]}}):Promise<Evidence[]>{
 const ids=script.product_source?.property_ids||[];if(!ids.length)return [];
 const result=await authClient().from('property_public_catalog').select('id,code,name,price,availability,updated_at,location,property_type').in('id',ids).limit(100);if(result.error)throw result.error;
 return (result.data||[]).map(p=>({...p,price:p.price===null?null:Number(p.price)}));
}
type Notify = (id:string)=>Promise<void>;
const quiet:Notify=async()=>{};
async function dispatchOne(call:Record<string,unknown>,notify:Notify=quiet){
 const provider=callingProvider();let result;
 const current=await rpc('pose_system_call_context',{p_call:call.id});
 if(current.suppressed||current.status==='ENDING')return current;
 try{result={kind:'success',...await provider.dispatch({to:String(call.phone_e164),from:process.env.TELEPHONY_CALLER_ID!,callbackUrl:`${process.env.APP_PUBLIC_URL}/api/webhooks/telephony`,maxSeconds:Number(call.max_seconds),record:false,idempotencyKey:String(call.idempotency_key),metadata:{call_id:call.id}})};}
 catch(error){result=error instanceof ProviderRejected?{kind:'rejected',code:error.code}:{kind:'ambiguous'};}
 const saved=await rpc('pose_system_record_dispatch',{p_call:call.id,p_result:result});
 await notify(String(call.id));
 if(saved.status==='ENDING')try{await provider.hangup(String(call.id));}catch{}
 return saved;
}
export async function dispatchDue(notify:Notify=quiet){
 callingProvider();const callback=new URL(process.env.APP_PUBLIC_URL||'');if(!['http:','https:'].includes(callback.protocol))throw Error('INVALID_CALLBACK');
 const global=callConcurrency(),items=[];
 for(let n=0;n<20;n++){const call=await rpc('pose_system_claim_call_job',{p_worker:randomUUID(),p_lease_seconds:30,p_now:new Date().toISOString(),p_global:global});if(!call)break;await notify(String(call.id));items.push(await dispatchOne(call,notify));}
 return {items};
}
async function recording(callId:string,event:CallEvent){
 if(!event.recording)return;
 const context=await rpc('pose_system_call_context',{p_call:callId});if(context.conversation.consents.Recording!==true||context.recording_status==='Available')return;
 try{
  const media=event.recording;if(!['audio/wav','audio/mpeg','audio/ogg'].includes(media.mime))throw Error('INVALID_MEDIA');
  let bytes:Buffer;
  if(media.bytes)bytes=Buffer.from(media.bytes,'base64');
  else if(media.object_key?.startsWith(`${callId}/`)){
   const stored=await systemClient().storage.from('call-recordings').download(media.object_key);if(stored.error||!stored.data)throw Error('INVALID_MEDIA');bytes=Buffer.from(await stored.data.arrayBuffer());
  }else throw Error('INVALID_MEDIA');
  if(!bytes.length||bytes.length>20971520)throw Error('INVALID_MEDIA');
  const checksum=createHash('sha256').update(bytes).digest('hex');if(checksum!==media.checksum)throw Error('CHECKSUM');const key=`${callId}/${checksum}`;
  const upload=await systemClient().storage.from('call-recordings').upload(key,bytes,{contentType:media.mime,upsert:false});if(upload.error&&upload.error.message!=='The resource already exists')throw upload.error;
  await rpc('pose_system_call_recording',{p_call:callId,p_data:{object_key:key,checksum,size:bytes.length,mime:media.mime}});
 }catch{await rpc('pose_system_call_recording',{p_call:callId,p_data:{failed:true}});}
}
async function processCalls(){
 const work=await rpc('pose_system_call_processing',{p_call:null,p_result:null});
 for(const item of work){
  try{
   const context=await rpc('pose_system_call_context',{p_call:item.call_id}),evidence=await properties(context.script),response=await complete({customer_text:item.customer_text||'',properties:evidence,search_performed:true,tools_complete:true});
   const fields=extractNeeds(response.needs||{},item.customer_text||'');
   const needs=await rpc('pose_system_record_ai_extraction',{p_lead:context.lead_id,p_source_kind:'Call',p_source_id:item.call_id,p_schema:'needs.v1',p_fields:fields,p_idempotency_key:`call-extract:${item.call_id}`});
   await rpc('pose_system_apply_lead_score',{p_lead:context.lead_id,p_result:{...scoreNeeds(needs,evidence,true),source_kind:'Call',source_id:item.call_id},p_idempotency_key:`call-score:${item.call_id}`});
   await rpc('pose_system_call_processing',{p_call:item.call_id,p_result:'Done'});
  }catch{await rpc('pose_system_call_processing',{p_call:item.call_id,p_result:'Failed'});}
 }
}
async function apply(event:CallEvent,notify:Notify=quiet){
 const applied=await rpc('pose_system_apply_call_event',{p_event:event});
 if(applied.ignored)return applied;
 await notify(applied.call_id);
 if(applied.duplicate&&event.type==='answered'){
  const saved=await rpc('pose_system_call_response',{p_call:applied.call_id,p_event:event.event_id});if(saved)return {...applied,...saved};
 }else if(applied.duplicate){await recording(applied.call_id,event);await processCalls();await notify(applied.call_id);return applied;}
 let response={};
 if(event.type==='answered'){
  for(let attempt=0;attempt<3;attempt++){
   const context=await rpc('pose_system_call_context',{p_call:applied.call_id});
   if(context.status!=='ANSWERED')break;
   const result=await converse(context.conversation as Conversation,context.script,event.utterance||{text:''},await properties(context.script),context.lead);
   try{response=await rpc('pose_system_call_conversation',{p_call:applied.call_id,p_event:event.event_id,p_version:context.conversation_version,p_input:event.utterance?.text||'',p_result:result});
    if(result.state.end_reason){await rpc('pose_system_stop_call',{p_call:applied.call_id,p_reason:result.state.end_reason});await notify(applied.call_id);
     if(result.optOut||result.state.end_reason==='NO_AI_VOICE_CONSENT'){const live=await systemClient().from('calls').select('id').eq('phone_e164',context.phone_e164).eq('status','ENDING');for(const call of live.data||[])await notify(call.id);}
     await callingProvider().hangup(event.provider_call_id);}break;
   }catch(error){if((error as {code:string}).code!=='40001')throw error;}
  }
 }
 if(applied.terminal){await recording(applied.call_id,event);await processCalls();}
 await notify(applied.call_id);
 return {...applied,...response};
}
export async function webhook(request:NextRequest,notify:Notify=quiet){
 const raw=Buffer.from(await request.arrayBuffer());if(raw.length>30000000)return catalogError('TOO_LARGE','Dữ liệu quá lớn.',413);
 let event:CallEvent;try{event=callingProvider().verifyWebhook(raw,request.headers,Date.now());}catch{return catalogError('INVALID_SIGNATURE','Chữ ký không hợp lệ hoặc đã hết hạn.',401);}
 try{return catalogJson(await apply(event,notify));}catch{return unavailable();}
}
export async function reconcileDue(notify:Notify=quiet){
 const provider=callingProvider(),now=Date.now(),calls=await rpc('pose_system_call_reconcile_list',{p_now:new Date(now).toISOString()}),items=[];
 for(const call of calls){
  if(call.call_type==='MOCK_CALL'&&!call.phone_e164){if(Date.parse(call.started_at)+300000<now){await rpc('pose_system_voice_finish',{p_call:call.id,p_reason:'MAX_DURATION'});await notify(call.id);}continue;}
  if(call.status==='ANSWERED'&&Date.parse(call.answered_at)+(call.max_seconds+30)*1000<now){await rpc('pose_system_stop_call',{p_call:call.id,p_reason:'MAX_DURATION'});await notify(call.id);await provider.hangup(call.provider_call_id||call.id);}
  if(call.status==='CALLING'&&!call.provider_call_id){await rpc('pose_system_record_dispatch',{p_call:call.id,p_result:{kind:'ambiguous'}});await notify(call.id);}
  const event=await provider.fetchStatus(call.provider_call_id||call.id);if(event)items.push(await apply({...event,event_id:`reconcile:${call.id}:${event.type}`},notify));
 }
 await processCalls();return {items};
}
export async function stop(request:NextRequest,id:string,notify:Notify=quiet){
 try{const access=await callAccess(request);if(access.error)return access.error;const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
  if(!uuidPattern.test(id)||typeof parsed.input.reason!=='string')return catalogError('INVALID_INPUT','Nhập lý do dừng.',400);
  const result=await access.client.rpc('pose_stop_call',{p_call:id,p_reason:parsed.input.reason});if(result.error)return catalogDatabaseError(result.error);
  await notify(id);
  if(result.data.call_type==='MOCK_CALL'&&!result.data.phone_e164&&result.data.status==='ENDING'){const item=await rpc('pose_system_voice_finish',{p_call:id,p_reason:parsed.input.reason});await notify(id);return catalogJson({item});}
  if(result.data.status==='ENDING')try{await callingProvider().hangup(result.data.provider_call_id||id);}catch{}
  return catalogJson({item:result.data});
 }catch{return unavailable();}
}
export async function optOut(request:NextRequest,notify:Notify=quiet){
 try{const access=await callAccess(request);if(access.error)return access.error;const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
  if(typeof parsed.input.phone!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(parsed.input.phone)||typeof parsed.input.reason!=='string')return catalogError('INVALID_INPUT','Nhập số E.164 và lý do.',400);
  const result=await access.client.rpc('pose_call_opt_out',{p_phone:parsed.input.phone,p_reason:parsed.input.reason});if(result.error)return catalogDatabaseError(result.error);
  for(const call of result.data){await notify(call.id);}
  for(const call of result.data)try{await callingProvider().hangup(call.provider_call_id||call.id);}catch{}
  return catalogJson({items:result.data});
 }catch{return unavailable();}
}
export async function evidence(request:NextRequest,id:string,kind:string){
 try{const access=await callAccess();if(access.error)return access.error;if(!uuidPattern.test(id))return catalogError('NOT_FOUND','Không tìm thấy cuộc gọi.',404);
  const result=await access.client.rpc('pose_call_evidence',{p_call:id,p_kind:kind});if(result.error)return catalogDatabaseError(result.error);
  if(kind==='recording'&&result.data.status==='Available'&&result.data.item){
   const signed=await access.client.storage.from('call-recordings').createSignedUrl(result.data.item.recording_url,300);if(signed.error)return unavailable();return catalogJson({status:'Available',url:signed.data.signedUrl,expires_in:300});
  }return catalogJson(result.data);
 }catch{return unavailable();}
}
export async function testCall(request:NextRequest,notify:Notify=quiet){
 try{const access=await callAccess(request,true);if(access.error)return access.error;callingProvider();const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
  if(!uuidPattern.test(String(parsed.input.lead_id))||!uuidPattern.test(String(parsed.input.script_version_id)))return catalogError('INVALID_INPUT','Chọn khách hàng và kịch bản đã công bố.',400);
  const result=await access.client.rpc('pose_test_call',{p_lead:parsed.input.lead_id,p_script:parsed.input.script_version_id});if(result.error)return catalogDatabaseError(result.error);await notify(result.data.id);return catalogJson({item:await dispatchOne(result.data,notify)});
 }catch{return unavailable();}
}
