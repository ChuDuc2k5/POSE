import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies, validOrigin, requestClientIp } from '../../common/http.js';
import { WebRequest as NextRequest } from '../../common/http.js';
import { Injectable } from '@nestjs/common';
import { AiLlmService, AiGuardService, AiExtractionService, AiScoringService, AiPrivacyService } from './ai-logic.services.js';
import { authenticatedSession, authClient, consumeAttempt } from '../auth/session.js';
import { systemClient } from '../supabase/supabase.service.js';
import { catalogDatabaseError, catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { uuidPattern } from '../../common/catalog.js';
import { object } from './extraction.js';
import { inferSearch } from './infer-search.js';
import { type ScoreResult, type Dimension } from './lead-scoring.js';
import { correctionData, disclosure, GUARD_VERSION, safeReply, type Evidence } from './guard.js';
import { RetrievalService, renderRetrievedContext, deterministicReason, type RetrievalResult } from './retrieval.js';
import { runAgent } from './agent.ts';
import { querySearch, checkAnswer, extractNeedsAfterReply, SYSTEM_PROMPT, streamAgentStep } from './llm.ts';

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
  const scalar=(value:unknown)=>typeof value==='string'||typeof value==='number' ? value:'';
  const params=new URLSearchParams();if(typeof filters.location==='string')params.set('location',`ilike.%${filters.location}%`);if(filters.transaction_type)params.set('transaction_type',`eq.${scalar(filters.transaction_type)}`);if(filters.type)params.set('property_type',`eq.${scalar(filters.type)}`);if(filters.minPrice!==undefined)params.set('price',`gte.${scalar(filters.minPrice)}`);if(filters.maxPrice!==undefined)params.set('price',`lte.${scalar(filters.maxPrice)}`);
  const allowed=new Set(['location','transaction_type','type','minPrice','maxPrice']);if(Object.keys(filters).some(k=>!allowed.has(k)))throw new Error('INVALID_FILTER');
  let query=authClient().from('property_public_catalog').select('id,code,name,cover_id,area,bedrooms,price,availability,updated_at,location,property_type,transaction_type,price_period');
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
  const result=await authClient().from('property_public_catalog').select('id,code,name,cover_id,area,bedrooms,price,availability,updated_at,location,property_type,transaction_type,price_period').in('id',[...new Set(ids)].slice(0,100)).limit(100);
  if(result.error)throw new Error('RETRIEVAL_UNAVAILABLE');
  return (result.data || []).map(p=>({...p,price:p.price===null ? null:Number(p.price)})) as Evidence[];
}
function relaxedLocation(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const match=value.match(/(?:quận|huyện|thành phố|tp\.?|q\.?)[\s\d-]+/i);
  return match?.[0]?.trim() || value.split(',').at(-1)?.trim();
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
    let items:Evidence[]=[],related:Record<string,unknown>[]=[];
    const search=async(searchFilters:Record<string,unknown>,propertyId:string|null=null)=>{
      const aliases:Record<string,string>={min_price_vnd:'minPrice',max_price_vnd:'maxPrice',property_type:'type'};searchFilters=Object.fromEntries(Object.entries(searchFilters).map(([key,value])=>[aliases[key]||key,value]));
      try{rag=await this.retrieval.search(source,searchFilters,{propertyId,propertyIds:interestIds.slice(-20)});const mapped=rag.sources.filter(item=>item.id).map(item=>({...item,id:item.id as string,name:item.title as string,reason:item.reason as string}));const live=await retrieveIds(mapped.map(item=>item.id));return live.map(item=>({...item,...mapped.find(candidate=>candidate.id===item.id)})) as Evidence[];}
      catch{return retrieve(searchFilters,propertyId);}
    };
    if(searchPerformed)items=await search(filters,input.property_id as string|null || null);
    const initialRag=rag as RetrievalResult|null;
    if(searchPerformed && initialRag && !initialRag.found && Object.keys(filters).length && !input.property_id){
      const relaxed={transaction_type:filters.transaction_type,location:relaxedLocation(filters.location)};
      const relaxedItems=await search(Object.fromEntries(Object.entries(relaxed).filter(([,value])=>value!==undefined)),null);
      related=relaxedItems.slice(0,3).map(item=>({...item,number:undefined,relaxed_reason:filters.maxPrice!==undefined||filters.minPrice!==undefined?'Ngoài ngân sách đã nêu':filters.location?'Khác khu vực: '+String(filters.location):'Gợi ý gần với tiêu chí đã nêu',reason:deterministicReason(String(item.reason||'')),related:true}));
      rag=null;
    }
    // Small models rarely ask for a search on their own; search the catalogue from the
    // question itself, and if nothing matches widen once so the answer can compare.
    const inferred=searchPerformed ? null:inferSearch(source);
    // `inferSearch` is only an input to the validated query step below.
    const actions:{tool:string;args_hash:string;decision:string;reason:string;rule_version:string}[]=[];
    const log=(tool:string,args:unknown,reason:string|null,decision?:'flagged')=>actions.push({tool,args_hash:hash(JSON.stringify(args) || 'null'),decision:decision || (reason ? 'blocked':'allowed'),reason:reason || 'VALIDATED',rule_version:GUARD_VERSION});
    const safeEvidence=(list:Evidence[])=>list.filter(item=>{const reason=this.guard.evidenceReason(item);if(reason)log('retrieval',{id:item.id},reason);return !reason;});
    items=safeEvidence(items);
    const suspected=this.guard.injection(input.message) || sanitizedHistory.some(t=>this.guard.injection(t.content));
    if(suspected)log('input',source,'PROMPT_INJECTION','flagged');
    // Query understanding is a separate, validated step. The deterministic
    // inference is deliberately only the fallback (or the no-history fast path).
    let standalone=source, queryFilters:Record<string,unknown>=inferred || {};
    const realEstateIntent=Object.keys(queryFilters).length>0 || /căn|nhà|đất|phòng|giá|thuê|mua|bất động sản|Q\d|RV-/i.test(source);
    if(realEstateIntent && !(history.length===0 && Object.keys(queryFilters).length)) {
      try {
        const query=await querySearch(source, sanitizedHistory as never[]);
        standalone=query.standalone_question;
        const qf=Object.fromEntries(Object.entries(query.filters).filter(([,v])=>v!==null));
        queryFilters={location:qf.location,type:qf.property_type,minPrice:qf.min_price_vnd,maxPrice:qf.max_price_vnd,transaction_type:qf.transaction_type,bedrooms:qf.bedrooms};
        queryFilters=Object.fromEntries(Object.entries(queryFilters).filter(([,v])=>v!==null&&v!==undefined));
      } catch { log('query_step',source,'invalid_query','flagged'); }
    }
    if(realEstateIntent && !searchPerformed) { items=await search(queryFilters,null); searchPerformed=true; }
    const extracted:Record<string,unknown>={};
    const contextBlocks=items.map((item,index)=>`[${item.number || index+1}] ${item.code || ''} ${item.name || ''} ${item.location || ''} price=${item.price ?? 'unknown'} availability=${item.availability || 'unknown'}`).join('\n');
    const agentMessages=[{role:'system' as const,content:SYSTEM_PROMPT},{role:'user' as const,content:`BEGIN_UNTRUSTED_DATA\n${JSON.stringify({question:standalone,history:sanitizedHistory,properties:contextBlocks,customer_text:source,contact_redacted:guest && source!==input.message,injection_suspected:suspected,search_performed:searchPerformed})}\nEND_UNTRUSTED_DATA`}];
    const proposals:{tool:string;args_hash:string;decision:string;reason:string;rule_version:string}[]=[];
    const pendingActions:unknown[]=[];
    const execute=async(name:string,args:unknown)=>{
      if(name==='search_properties') { const a=args as Record<string,unknown>; const raw=object(a.filters) ? a.filters as Record<string,unknown> : {}; const f=Object.fromEntries(Object.entries(raw).filter(([,v])=>v!==null&&v!==undefined)); const found=await search(f,input.property_id as string|null || null); const labels:Record<string,string>={Available:'Đang mở bán',Sold:'Đã bán, không còn mở bán',Reserved:'Đã giữ chỗ, không còn mở bán',Unavailable:'Chưa khả dụng, không còn mở bán'}; return found.length ? found.map((p,i)=>`[${p.number || i+1}] ${p.code}: ${p.name}, ${p.price===null ? 'giá chưa công bố':`${p.price.toLocaleString('vi-VN')} VND`}. ${labels[p.availability] || 'Chưa rõ khả dụng'}. Cập nhật ${p.updated_at}.`) : ['Chưa có kết quả phù hợp trong nguồn công bố. Bạn có thể nói ngân sách hoặc khu vực tìm kiếm không?']; }
      if(name==='get_property_detail') { const code=(args as {code:string}).code; const result=await authClient().from('property_public_catalog').select('id,code,name,price,availability,updated_at,location,property_type,transaction_type,price_period').eq('code',code).maybeSingle(); return result.error || !result.data ? {found:false} : {found:true,property:result.data}; }
      if(name==='list_my_appointments') { if(guest) return {requires_sign_in:true}; const result=await who.client!.from('appointments').select('*').order('starts_at',{ascending:true}).limit(20); return result.error ? {error:'unavailable'} : {appointments:result.data || []}; }
      return {error:'unknown_read_tool'};
    };
    const createPending=async(name:string,args:unknown)=>{
      if(guest) { log(name,args,'SIGN_IN_REQUIRED','flagged'); return null; }
      const summary=name==='request_handoff' ? String((args as {summary:string}).summary) : name==='propose_appointment' ? `Đề nghị lịch xem ${(args as {code?:string}).code || ''} lúc ${(args as {preferred_start:string}).preferred_start}` : `Lưu ${(args as {code:string}).code} vào yêu thích`;
      const pending=await who.client!.rpc('pose_ai_create_pending',{p_session:id,p_tool:name,p_args:args,p_summary:summary,p_key:`${id}:${hash(JSON.stringify({name,args}))}`});
      if(pending.error) throw new Error(pending.error.message || 'PENDING_FAILED');
      pendingActions.push(pending.data);
      return String((pending.data as {id:string}).id);
    };
    const streamedDeltas:string[]=[];
    const streamRequested=request.headers.get('accept')?.includes('text/event-stream')===true;
    const step=streamRequested ? ((messages:Parameters<typeof streamAgentStep>[0])=>streamAgentStep(messages,text=>streamedDeltas.push(text))) as never : undefined;
    const run=async(messages:typeof agentMessages)=>runAgent(messages as never,execute,createPending,undefined,step);
    let agent=await run(agentMessages);
    for(const blockedReason of agent.blocked) log('agent',blockedReason,blockedReason,'flagged');
    let result={reply:agent.text || 'Hiện tôi chưa đủ dữ liệu để trả lời chính xác.',tool_calls:[] as unknown[],needs:{},flags:[] as never[]};
    result.reply=agent.text || result.reply;
    let violation:string|null=agent.blocked.length ? 'AGENT_BLOCKED':null;
    if(!violation) { try { const meta=await checkAnswer(result.reply,{sources:items,question:source}); const cited=new Set(items.map(x=>x.number)); if(meta.grounding==='none' && ( /\b\d{3,}\b/.test(result.reply) || /RV-\w+/i.test(result.reply))) violation='C3_META_UNGROUNDED'; if(meta.cited.some(n=>!cited.has(n))) violation='C3_CITATION_NOT_IN_CONTEXT'; } catch { /* C3 failure never fails the turn; guard remains authoritative. */ } }
    items=safeEvidence(await retrieveIds(items.map(p=>p.id))).slice(0,5);
    const finalRag=rag as RetrievalResult|null;if(finalRag){const rendered=renderRetrievedContext(finalRag.chunks,new Set(items.map(x=>x.id)));rag={...finalRag,...rendered};items=items.map(item=>({...item,number:(rendered.sources.find(s=>s.id===item.id)?.number as number|undefined),source_type:'Property'}));}else items=items.map((item,index)=>({...item,number:index+1,source_type:'Property'}));
    if(!violation){violation=this.guard.outputReason(result.reply,items,source,{retrievalFound:rag?.found??items.length>0,faqOnly:items.length>0&&items.every(x=>x.source_type==='Faq')});if(violation)log('output',result.reply,violation);}
    let blocked=false;
    if(violation){
      log('final_output',result.reply,violation);
      const retryMessages=[...agentMessages,{role:'user' as const,content:`BEGIN_UNTRUSTED_DATA\n${JSON.stringify({regeneration:true,violation,...correctionData(violation)})}\nEND_UNTRUSTED_DATA`}];
      agent=await run(retryMessages);
      result.reply=agent.text || safeReply;
      const retryViolation=this.guard.outputReason(result.reply,items,source,{retrievalFound:rag?.found??items.length>0,faqOnly:items.length>0&&items.every(x=>x.source_type==='Faq')});
      if(retryViolation){log('regeneration',result.reply,retryViolation);blocked=true;}
      else { violation=null; log('regeneration',{},null); }
    }
    const reply=(count===0 ? `${disclosure}\n`:'')+(related.length && !items.length ? 'Không có bất động sản nào khớp các tiêu chí bạn nêu.\n' : '')+(blocked ? safeReply:result.reply);
    if(!blocked){
      try {
        const modelNeeds=await extractNeedsAfterReply(source,reply);
        for(const entry of modelNeeds.invalid) log('invalid_need',entry,'invalid_need','flagged');
        for(const entry of modelNeeds.entries) extracted[entry.field]={value:entry.value,confidence:1,evidence:entry.evidence};
      } catch { log('extraction','needs_v1','extraction_failed','flagged'); }
    }
    const fields=blocked ? {}:this.extraction.extractNeeds(extracted,source,(key,field)=>log('invalid_need',{field:key,value:field},'invalid_need','flagged'));
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
    const action=pendingActions[0];
    const payload={session:committed.data,reply,sources:items,related,blocked,proposals,pending_actions:pendingActions,action,inquiry_url:'/customer/inquiries/new'};
    if(request.headers.get('accept')?.includes('text/event-stream')){
      const encoder=new TextEncoder();
      const stream=new ReadableStream<Uint8Array>({start(controller){
        const send=(type:string,value:unknown)=>controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`));
        send('meta',{session_id:committed.data.id,sources:items,related});
        const deltas=streamedDeltas.length ? streamedDeltas : Array.from({length:Math.ceil(reply.length/48)},(_,i)=>reply.slice(i*48,i*48+48));
        for(const text of deltas)send('delta',{text});
        for(const pending of pendingActions)send('action',{action:pending});
        send('done',{message:reply,blocked,guard:violation}); controller.close();
      }});
      return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'}});
    }
    return catalogJson(payload);
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

  async decideAction(request:NextRequest, actionId:string, confirm:boolean) {
    try {
      if(!validOrigin(request))return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
      if(!uuidPattern.test(actionId))return catalogError('NOT_FOUND','Không tìm thấy yêu cầu.',404);
      const who=await identity();if(who.error)return who.error;if(!who.session)return catalogError('NOT_FOUND','Không tìm thấy yêu cầu.',404);
      const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
      const body=parsed.input as Record<string,unknown>;
      const consents=body.consents && object(body.consents) ? Object.fromEntries(Object.entries(body.consents).filter(([k,v])=>(k==='Call'||k==='AIVoice')&&typeof v==='boolean')) : {};
      const result=await who.client!.rpc('pose_ai_decide_pending',{p_action:actionId,p_confirm:confirm,p_consents:consents});
      if(result.error?.message?.includes('ACTION_EXPIRED'))return catalogJson({code:'ACTION_EXPIRED',message:'Yêu cầu đã hết hạn. Vui lòng tạo lại yêu cầu.'},410);
      if(result.error?.code==='P0002')return catalogError('NOT_FOUND','Không tìm thấy yêu cầu.',404);
      if(result.error)return catalogDatabaseError(result.error);
      return catalogJson({action:result.data,message:confirm?'Đã xử lý yêu cầu của bạn.':'Đã huỷ yêu cầu.'});
    }catch{return unavailable();}
  }

}
