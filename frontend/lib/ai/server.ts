import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { authenticatedSession, authClient, consumeAttempt } from '../auth-server';
import { systemClient } from '../system-server';
import { catalogDatabaseError, catalogError, catalogInput, catalogJson } from '../catalog-server';
import { searchParameters } from '../discovery';
import { uuidPattern } from '../catalog';
import { extractNeeds, object } from './extraction';
import { scoreNeeds } from './lead-scoring';
import { complete } from './llm';
import { disclosure, evidenceReason, evidenceReply, GUARD_VERSION, injection, outputReason, safeReply, stripPhones, toolAllowed, type Evidence } from './guard';

export const unavailable=()=>catalogJson({code:'AI_UNAVAILABLE',message:'Trợ lý AI hiện chưa khả dụng. Vui lòng thử lại hoặc gửi yêu cầu tư vấn.',retry:true,inquiry_url:'/customer/inquiries/new'},503);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
async function identity(request:NextRequest) {
  const session=await authenticatedSession();
  if(session && session.role!=='User')return {error:catalogError('FORBIDDEN','Hội thoại dành cho khách hàng.',403)} as const;
  const cookie=request.cookies.get('pose-ai-session')?.value;
  const token=cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie:randomBytes(32).toString('hex');
  return {session,token,guestHash:session ? null:hash(token),client:session ? authClient(session.access):null} as const;
}
async function readSession(id:string, who:Awaited<ReturnType<typeof identity>>) {
  if(who.error)return {data:null,error:{code:'42501'}};
  return who.client ? who.client.rpc('pose_ai_read_session',{p_session:id}):systemClient().rpc('pose_system_ai_read_guest',{p_session:id,p_hash:who.guestHash});
}
async function retrieve(filters:Record<string,unknown>,context:string|null):Promise<Evidence[]> {
  const params=new URLSearchParams(Object.entries(filters).map(([k,v])=>[k,String(v)]));
  const parsed=searchParameters(params);if(Object.keys(parsed.fields).length)throw new Error('INVALID_FILTER');
  let query=authClient().from('property_public_catalog').select('id,code,name,price,availability,updated_at,location,property_type');
  if(context)query=query.eq('id',context);
  if(filters.location)query=query.ilike('location',`%${String(filters.location).replace(/[%_\\]/g,'\\$&')}%`);
  if(filters.type)query=query.eq('property_type',filters.type);
  if(filters.minPrice!==undefined)query=query.gte('price',filters.minPrice);
  if(filters.maxPrice!==undefined)query=query.lte('price',filters.maxPrice);
  const result=await query.order('updated_at',{ascending:false}).order('id').limit(5);
  if(result.error)throw new Error('RETRIEVAL_UNAVAILABLE');
  return (result.data || []).map(p=>({...p,price:p.price===null ? null:Number(p.price)})) as Evidence[];
}
export async function chat(request:NextRequest) {
  try {
    if(request.headers.get('origin')!==request.nextUrl.origin)return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
    const input=parsed.input;
    if(Object.keys(input).some(k=>!['session_id','message','history','store_transcript','property_id','filters'].includes(k)) || typeof input.message!=='string' || !input.message.trim() || input.message.length>2000 || typeof input.store_transcript!=='boolean' || input.session_id!==undefined && (typeof input.session_id!=='string' || !uuidPattern.test(input.session_id)) || input.property_id!==undefined && input.property_id!==null && (typeof input.property_id!=='string' || !uuidPattern.test(input.property_id)))return catalogError('INVALID_INPUT','Tin nhắn tối đa 2.000 ký tự; lựa chọn lưu hội thoại phải rõ ràng.',400);
    const history=input.history ?? [];
    if(!Array.isArray(history) || history.length>10 || history.some(turn=>!object(turn) || Object.keys(turn).some(k=>!['role','content'].includes(k)) || !['user','assistant'].includes(turn.role as string) || typeof turn.content!=='string' || turn.content.length>8000))return catalogError('INVALID_HISTORY','Chỉ gửi tối đa 10 lượt hội thoại.',400);
    const filters=input.filters ?? {};
    if(!object(filters) || !toolAllowed({name:'search_properties',arguments:filters}))return catalogError('INVALID_FILTER','Bộ lọc không hợp lệ.',400);
    const who=await identity(request);if(who.error)return who.error;
    const id=typeof input.session_id==='string' ? input.session_id:randomUUID();
    let count=0, scoring:{needs:Record<string,{value:unknown;evidence?:string;confirmed_by?:unknown}>;verified:boolean;version:number}|null=null;
    if(input.session_id){const prior=await readSession(id,who);if(prior.error)return catalogDatabaseError(prior.error);count=prior.data.message_count;scoring=prior.data.scoring;if(prior.data.store_transcript!==input.store_transcript || prior.data.status==='Closed')return catalogError('SESSION_CONFLICT','Lựa chọn lưu áp dụng cho cả phiên; hãy bắt đầu phiên mới để thay đổi.',409);}
    else if(who.client){const context=await who.client.rpc('pose_ai_score_context');if(context.error)return catalogDatabaseError(context.error);scoring=context.data;}
    if(!consumeAttempt('ai-ip',request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local',100) || !consumeAttempt('ai-session',id,40))return catalogError('RATE_LIMIT','Bạn đã gửi nhiều tin nhắn. Vui lòng thử lại sau.',429);
    if(!process.env.AI_API_URL || !process.env.AI_API_KEY || !process.env.AI_MODEL)return unavailable();
    const guest=!who.session, source=guest ? stripPhones(input.message):input.message;
    const sanitizedHistory=history.map(turn=>({role:turn.role,content:guest ? stripPhones(turn.content):turn.content}));
    let items=await retrieve(filters,input.property_id as string|null || null);
    const actions:{tool:string;args_hash:string;decision:string;reason:string;rule_version:string}[]=[];
    const log=(tool:string,args:unknown,reason:string|null)=>actions.push({tool,args_hash:hash(JSON.stringify(args) || 'null'),decision:reason ? 'blocked':'allowed',reason:reason || 'VALIDATED',rule_version:GUARD_VERSION});
    const safeEvidence=(list:Evidence[])=>list.filter(item=>{const reason=evidenceReason(item);if(reason)log('retrieval',{id:item.id},reason);return !reason;});
    items=safeEvidence(items);
    let reply:string, fields={}, proposals:unknown[]=[];
    if(injection(input.message) || sanitizedHistory.some(t=>injection(t.content))) { log('input',source,'PROMPT_INJECTION');reply=safeReply;items=[]; }
    else {
      let result=await complete({customer_text:source,history:sanitizedHistory,properties:items});
      fields=extractNeeds(result.needs || {},source);
      const tools=result.tool_calls || [];
      const invalid=tools.filter(t=>!toolAllowed(t));
      if(invalid.length){for(const t of invalid)log(object(t) && typeof t.name==='string' ? t.name:'invalid_tool',t,'TOOL_NOT_ALLOWED_OR_INVALID');reply=safeReply;items=[];fields={};}
      else {
        for(const t of tools){if(!toolAllowed(t))continue;if(t.name==='search_properties'){log(t.name,t.arguments,null);items=safeEvidence(await retrieve(t.arguments,null));}else if(guest){log(t.name,t.arguments,'SIGN_IN_REQUIRED');}else{log(t.name,t.arguments,null);proposals.push(t);}}
        if(tools.some(t=>toolAllowed(t) && t.name==='search_properties')) {
          result=await complete({customer_text:source,history:sanitizedHistory,properties:items,tools_complete:true});
          fields=extractNeeds(result.needs || {},source);
          if((result.tool_calls || []).length){for(const t of result.tool_calls!)log('recursive_tool',t,'TOOL_RECURSION_BLOCKED');reply=safeReply;items=[];fields={};proposals=[];}
          else reply=result.reply;
        }else reply=result.reply;
        const reason=outputReason(reply!,items);if(reason){log('output',reply!,reason);reply=safeReply;fields={};proposals=[];}
      }
    }
    if(guest && source!==input.message)reply+=' Vui lòng đăng nhập hoặc dùng biểu mẫu tư vấn để chia sẻ thông tin liên hệ.';
    if(items.length){
      const refreshed=await authClient().from('property_public_catalog').select('id,code,name,price,availability,updated_at,location,property_type').in('id',items.map(p=>p.id)).limit(5);
      if(refreshed.error)throw new Error('RETRIEVAL_UNAVAILABLE');
      items=safeEvidence((refreshed.data || []).map(p=>({...p,price:p.price===null ? null:Number(p.price)})) as Evidence[]);
    }
    reply=(count===0 ? `${disclosure}\n`:'')+reply+(items.length ? `\n${evidenceReply(items)}`:actions.some(a=>a.decision==='blocked') ? '':`\n${evidenceReply([])}`);
    const acceptedFields=guest || !input.store_transcript ? {}:fields;
    const merged:Record<string,{value:unknown;evidence?:string;confirmed_by?:unknown}>|null=scoring ? {...scoring.needs,...acceptedFields}:null;
    if(merged && scoring)for(const [k,f] of Object.entries(scoring.needs))if(object(f) && Object.hasOwn(f,'confirmed_by'))merged[k]=f;
    const committed=await systemClient().rpc('pose_system_ai_commit_chat',{p_session:id,p_user:who.session?.user.id || null,p_hash:who.guestHash,p_store:input.store_transcript,p_message:source,p_reply:reply,p_sources:items,p_actions:actions,p_fields:acceptedFields,p_score:merged && scoring ? {...scoreNeeds(merged,items,scoring.verified),needs_version:scoring.version}:null});
    if(committed.error)return catalogDatabaseError(committed.error);
    if(guest)(await cookies()).set('pose-ai-session',who.token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:86400*7});
    return catalogJson({session:committed.data,reply,sources:items,blocked:actions.some(a=>a.decision==='blocked'),proposals,inquiry_url:'/customer/inquiries/new'});
  }catch{return unavailable();}
}
export async function getChat(request:NextRequest,id:string) {
  try {if(!uuidPattern.test(id))return catalogError('NOT_FOUND','Không tìm thấy hội thoại.',404);const who=await identity(request);if(who.error)return who.error;const result=await readSession(id,who);return result.error ? catalogDatabaseError(result.error):catalogJson({session:result.data});}catch{return unavailable();}
}
export async function handoff(request:NextRequest) {
  try {
    if(request.headers.get('origin')!==request.nextUrl.origin)return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    const who=await identity(request);if(who.error)return who.error;if(!who.session)return catalogJson({code:'SIGN_IN_REQUIRED',message:'Vui lòng đăng nhập hoặc gửi biểu mẫu tư vấn.',inquiry_url:'/customer/inquiries/new'},401);
    const parsed=await catalogInput(request);if(parsed.error)return parsed.error;const i=parsed.input;
    if(Object.keys(i).some(k=>!['session_id','summary','preferred_start','preferred_end','request_key'].includes(k)) || typeof i.session_id!=='string' || !uuidPattern.test(i.session_id) || typeof i.request_key!=='string' || !uuidPattern.test(i.request_key) || typeof i.summary!=='string' || i.summary.trim().length<3 || i.summary.length>2000 || (i.preferred_start==null)!==(i.preferred_end==null) || i.preferred_start!=null && (typeof i.preferred_start!=='string' || typeof i.preferred_end!=='string' || !Number.isFinite(Date.parse(i.preferred_start)) || !Number.isFinite(Date.parse(i.preferred_end)) || Date.parse(i.preferred_end)<=Date.parse(i.preferred_start) || Date.parse(i.preferred_start)<=Date.now()))return catalogError('INVALID_INPUT','Kiểm tra nội dung và thời gian đề nghị.',400);
    const result=await who.client!.rpc('pose_ai_request_handoff',{p_session:i.session_id,p_summary:i.summary,p_preferred_start:i.preferred_start || null,p_preferred_end:i.preferred_end || null,p_idempotency_key:i.request_key});
    if(result.error?.message?.includes('PHONE_VERIFICATION_REQUIRED'))return catalogJson({code:'PHONE_VERIFICATION_REQUIRED',message:'Vui lòng xác minh số điện thoại trong hồ sơ hoặc dùng biểu mẫu tư vấn.',inquiry_url:'/customer/inquiries/new',profile_url:'/account'},400);
    if(result.error?.message?.includes('IDENTITY_REVIEW_REQUIRED') || result.error?.message?.includes('REOPEN_REQUIRES_REVIEW'))return catalogJson({code:'NEEDS_REVIEW',message:'Thông tin khách hàng cần được chuyên viên kiểm tra. Vui lòng dùng biểu mẫu tư vấn.',inquiry_url:'/customer/inquiries/new'},409);
    if(result.error?.message?.includes('APPOINTMENT_OVERLAP'))return catalogError('APPOINTMENT_OVERLAP','Khung giờ đã có đề nghị khác. Vui lòng chọn giờ khác.',409);
    return result.error ? catalogDatabaseError(result.error):catalogJson({item:result.data,message:'Chuyên viên sẽ liên hệ để tư vấn. Thời gian bạn chọn chỉ là đề nghị, lịch chưa được xác nhận.'});
  }catch{return unavailable();}
}
