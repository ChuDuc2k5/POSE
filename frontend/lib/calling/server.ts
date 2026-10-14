import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { authenticatedSession, authClient } from '../next-api-bridge';
import { systemClient, cronAuthorized } from '../next-api-bridge';
import { catalogDatabaseError, catalogError, catalogInput, catalogJson } from '../next-api-bridge';
import { uuidPattern } from '../catalog';
import { callingProvider, ProviderRejected, type CallEvent } from './provider';
import { converse, type Conversation, type Script } from './conversation';
import type { Evidence } from '../../../backend/src/modules/ai/guard';
import { complete } from '../../../backend/src/modules/ai/llm';
import { extractNeeds } from '../../../backend/src/modules/ai/extraction';
import { scoreNeeds } from '../../../backend/src/modules/ai/lead-scoring';
const unavailable=()=>catalogError('CALLS_UNAVAILABLE','Không thể xử lý cuộc gọi. Vui lòng thử lại.',503);
export async function callAccess(request?:NextRequest,admin=false){
 if(request&&request.headers.get('origin')!==request.nextUrl.origin)return {error:catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403)} as const;
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
async function dispatchOne(call:Record<string,unknown>){
 const provider=callingProvider();let result;
 const current=await rpc('pose_system_call_context',{p_call:call.id});
 if(current.suppressed||current.status==='ENDING')return current;
 try{result={kind:'success',...await provider.dispatch({to:String(call.phone_e164),from:process.env.TELEPHONY_CALLER_ID!,callbackUrl:`${process.env.APP_PUBLIC_URL}/api/webhooks/telephony`,maxSeconds:Number(call.max_seconds),record:false,idempotencyKey:String(call.idempotency_key),metadata:{call_id:call.id}})};}
 catch(error){result=error instanceof ProviderRejected?{kind:'rejected',code:error.code}:{kind:'ambiguous'};}
 const saved=await rpc('pose_system_record_dispatch',{p_call:call.id,p_result:result});
 if(saved.status==='ENDING')try{await provider.hangup(String(call.id));}catch{}
 return saved;
}
export async function dispatch(request:NextRequest){
 if(!cronAuthorized(request.headers.get('authorization')))return catalogError('UNAUTHORIZED','Không có quyền thực thi.',401);
 try{
  callingProvider();const callback=new URL(process.env.APP_PUBLIC_URL||'');if(!['http:','https:'].includes(callback.protocol))throw Error();
  const global=Math.min(2,Math.max(1,Number(process.env.TELEPHONY_MAX_CONCURRENCY)||2)),items=[];
  for(let n=0;n<20;n++){const call=await rpc('pose_system_claim_call_job',{p_worker:randomUUID(),p_lease_seconds:30,p_now:new Date().toISOString(),p_global:global});if(!call)break;items.push(await dispatchOne(call));}
  return catalogJson({items});
 }catch{return unavailable();}
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
async function apply(event:CallEvent){
 const applied=await rpc('pose_system_apply_call_event',{p_event:event});
 if(applied.ignored)return applied;
 if(applied.duplicate&&event.type==='answered'){
  const saved=await rpc('pose_system_call_response',{p_call:applied.call_id,p_event:event.event_id});if(saved)return {...applied,...saved};
 }else if(applied.duplicate){await recording(applied.call_id,event);await processCalls();return applied;}
 let response={};
 if(event.type==='answered'){
  for(let attempt=0;attempt<3;attempt++){
   const context=await rpc('pose_system_call_context',{p_call:applied.call_id});
   if(context.status!=='ANSWERED')break;
   const result=await converse(context.conversation as Conversation,context.script,event.utterance||{text:''},await properties(context.script),context.lead);
   try{response=await rpc('pose_system_call_conversation',{p_call:applied.call_id,p_event:event.event_id,p_version:context.conversation_version,p_input:event.utterance?.text||'',p_result:result});
    if(result.state.end_reason){await rpc('pose_system_stop_call',{p_call:applied.call_id,p_reason:result.state.end_reason});await callingProvider().hangup(event.provider_call_id);}break;
   }catch(error){if((error as {code:string}).code!=='40001')throw error;}
  }
 }
 if(applied.terminal){await recording(applied.call_id,event);await processCalls();}
 return {...applied,...response};
}
export async function webhook(request:NextRequest){
 const raw=await request.text();if(raw.length>30000000)return catalogError('TOO_LARGE','Dữ liệu quá lớn.',413);
 let event:CallEvent;try{event=callingProvider().verifyWebhook(raw,request.headers,Date.now());}catch{return catalogError('INVALID_SIGNATURE','Chữ ký không hợp lệ hoặc đã hết hạn.',401);}
 try{return catalogJson(await apply(event));}catch{return unavailable();}
}
export async function reconcile(request:NextRequest){
 if(!cronAuthorized(request.headers.get('authorization')))return catalogError('UNAUTHORIZED','Không có quyền thực thi.',401);
 try{
  const provider=callingProvider(),now=Date.now(),calls=await rpc('pose_system_call_reconcile_list',{p_now:new Date(now).toISOString()}),items=[];
  for(const call of calls){
   if(call.status==='ANSWERED'&&Date.parse(call.answered_at)+(call.max_seconds+30)*1000<now){await rpc('pose_system_stop_call',{p_call:call.id,p_reason:'MAX_DURATION'});await provider.hangup(call.provider_call_id||call.id);}
   if(call.status==='CALLING'&&!call.provider_call_id){await rpc('pose_system_record_dispatch',{p_call:call.id,p_result:{kind:'ambiguous'}});}
   const event=await provider.fetchStatus(call.provider_call_id||call.id);if(event)items.push(await apply({...event,event_id:`reconcile:${call.id}:${event.type}`}));
  }
  await processCalls();return catalogJson({items});
 }catch{return unavailable();}
}
export async function stop(request:NextRequest,id:string){
 try{const access=await callAccess(request);if(access.error)return access.error;const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
  if(!uuidPattern.test(id)||typeof parsed.input.reason!=='string')return catalogError('INVALID_INPUT','Nhập lý do dừng.',400);
  const result=await access.client.rpc('pose_stop_call',{p_call:id,p_reason:parsed.input.reason});if(result.error)return catalogDatabaseError(result.error);
  if(result.data.status==='ENDING')try{await callingProvider().hangup(result.data.provider_call_id||id);}catch{}
  return catalogJson({item:result.data});
 }catch{return unavailable();}
}
export async function optOut(request:NextRequest){
 try{const access=await callAccess(request);if(access.error)return access.error;const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
  if(typeof parsed.input.phone!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(parsed.input.phone)||typeof parsed.input.reason!=='string')return catalogError('INVALID_INPUT','Nhập số E.164 và lý do.',400);
  const result=await access.client.rpc('pose_call_opt_out',{p_phone:parsed.input.phone,p_reason:parsed.input.reason});if(result.error)return catalogDatabaseError(result.error);
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
export async function testCall(request:NextRequest){
 try{const access=await callAccess(request,true);if(access.error)return access.error;callingProvider();const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
  if(!uuidPattern.test(String(parsed.input.lead_id))||!uuidPattern.test(String(parsed.input.script_version_id)))return catalogError('INVALID_INPUT','Chọn khách hàng và kịch bản đã công bố.',400);
  const result=await access.client.rpc('pose_test_call',{p_lead:parsed.input.lead_id,p_script:parsed.input.script_version_id});if(result.error)return catalogDatabaseError(result.error);return catalogJson({item:await dispatchOne(result.data)});
 }catch{return unavailable();}
}
