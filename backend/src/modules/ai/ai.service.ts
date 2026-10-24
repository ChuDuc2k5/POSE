import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies, validOrigin, requestClientIp } from '../../common/http.js';
import { WebRequest as NextRequest } from '../../common/http.js';
import { Injectable } from '@nestjs/common';
import { AiLlmService, AiGuardService, AiExtractionService, AiScoringService, AiPrivacyService } from './ai-logic.services.js';
import { authenticatedSession, authClient, consumeAttempt } from '../auth/session.js';
import { systemClient } from '../supabase/supabase.service.js';
import { catalogDatabaseError, catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { searchParameters } from '../../common/discovery.js';
import { uuidPattern } from '../../common/catalog.js';
import { object } from './extraction.js';
import { inferSearch } from './infer-search.js';
import { type ScoreResult, type Dimension } from './lead-scoring.js';
import { correctionData, disclosure, GUARD_VERSION, safeReply, type Evidence } from './guard.js';
import { RetrievalService, renderRetrievedContext, type RetrievalResult } from './retrieval.js';

export const unavailable=()=>catalogJson({code:'AI_UNAVAILABLE',message:'Trợ lý AI hiện chưa khả dụng. Vui lòng thử lại hoặc gửi yêu cầu tư vấn.',retry:true,inquiry_url:'/customer/inquiries/new'},503);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
async function identity() {
  const session=await authenticatedSession();
  if(session && session.role!=='User')return {error:catalogError('FORBIDDEN','Hội thoại dành cho khách hàng.',403)} as const;
  const cookie=(await cookies()).get('pose-ai-session')?.value;
  const token=cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie:randomBytes(32).toString('hex');
  return {session,token,guestHash:session ? null:hash(token),client:session ? authClient(session.access):null} as const;
}
async function readSession(id:string, who:Awaited<ReturnType<typeof identity>>) {
  if(who.error)return {data:null,error:{code:'42501'}};
  return who.client ? who.client.rpc('pose_ai_read_session',{p_session:id}):systemClient().rpc('pose_system_ai_read_guest',{p_session:id,p_hash:who.guestHash});
}
async function retrieve(filters:Record<string,unknown>,context:string|null):Promise<Evidence[]> {
  const params=new URLSearchParams(Object.entries(filters).filter(([k])=>k!=='transaction_type').map(([k,v])=>[k,String(v)]));
  const parsed=searchParameters(params);if(Object.keys(parsed.fields).length)throw new Error('INVALID_FILTER');
  let query=authClient().from('property_public_catalog').select('id,code,name,price,availability,updated_at,location,property_type,transaction_type,price_period');
  if(context)query=query.eq('id',context);
  if(typeof filters.location==='string')query=query.ilike('location',`%${filters.location.replace(/[%_\\]/g,'\\$&')}%`);
  if(filters.transaction_type)query=query.eq('transaction_type',filters.transaction_type);
  if(filters.type)query=query.eq('property_type',filters.type);
  if(filters.minPrice!==undefined)query=query.gte('price',filters.minPrice);
  if(filters.maxPrice!==undefined)query=query.lte('price',filters.maxPrice);
  const result=await query.order('updated_at',{ascending:false}).order('id').limit(5);
  if(result.error)throw new Error('RETRIEVAL_UNAVAILABLE');
  return (result.data || []).map(p=>({...p,price:p.price===null ? null:Number(p.price)})) as Evidence[];
}
async function retrieveIds(ids:string[]):Promise<Evidence[]> {
  if(!ids.length)return [];
  const result=await authClient().from('property_public_catalog').select('id,code,name,price,availability,updated_at,location,property_type,transaction_type,price_period').in('id',[...new Set(ids)].slice(0,100)).limit(100);
  if(result.error)throw new Error('RETRIEVAL_UNAVAILABLE');
  return (result.data || []).map(p=>({...p,price:p.price===null ? null:Number(p.price)})) as Evidence[];
}
@Injectable()
export class AiService {
  constructor(private readonly llm: AiLlmService, private readonly guard: AiGuardService, private readonly extraction: AiExtractionService, private readonly scoring: AiScoringService, private readonly privacy: AiPrivacyService,private readonly retrieval:RetrievalService) {}
  async chat(request:NextRequest) {
  try {
    if(!validOrigin(request))return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
    const input=parsed.input;
    if(Object.keys(input).some(k=>!['session_id','message','history','store_transcript','property_id','filters'].includes(k)) || typeof input.message!=='string' || !input.message.trim() || input.message.length>2000 || typeof input.store_transcript!=='boolean' || input.session_id!==undefined && (typeof input.session_id!=='string' || !uuidPattern.test(input.session_id)) || input.property_id!==undefined && input.property_id!==null && (typeof input.property_id!=='string' || !uuidPattern.test(input.property_id)))return catalogError('INVALID_INPUT','Tin nhắn tối đa 2.000 ký tự; lựa chọn lưu hội thoại phải rõ ràng.',400);
    const history=input.history ?? [];
    if(!Array.isArray(history) || history.length>10 || history.some(turn=>!object(turn) || Object.keys(turn).some(k=>!['role','content'].includes(k)) || !['user','assistant'].includes(turn.role as string) || typeof turn.content!=='string' || turn.content.length>8000))return catalogError('INVALID_HISTORY','Chỉ gửi tối đa 10 lượt hội thoại.',400);
    const filters=input.filters ?? {};
    if(!object(filters) || !this.guard.toolAllowed({name:'search_properties',arguments:filters}))return catalogError('INVALID_FILTER','Bộ lọc không hợp lệ.',400);
    const who=await identity();if(who.error)return who.error;
    const id=typeof input.session_id==='string' ? input.session_id:randomUUID();
    let count=0,interestIds:string[]=[],scoring:{needs:Record<string,{value:unknown;evidence?:string;confirmed_by?:unknown}>;verified:boolean;version:number;interest_ids?:string[];score_result?:ScoreResult}|null=null;
    if(input.session_id){const prior=await readSession(id,who);if(prior.error)return catalogDatabaseError(prior.error);count=prior.data.message_count;scoring=prior.data.scoring;interestIds=prior.data.property_ids || [];if(prior.data.store_transcript!==input.store_transcript || prior.data.status==='Closed')return catalogError('SESSION_CONFLICT','Lựa chọn lưu áp dụng cho cả phiên; hãy bắt đầu phiên mới để thay đổi.',409);}
    else if(who.client){const context=await who.client.rpc('pose_ai_score_context');if(context.error)return catalogDatabaseError(context.error);scoring=context.data;}
    if(!consumeAttempt('ai-ip',requestClientIp(),100) || !consumeAttempt('ai-session',id,40))return catalogError('RATE_LIMIT','Bạn đã gửi nhiều tin nhắn. Vui lòng thử lại sau.',429);
    const guest=!who.session, source=guest ? this.privacy.stripPhones(input.message):input.message;
    const sanitizedHistory=history.map(turn=>({role:turn.role,content:guest ? this.privacy.stripPhones(turn.content):turn.content}));
    let searchPerformed=input.filters!==undefined || !!input.property_id,rag:RetrievalResult|null=null;
    let items:Evidence[]=[];
    const search=async(searchFilters:Record<string,unknown>,propertyId:string|null=null)=>{
      try{rag=await this.retrieval.search(source,searchFilters,{propertyId,propertyIds:interestIds.slice(-20)});return (rag.sources.filter(item=>item.id).map(item=>({...item,id:item.id as string,name:item.title as string})) as unknown) as Evidence[];}
      catch{return retrieve(searchFilters,propertyId);}
    };
    if(searchPerformed)items=await search(filters,input.property_id as string|null || null);
    // Small models rarely ask for a search on their own; search the catalogue from the
    // question itself, and if nothing matches widen once so the answer can compare.
    const inferred=searchPerformed ? null:inferSearch(source);
    if(inferred && Object.keys(inferred).length){
      items=await search(inferred,null);
      if(!items.length && Object.keys(inferred).length){const {location,transaction_type}=inferred;items=await search({...location ? {location}:{},...transaction_type ? {transaction_type}:{}},null);}
      searchPerformed=true;
    }
    const actions:{tool:string;args_hash:string;decision:string;reason:string;rule_version:string}[]=[];
    const log=(tool:string,args:unknown,reason:string|null,decision?:'flagged')=>actions.push({tool,args_hash:hash(JSON.stringify(args) || 'null'),decision:decision || (reason ? 'blocked':'allowed'),reason:reason || 'VALIDATED',rule_version:GUARD_VERSION});
    const safeEvidence=(list:Evidence[])=>list.filter(item=>{const reason=this.guard.evidenceReason(item);if(reason)log('retrieval',{id:item.id},reason);return !reason;});
    items=safeEvidence(items);
    const suspected=this.guard.injection(input.message) || sanitizedHistory.some(t=>this.guard.injection(t.content));
    if(suspected)log('input',source,'PROMPT_INJECTION','flagged');
    const data=()=>({customer_text:source,history:sanitizedHistory,properties:items,retrieval:{found:rag?.found??items.length>0,grounding:rag?.grounding??(items.length?'catalog':'none'),context:rag?.context||''},search_performed:searchPerformed,injection_suspected:suspected,contact_redacted:guest && source!==input.message,signed_in:!guest});
    const extracted:Record<string,unknown>={};
    const turn=async(input:unknown)=>{const result=await this.llm.complete(input);Object.assign(extracted,result.needs);for(const flag of result.flags)log(flag.tool,flag.args,flag.reason,'flagged');return result;};
    let result=await turn(data()),violation:string|null=null,proposals:unknown[]=[];
    const tools=result.tool_calls || [];
    for(const t of tools)if(!this.guard.toolAllowed(t)){violation='TOOL_NOT_ALLOWED_OR_INVALID';log(object(t) && typeof t.name==='string' ? t.name:'invalid_tool',t,violation);}
    let searched=false;
    if(!violation)for(const t of tools){
      if(!this.guard.toolAllowed(t))continue;
      if(t.name==='search_properties'){
        if(searched){violation='TOOL_LIMIT';log(t.name,t.arguments,violation);break;}
        log(t.name,t.arguments,null);items=safeEvidence(await search({...t.arguments,...inferred?.transaction_type ? {transaction_type:inferred.transaction_type}:{}},null));searchPerformed=true;searched=true;
      }else if(guest){violation='SIGN_IN_REQUIRED';log(t.name,t.arguments,violation);}
      else{log(t.name,t.arguments,null);proposals.push(t);}
    }
    if(searched && !violation){
      result=await turn({...data(),tools_complete:true});
      if(result.tool_calls?.length){violation='TOOL_RECURSION_BLOCKED';for(const t of result.tool_calls)log('recursive_tool',t,violation);}
    }
    items=safeEvidence(await retrieveIds(items.map(p=>p.id))).slice(0,5);
    const finalRag=rag as RetrievalResult|null;if(finalRag){const rendered=renderRetrievedContext(finalRag.chunks,new Set(items.map(x=>x.id)));rag={...finalRag,...rendered};items=items.map(item=>({...item,number:(rendered.sources.find(s=>s.id===item.id)?.number as number|undefined),source_type:'Property'}));}else items=items.map((item,index)=>({...item,number:index+1,source_type:'Property'}));
    if(!violation){violation=this.guard.outputReason(result.reply,items,source,{retrievalFound:rag?.found??items.length>0,faqOnly:items.length>0&&items.every(x=>x.source_type==='Faq')});if(violation)log('output',result.reply,violation);}
    let blocked=false;
    if(violation){
      proposals=[];
      result=await turn({...data(),regeneration:true,tools_complete:true,...correctionData(violation)});
      items=safeEvidence(await retrieveIds(items.map(p=>p.id))).slice(0,5);
      const regenRag=rag as RetrievalResult|null;if(regenRag){const rendered=renderRetrievedContext(regenRag.chunks,new Set(items.map(x=>x.id)));rag={...regenRag,...rendered};items=items.map(item=>({...item,number:(rendered.sources.find(s=>s.id===item.id)?.number as number|undefined),source_type:'Property'}));}else items=items.map((item,index)=>({...item,number:index+1,source_type:'Property'}));
      const failed=result.tool_calls?.length ? 'TOOL_RECURSION_BLOCKED':this.guard.outputReason(result.reply,items,source,{retrievalFound:rag?.found??items.length>0,faqOnly:items.length>0&&items.every(x=>x.source_type==='Faq')});
      if(failed){log('final_output',result.tool_calls?.length ? result.tool_calls:result.reply,failed);blocked=true;}
      else log('regeneration',{},null);
    }
    const fields=blocked ? {}:this.extraction.extractNeeds(extracted,source,(key,field)=>log('invalid_need',{field:key,value:field},'invalid_need','flagged'));
    const reply=(count===0 ? `${disclosure}\n`:'')+(blocked ? safeReply:result.reply);
    const acceptedFields=guest || !input.store_transcript ? {}:fields;
    const merged:Record<string,{value:unknown;evidence?:string;confirmed_by?:unknown}>|null=scoring ? {...scoring.needs,...acceptedFields}:null;
    if(merged && scoring)for(const [k,f] of Object.entries(scoring.needs))if(object(f) && Object.hasOwn(f,'confirmed_by'))merged[k]=f;
    const changed=merged && scoring ? Object.keys(acceptedFields).filter(k=>JSON.stringify(merged[k]?.value)!==JSON.stringify(scoring!.needs[k]?.value)):[];
    let score:object|null=null;
    if(merged && scoring && changed.length){
      const interest=safeEvidence(await retrieveIds([...interestIds,...scoring.interest_ids || [],...items.map(p=>p.id)]));
      const preserve:Dimension[]=[];
      if(!changed.some(k=>k.startsWith('budget_')))preserve.push('budget');
      if(!changed.some(k=>['locations','property_types'].includes(k)))preserve.push('area_type');
      score={...this.scoring.scoreNeeds(merged,interest,scoring.verified,scoring.score_result,preserve),needs_version:scoring.version};
    }
    const committed=await systemClient().rpc('pose_system_ai_commit_chat',{p_session:id,p_user:who.session?.user.id || null,p_hash:who.guestHash,p_store:input.store_transcript,p_message:source,p_reply:reply,p_sources:items,p_actions:actions,p_fields:acceptedFields,p_score:score});
    if(committed.error)return catalogDatabaseError(committed.error);
    if(guest)(await cookies()).set('pose-ai-session',who.token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:86400*7});
    return catalogJson({session:committed.data,reply,sources:items,blocked,proposals,inquiry_url:'/customer/inquiries/new'});
  }catch{return unavailable();}
}
async getChat(request:NextRequest,id:string) {
  try {if(!uuidPattern.test(id))return catalogError('NOT_FOUND','Không tìm thấy hội thoại.',404);const who=await identity();if(who.error)return who.error;const result=await readSession(id,who);return result.error ? catalogDatabaseError(result.error):catalogJson({session:result.data});}catch{return unavailable();}
}
async handoff(request:NextRequest) {
  try {
    if(!validOrigin(request))return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    const who=await identity();if(who.error)return who.error;if(!who.session)return catalogJson({code:'SIGN_IN_REQUIRED',message:'Vui lòng đăng nhập hoặc gửi biểu mẫu tư vấn.',inquiry_url:'/customer/inquiries/new'},401);
    const parsed=await catalogInput(request);if(parsed.error)return parsed.error;const i=parsed.input;
    if(Object.keys(i).some(k=>!['session_id','summary','preferred_start','preferred_end','request_key'].includes(k)) || typeof i.session_id!=='string' || !uuidPattern.test(i.session_id) || typeof i.request_key!=='string' || !uuidPattern.test(i.request_key) || typeof i.summary!=='string' || i.summary.trim().length<3 || i.summary.length>2000 || (i.preferred_start==null)!==(i.preferred_end==null) || i.preferred_start!=null && (typeof i.preferred_start!=='string' || typeof i.preferred_end!=='string' || !Number.isFinite(Date.parse(i.preferred_start)) || !Number.isFinite(Date.parse(i.preferred_end)) || Date.parse(i.preferred_end)<=Date.parse(i.preferred_start) || Date.parse(i.preferred_start)<=Date.now()))return catalogError('INVALID_INPUT','Kiểm tra nội dung và thời gian đề nghị.',400);
    const result=await who.client!.rpc('pose_ai_request_handoff',{p_session:i.session_id,p_summary:i.summary,p_preferred_start:i.preferred_start || null,p_preferred_end:i.preferred_end || null,p_idempotency_key:i.request_key});
    if(result.error?.message?.includes('PHONE_VERIFICATION_REQUIRED'))return catalogJson({code:'PHONE_VERIFICATION_REQUIRED',message:'Vui lòng xác minh số điện thoại trong hồ sơ hoặc dùng biểu mẫu tư vấn.',inquiry_url:'/customer/inquiries/new',profile_url:'/account'},400);
    if(result.error?.message?.includes('IDENTITY_REVIEW_REQUIRED') || result.error?.message?.includes('REOPEN_REQUIRES_REVIEW'))return catalogJson({code:'NEEDS_REVIEW',message:'Thông tin khách hàng cần được chuyên viên kiểm tra. Vui lòng dùng biểu mẫu tư vấn.',inquiry_url:'/customer/inquiries/new'},409);
    if(result.error?.message?.includes('APPOINTMENT_OVERLAP'))return catalogError('APPOINTMENT_OVERLAP','Khung giờ đã có đề nghị khác. Vui lòng chọn giờ khác.',409);
    return result.error ? catalogDatabaseError(result.error):catalogJson({item:result.data,message:'Chuyên viên sẽ liên hệ để tư vấn. Thời gian bạn chọn chỉ là đề nghị, lịch chưa được xác nhận.'});
  }catch{return unavailable();}
}

}
