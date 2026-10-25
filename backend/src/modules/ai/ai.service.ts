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
import { inferSearch, inferTransactionType, centralFormerDistricts, genericHome } from './infer-search.js';
import { type ScoreResult, type Dimension } from './lead-scoring.js';
import { correctionData, disclosure, GUARD_VERSION, safeReply, groundedSummary, isOutOfScope, scopeFromTopic, outOfScopeReply, explicitWriteIntent, sourcesFromCitations, isAbusive, abusiveReply, type Evidence } from './guard.js';
import { RetrievalService, renderRetrievedContextWithCards, deterministicReason, type RetrievalResult } from './retrieval.js';
import { runAgent } from './agent.ts';
import { querySearch, checkAnswer, extractNeedsAfterReply, SYSTEM_PROMPT, streamAgentStep } from './llm.ts';
import { setAiRequestSession, logAiRequest } from './request-log.js';
import { questionPreview } from './privacy.js';
import { clarificationFor, referencedListingCodes } from './history-aware.js';
import { sanitizeReply } from './guard.js';
import { withFormerDistrict } from './ward-label.js';
import { moneyAmounts, priceLabel } from './money.js';
import { loanAssumption, noMatchReply, ownerRequest, unsupportedCriteria, unsupportedLine } from './unsupported.js';

export const unavailable=()=>catalogJson({code:'AI_UNAVAILABLE',message:'Trợ lý AI tạm thời không khả dụng. Bạn có thể thử lại, xem danh sách bất động sản hoặc gửi yêu cầu tư vấn.',retry:true,search_url:'/properties',inquiry_url:'/customer/inquiries/new'},503);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const realEstateWordsForHistory=(text:string)=>/căn|nhà|đất|phòng|giá|thuê|mua|bất động sản|dự án|khu vực|diện tích|chuyên viên|lịch xem|yêu thích|Q\d|RV-/i.test(text);
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
  const allowed=new Set(['location','locations','transaction_type','type','minPrice','maxPrice','minArea','maxArea','bedrooms']);if(Object.keys(filters).some(k=>!allowed.has(k)))throw new Error('INVALID_FILTER');
  let query=authClient().from('property_public_catalog').select('id,code,name,cover_id,area,bedrooms,price,availability,updated_at,location,property_type,transaction_type,price_period');
  if(context)query=query.eq('id',context);
  if(typeof filters.location==='string')query=query.ilike('location',`%${filters.location.replace(/[%_\\]/g,'\\$&')}%`);
  if(Array.isArray(filters.locations)&&filters.locations.length)query=query.or(filters.locations.map(value=>`location.ilike.%${String(value).replace(/[%_\\]/g,'\\$&')}%`).join(','));
  if(filters.transaction_type)query=query.eq('transaction_type',filters.transaction_type);
  if(filters.type)query=query.eq('property_type',filters.type);
  if(filters.minPrice!==undefined)query=query.gte('price',filters.minPrice);
  if(filters.maxPrice!==undefined)query=query.lte('price',filters.maxPrice);
  if(filters.minArea!==undefined)query=query.gte('area',filters.minArea);
  if(filters.maxArea!==undefined)query=query.lte('area',filters.maxArea);
  if(filters.bedrooms!==undefined)query=query.or(`bedrooms.is.null,bedrooms.eq.${Number(filters.bedrooms)}`);
  const result=await query.order('updated_at',{ascending:false}).order('id').limit(5);
  if(result.error)throw new Error('RETRIEVAL_UNAVAILABLE');
  return (result.data || []).map(p=>({...p,price:p.price===null ? null:Number(p.price)})) as Evidence[];
}
async function retrieveIds(ids:string[]):Promise<Evidence[]> {
  if(!ids.length)return [];
  const result=await authClient().from('property_public_catalog').select('id,code,name,cover_id,area,bedrooms,price,availability,updated_at,location,property_type,transaction_type,price_period').in('id',[...new Set(ids)].slice(0,100)).limit(100);
  if(result.error)throw new Error('RETRIEVAL_UNAVAILABLE');
  const order=new Map(ids.map((id,index)=>[id,index]));
  return (result.data || []).sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER)).map(p=>({...p,price:p.price===null ? null:Number(p.price)})) as Evidence[];
}
async function retrieveCodes(codes:string[]):Promise<Evidence[]> {
  if(!codes.length)return [];
  const result=await authClient().from('property_public_catalog').select('id,code,name,cover_id,area,bedrooms,price,availability,updated_at,location,property_type,transaction_type,price_period').in('code',[...new Set(codes)].slice(0,5)).limit(5);
  if(result.error)throw new Error('RETRIEVAL_UNAVAILABLE');
  const order=new Map(codes.map((code,index)=>[code.toLowerCase(),index]));
  return (result.data || []).sort((a,b)=>(order.get(a.code.toLowerCase())??Number.MAX_SAFE_INTEGER)-(order.get(b.code.toLowerCase())??Number.MAX_SAFE_INTEGER)).map(p=>({...p,price:p.price===null ? null:Number(p.price)})) as Evidence[];
}
// The whole catalogue is in Ho Chi Minh City, whose name is written many ways ("TP.HCM",
// "Thành phố Hồ Chí Minh"…); a city-level location is not a filter and would only miss rows.
const cityOnly=/^(?:tp\.?\s*|thành phố\s*)?(?:hcm|hồ chí minh|ho chi minh|sài gòn|saigon)$/i;
// "khoảng 25 triệu" is extracted as min = max; an approximate figure becomes a ±20% range.
export function approximatePriceRange(filters: Record<string, unknown>) { if (typeof filters.minPrice==='number' && filters.minPrice===filters.maxPrice) { filters.minPrice=Math.round(filters.minPrice*0.8); filters.maxPrice=Math.round((filters.maxPrice as number)*1.2); } return filters; }
export function locationFilter(value: unknown) { return typeof value==='string' && value.trim() && !cityOnly.test(value.trim().replace(/[.,]$/,'')) ? value.trim() : undefined; }
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
    let id=typeof input.session_id==='string' ? input.session_id:randomUUID();
    let count=0,interestIds:string[]=[],scoring:{needs:Record<string,{value:unknown;evidence?:string;confirmed_by?:unknown}>;verified:boolean;version:number;interest_ids?:string[];score_result?:ScoreResult}|null=null;
    // A conversation stopped before its first answer was never committed; continue it as a new session instead of failing.
    let prior=input.session_id ? await readSession(id,who):null;
    if(prior?.error?.code==='P0002'){id=randomUUID();prior=null;}
    const turnId = randomUUID();
    setAiRequestSession(id, turnId, questionPreview(input.message));
    if(prior){if(prior.error)return catalogDatabaseError(prior.error);count=prior.data.message_count;scoring=prior.data.scoring;interestIds=prior.data.suggested_property_ids || [];if(prior.data.store_transcript!==input.store_transcript || prior.data.status==='Closed')return catalogError('SESSION_CONFLICT','Lựa chọn lưu áp dụng cho cả phiên; hãy bắt đầu phiên mới để thay đổi.',409);}
    else if(who.client){const context=await who.client.rpc('pose_ai_score_context');if(context.error)return catalogDatabaseError(context.error);scoring=context.data;}
    if(!consumeAttempt('ai-ip',requestClientIp(),100) || !consumeAttempt('ai-session',id,40))return catalogError('RATE_LIMIT','Bạn đã gửi nhiều tin nhắn. Vui lòng thử lại sau.',429);
    const guest=!who.session, source=guest ? this.privacy.stripPhones(input.message):input.message;
    const sanitizedHistory=history.map(turn=>({role:turn.role,content:guest ? this.privacy.stripPhones(turn.content):turn.content}));
    if(isAbusive(source)){
      const committed=await systemClient().rpc('pose_system_ai_commit_chat',{p_session:id,p_user:who.session?.user.id || null,p_hash:who.guestHash,p_store:false,p_message:source,p_reply:abusiveReply,p_sources:[],p_actions:[],p_fields:{},p_score:null});
      if(committed.error)return catalogDatabaseError(committed.error);
      return catalogJson({session:committed.data,reply:abusiveReply,scope:'out_of_scope',sources:[],related:[],blocked:false,proposals:[],pending_actions:[],inquiry_url:'/customer/inquiries/new'});
    }
    const codeReference=referencedListingCodes(source,sanitizedHistory);
    let referencedItems:Evidence[]=[];
    if(codeReference.ambiguous){
      referencedItems=await retrieveCodes(codeReference.codes);
      // "tôi quan tâm căn … giá 26 triệu": a pasted line or price picks one of the listings just shown.
      const said=new Set(moneyAmounts(source)),text=source.normalize('NFC').toLocaleLowerCase('vi');
      const words=(value:string)=>value.normalize('NFC').toLocaleLowerCase('vi').split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>2);
      const score=(item:Evidence)=>(item.price!=null&&said.has(item.price)?3:0)+words(item.name||'').filter(word=>text.includes(word)).length/Math.max(1,words(item.name||'').length);
      const ranked=referencedItems.map(item=>({item,score:score(item)})).sort((a,b)=>b.score-a.score);
      if(ranked.length && ranked[0].score>=1 && (ranked.length===1 || ranked[0].score-ranked[1].score>=0.5)){codeReference.codes=[ranked[0].item.code];codeReference.ambiguous=false;}
    }
    if(codeReference.ambiguous){
      const clarify={needed:true,question:'Bạn đang hỏi căn nào?',options:referencedItems.slice(0,5).map(item=>`${item.code} - ${item.name}`)};
      const committed=await systemClient().rpc('pose_system_ai_commit_chat',{p_session:id,p_user:who.session?.user.id || null,p_hash:who.guestHash,p_store:input.store_transcript,p_message:source,p_reply:clarify.question,p_sources:[],p_actions:[],p_fields:{},p_score:null});
      if(committed.error)return catalogDatabaseError(committed.error);
      return catalogJson({session:committed.data,reply:clarify.question,scope:'in_scope',sources:[],related:[],clarify,proposals:[],pending_actions:[],inquiry_url:'/customer/inquiries/new'});
    }
    const clarification=clarificationFor(source, sanitizedHistory);
    if(clarification.needed){
      const committed=await systemClient().rpc('pose_system_ai_commit_chat',{p_session:id,p_user:who.session?.user.id || null,p_hash:who.guestHash,p_store:input.store_transcript,p_message:source,p_reply:clarification.question,p_sources:[],p_actions:[],p_fields:{},p_score:null});
      if(committed.error)return catalogDatabaseError(committed.error);
      return catalogJson({session:committed.data,reply:clarification.question,scope:'in_scope',sources:[],related:[],clarify:clarification,proposals:[],pending_actions:[],inquiry_url:'/customer/inquiries/new'});
    }
    let searchPerformed=input.filters!==undefined || !!input.property_id,rag:RetrievalResult|null=null;
    let items:Evidence[]=[],related:Record<string,unknown>[]=[];
    const search=async(searchFilters:Record<string,unknown>,propertyId:string|null=null,referenceIds:string[]=[],searchQuery=source)=>{
      const aliases:Record<string,string>={min_price_vnd:'minPrice',max_price_vnd:'maxPrice',min_area_m2:'minArea',max_area_m2:'maxArea',property_type:'type'};searchFilters=Object.fromEntries(Object.entries(searchFilters).map(([key,value])=>[aliases[key]||key,value]));
      try{rag=await this.retrieval.search(searchQuery,searchFilters,{propertyId,propertyIds:referenceIds});const mapped=rag.sources.filter(item=>item.id).map(item=>({...item,id:item.id as string,name:item.title as string,reason:item.reason as string}));const live=await retrieveIds(mapped.map(item=>item.id));return live.map(item=>({...item,...mapped.find(candidate=>candidate.id===item.id)})) as Evidence[];}
      catch(error){
        console.warn(JSON.stringify({event:'retrieval_fallback',error:error instanceof Error ? error.message:'RETRIEVAL_UNAVAILABLE'}));
        return retrieve(searchFilters,propertyId);
      }
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
    let standalone=source, queryKeywords:string[]=[], queryFilters:Record<string,unknown>=inferred || {};
    const realEstateIntent=Object.keys(queryFilters).length>0 || /căn|nhà|đất|phòng|giá|thuê|mua|bất động sản|Q\d|RV-/i.test(source);
    const propertyHistory=history.some(turn=>realEstateWordsForHistory(turn.content)) || interestIds.length>0;
    let referenceIds:string[]=[];
    // Scope: the validated query step's `topic` decides; the keyword guard is only the
    // fallback when that step is skipped (explicit property request) or fails.
    let outOfScope=isOutOfScope(source, realEstateIntent || input.property_id ? 'real_estate' : 'unknown', propertyHistory);
    let modelTopic:'real_estate'|'smalltalk'|'out_of_scope'|null=null;
    if(!input.property_id && !(history.length===0 && Object.keys(queryFilters).length)) {
      try {
        const query=await querySearch(source, sanitizedHistory as never[]);
        modelTopic=query.topic;
        outOfScope=scopeFromTopic(query.topic, source, propertyHistory);
        if(query.topic!=='real_estate')throw new Error('NOT_A_PROPERTY_QUERY');
        standalone=query.standalone_question;
        queryKeywords=query.keywords;
        const qf=Object.fromEntries(Object.entries(query.filters).filter(([,v])=>v!==null));
        queryFilters={location:qf.location,type:qf.property_type,minPrice:qf.min_price_vnd,maxPrice:qf.max_price_vnd,minArea:qf.min_area_m2,maxArea:qf.max_area_m2,transaction_type:qf.transaction_type,bedrooms:qf.bedrooms};
        queryFilters.location=locationFilter(queryFilters.location);
        approximatePriceRange(queryFilters);
        queryFilters=Object.fromEntries(Object.entries(queryFilters).filter(([,v])=>v!==null&&v!==undefined));
        const inferredTransaction=inferTransactionType(source);
        if(inferredTransaction)queryFilters.transaction_type=inferredTransaction;
        // The model rarely fills area bounds and reads "có 2 tỷ… vay" as a 2 tỷ ceiling; the deterministic parse wins there.
        const inferredFilters=inferSearch(source);
        if(inferredFilters?.minArea!==undefined && queryFilters.minArea===undefined)queryFilters.minArea=inferredFilters.minArea;
        if(inferredFilters?.maxArea!==undefined && queryFilters.maxArea===undefined)queryFilters.maxArea=inferredFilters.maxArea;
        if(/(?<![\p{L}])vay(?![\p{L}])/iu.test(source) && inferredFilters?.maxPrice!==undefined){queryFilters.maxPrice=inferredFilters.maxPrice;delete queryFilters.minPrice;}
        if (!queryFilters.location && /gần\s+(?:Quận\s*1|trung tâm)|đi\s+làm\s+(?:Quận\s*1|trung tâm)/iu.test(source)) queryFilters.locations=centralFormerDistricts;
        // The newest message wins: what it states explicitly replaces the model's reading of earlier turns,
        // and a price from an earlier turn is never carried into a message that names none.
        if(inferredFilters){
          for(const key of ['location','locations','type','transaction_type','minPrice','maxPrice'] as const)if(inferredFilters[key]!==undefined)queryFilters[key]=inferredFilters[key];
          if(inferredFilters.location)delete queryFilters.locations;
          if(inferredFilters.locations)delete queryFilters.location;
        }
        if(!moneyAmounts(source).length){delete queryFilters.minPrice;delete queryFilters.maxPrice;}
        if(genericHome(source))delete queryFilters.type;
        referenceIds=query.refers_to_previous.map(index=>interestIds[index-1]).filter((value):value is string=>typeof value==='string');
      } catch(error) { if(!(error instanceof Error && error.message==='NOT_A_PROPERTY_QUERY'))log('query_step',source,'invalid_query','flagged'); }
    }
    // Refuse before retrieval and before constructing an agent with tools.
    if(outOfScope) {
      log('scope',source,'OUT_OF_SCOPE','flagged');
      const committed=await systemClient().rpc('pose_system_ai_commit_chat',{p_session:id,p_user:who.session?.user.id || null,p_hash:who.guestHash,p_store:false,p_message:source,p_reply:outOfScopeReply,p_sources:[],p_actions:actions,p_fields:{},p_score:null});
      if(committed.error)return catalogDatabaseError(committed.error);
      return catalogJson({session:committed.data,reply:outOfScopeReply,scope:'out_of_scope',sources:[],related:[],blocked:false,proposals:[],pending_actions:[],inquiry_url:'/customer/inquiries/new'});
    }
    const pureReference=referenceIds.length>0 && Object.keys(queryFilters).length===0 && /\b(?:căn|can|nhà|nha|lô|lo|khu|kết quả|ket qua|đó|do|vừa|vua|thứ|thu|nào|nao|tiếp|tiep|trước|truoc|nêu|neu)\b/i.test(source);
    if(codeReference.codes.length) { items=await retrieveCodes(codeReference.codes); searchPerformed=false; }
    else if(pureReference) { items=await retrieveIds(referenceIds); searchPerformed=false; }
    else if((realEstateIntent || modelTopic==='real_estate') && !searchPerformed) { items=await search(queryFilters,null,referenceIds,[standalone,...queryKeywords].join(' ')); searchPerformed=true; console.info(JSON.stringify({event:'search_filters',filters:queryFilters,found:items.length,related:related.length})); }
    const extracted:Record<string,unknown>={};
    const contextBlocks=items.map((item,index)=>`[${item.number || index+1}] ${item.code || ''} ${item.name || ''} ${withFormerDistrict(item.location || '')} giá=${priceLabel(item.price,item.price_period==='Month' || item.transaction_type==='Rent')} availability=${item.availability || 'unknown'}`).join('\n');
    const agentMessages=[{role:'system' as const,content:SYSTEM_PROMPT},{role:'user' as const,content:`BEGIN_UNTRUSTED_DATA\n${JSON.stringify({question:standalone,history:sanitizedHistory,properties:contextBlocks,customer_text:source,contact_redacted:guest && source!==input.message,injection_suspected:suspected,search_performed:searchPerformed})}\nEND_UNTRUSTED_DATA`}];
    const proposals:{tool:string;args_hash:string;decision:string;reason:string;rule_version:string}[]=[];
    const pendingActions:unknown[]=[];
    const execute=async(name:string,args:unknown)=>{
      if(name==='search_properties') { const a=args as Record<string,unknown>; const raw=object(a.filters) ? a.filters as Record<string,unknown> : {}; const f=Object.fromEntries(Object.entries(raw).filter(([,v])=>v!==null&&v!==undefined)); const found=await search(f,input.property_id as string|null || null); const labels:Record<string,string>={Available:'Đang mở bán',Sold:'Đã bán, không còn mở bán',Reserved:'Đã giữ chỗ, không còn mở bán',Unavailable:'Chưa khả dụng, không còn mở bán'}; return found.length ? found.map((p,i)=>`[${p.number || i+1}] ${p.code}: ${p.name}, giá ${priceLabel(p.price,p.price_period==='Month' || p.transaction_type==='Rent')}. ${labels[p.availability] || 'Chưa rõ khả dụng'}. Cập nhật ${p.updated_at}.`) : ['Chưa có kết quả phù hợp trong nguồn công bố. Bạn có thể nói ngân sách hoặc khu vực tìm kiếm không?']; }
      if(name==='get_property_detail') { const code=(args as {code:string}).code; const result=await authClient().from('property_public_catalog').select('id,code,name,price,availability,updated_at,location,property_type,transaction_type,price_period').eq('code',code).maybeSingle(); return result.error || !result.data ? {found:false} : {found:true,property:result.data}; }
      if(name==='list_my_appointments') { if(guest) return {requires_sign_in:true}; const result=await who.client!.from('appointments').select('*').order('starts_at',{ascending:true}).limit(20); return result.error ? {error:'unavailable'} : {appointments:result.data || []}; }
      return {error:'unknown_read_tool'};
    };
    const createPending=async(name:string,args:unknown)=>{
      if(!explicitWriteIntent(source)) { log(name,args,guest?'SIGN_IN_REQUIRED':'WRITE_NOT_REQUESTED','flagged'); return null; }
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
    // An empty model answer is a provider failure: retry once, then fail the turn with AI_UNAVAILABLE.
    if(!agent.text.trim() && !agent.pending.length && !agent.blocked.length){
      agent=await run(agentMessages);
      if(!agent.text.trim() && !agent.pending.length && !agent.blocked.length)throw new Error('AI_EMPTY_RESPONSE');
    }
    const calledWriteTools=new Set(agent.messages.flatMap(message=>message.role==='assistant' ? (message.tool_calls||[]).filter(call=>call.type==='function').map(call=>call.function.name) : []));
    const normalizedSource=source.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\u0111/g,'d').toLowerCase();
    const fallbackTool=/(lien he|goi lai|gap chuyen vien|nhan vien tu van|chuyen vien tu van)/i.test(normalizedSource) ? 'request_handoff' : /(dat lich|hen xem|xem (?:nha|can))/i.test(normalizedSource) && codeReference.codes.length ? 'propose_appointment' : /luu can/i.test(normalizedSource) && codeReference.codes.length ? 'save_favorite' : null;
    // A viewing request needs a time the customer has not given yet; signed-in users get it asked in the reply.
    if(explicitWriteIntent(source) && fallbackTool && !calledWriteTools.has(fallbackTool) && (guest || fallbackTool!=='propose_appointment')){
      const code=codeReference.codes[0] || null;
      const args=fallbackTool==='request_handoff' ? {summary:source} : fallbackTool==='propose_appointment' ? {code,preferred_start:null,preferred_end:null} : {code};
      const action_id=await createPending(fallbackTool,args);
      if(action_id) pendingActions.push({id:action_id,tool:fallbackTool,args});
      logAiRequest({kind:'chat',model:'deterministic',promptName:'assistant',toolsCalled:[fallbackTool],latencyMs:0,status:'ok'});
    }
    for(const blockedReason of agent.blocked) log('agent',blockedReason,blockedReason,'flagged');
    let result={reply:agent.text || 'Hiện tôi chưa đủ dữ liệu để trả lời chính xác.',tool_calls:[] as unknown[],needs:{},flags:[] as never[]};
    result.reply=sanitizeReply(agent.text || result.reply);
    let violation:string|null=agent.blocked.length ? 'AGENT_BLOCKED':null;
    // C3: citations are read from the reply itself (deterministic); a small model's self-reported
    // `cited` list is unreliable. The model's grounding verdict only matters for uncited claims.
    if(!violation) {
      const numbers=new Set(items.map((x,index)=>x.number ?? index+1)), citedInReply=[...result.reply.matchAll(/\[(\d{1,3})\]/g)].map(m=>Number(m[1]));
      if(citedInReply.some(n=>!numbers.has(n))) violation='C3_CITATION_NOT_IN_CONTEXT';
      else if(!citedInReply.length) { try { const meta=await checkAnswer(result.reply,{sources:items,question:source}); if(meta.grounding==='none' && ( /\b\d{3,}\b/.test(result.reply) || /RV-\w+/i.test(result.reply))) violation='C3_META_UNGROUNDED'; } catch { /* C3 failure never fails the turn; guard remains authoritative. */ } }
    }
    items=safeEvidence(await retrieveIds(items.map(p=>p.id))).slice(0,5);
    const finalRag=rag as RetrievalResult|null;if(finalRag){const rendered=renderRetrievedContextWithCards(finalRag.chunks,new Set(items.map(x=>x.id)));rag={...finalRag,...rendered};items=items.map(item=>({...item,number:((rendered.sources.find(s=>(s as {id?:string}).id===item.id) as {number?:number}|undefined)?.number),source_type:'Property'}));}else items=items.map((item,index)=>({...item,number:index+1,source_type:'Property'}));
    const evidenceItems=items;
    const guardContext={retrievalFound:rag?.found??evidenceItems.length>0,faqOnly:evidenceItems.length>0&&evidenceItems.every(x=>x.source_type==='Faq')};
    if(!violation){violation=this.guard.outputReason(result.reply,evidenceItems,source,guardContext);if(violation){log('output',result.reply,violation);console.warn(JSON.stringify({event:'guard_block',reason:violation,cited:[...result.reply.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])),sources:evidenceItems.map(x=>x.number??null),preview:result.reply.slice(0,300)}));}}
    let blocked=false;
    if(violation){
      log('final_output',result.reply,violation);
      const retryMessages=[...agentMessages,{role:'user' as const,content:`BEGIN_UNTRUSTED_DATA\n${JSON.stringify({regeneration:true,violation,...correctionData(violation)})}\nEND_UNTRUSTED_DATA`}];
      agent=await run(retryMessages);
      result.reply=sanitizeReply(agent.text || safeReply);
      const retryViolation=this.guard.outputReason(result.reply,evidenceItems,source,guardContext);
      if(retryViolation){log('regeneration',result.reply,retryViolation);console.warn(JSON.stringify({event:'guard_block',phase:'regeneration',reason:retryViolation,cited:[...result.reply.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])),sources:items.map(x=>x.number??null),preview:result.reply.slice(0,300)}));blocked=true;}
      else { violation=null; log('regeneration',{},null); }
    }
    // Tool calls can mix result sets; the grounded summary and its cards share one fresh 1..n numbering.
    const referencedAnswer=codeReference.codes.length>0 || pureReference;
    if(blocked)items=evidenceItems.map((item,index)=>({...item,number:index+1}));
    else items=sourcesFromCitations(result.reply,evidenceItems,referencedAnswer);
    const noMatch=searchPerformed&&!input.property_id&&!evidenceItems.length&&!related.length;
    const criteriaLabels=unsupportedCriteria(source);
    const unsupportedSuffix=!blocked&&criteriaLabels.length&&!criteriaLabels.every(label=>new RegExp(`(?:chưa có thông tin|chưa có dữ liệu|chưa được cung cấp).*${label.split(' / ')[0]}`,'iu').test(result.reply)) ? `\n${unsupportedLine(criteriaLabels)}`:'';
    const ownerSuffix=!blocked&&!/chuyên viên|nhân viên tư vấn/iu.test(result.reply)&&ownerRequest(source) ? `\nChuyên viên tư vấn của TERAVA có thể liên hệ để hỗ trợ bạn đăng tin và quản lý giao dịch.`:'';
    const loanSuffix=/\bvay\b/iu.test(source)&&moneyAmounts(source).length ? `\n${loanAssumption}`:'';
    const reply=(count===0 ? `${disclosure}\n`:'')+(noMatch ? `${noMatchReply(source)}\n` : related.length && !items.length ? 'Không có bất động sản nào khớp các tiêu chí bạn nêu.\n' : '')+(blocked ? groundedSummary(items):result.reply)+unsupportedSuffix+ownerSuffix+loanSuffix;
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
    const scope: 'in_scope' | 'out_of_scope' = 'in_scope';
    const payload={session:committed.data,reply,scope,sources:items,related,blocked,proposals,pending_actions:pendingActions,action,inquiry_url:'/customer/inquiries/new'};
    if(request.headers.get('accept')?.includes('text/event-stream')){
      const encoder=new TextEncoder();
      const stream=new ReadableStream<Uint8Array>({start(controller){
        const send=(type:string,value:unknown)=>controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`));
        send('meta',{session_id:committed.data.id,scope,sources:items,related});
        // The stream is sent after the guarded answer is final, so only the final reply is streamed
        // (never a draft that a guard later replaced).
        const deltas=Array.from({length:Math.ceil(reply.length/48)},(_,i)=>reply.slice(i*48,i*48+48));
        for(const text of deltas)send('delta',{text});
        for(const pending of pendingActions)send('action',{action:pending});
        send('done',{message:reply,scope,blocked,guard:violation}); controller.close();
      }});
      return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'}});
    }
    return catalogJson(payload);
  }catch{return unavailable();}
}
async getChat(request:NextRequest,id:string) {
  try {if(!uuidPattern.test(id))return catalogError('NOT_FOUND','Không tìm thấy hội thoại.',404);const who=await identity();if(who.error)return who.error;const result=await readSession(id,who);return result.error ? catalogDatabaseError(result.error):catalogJson({session:result.data});}catch{return unavailable();}
}
async getSessions(request:NextRequest) {
  const session=await authenticatedSession();
  if(!session || session.role!=='User')return catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401);
  const pageValue=Number(new URL(request.url).searchParams.get('page')||1);
  if(!Number.isInteger(pageValue)||pageValue<1||pageValue>100)return catalogError('INVALID_INPUT','Trang không hợp lệ.',400);
  const result=await authClient(session.access).rpc('pose_ai_list_sessions',{p_page:pageValue});
  return result.error ? catalogDatabaseError(result.error):catalogJson({items:result.data||[]});
}
async getUsage(request:NextRequest) {
  // Read-only GET: browsers send no Origin on same-origin GETs; CSRF checks guard state changes only.
  const session=await authenticatedSession();
  if(!session)return catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401);
  if(session.role!=='Admin')return catalogError('FORBIDDEN','Bạn không có quyền xem sử dụng AI.',403);
  const url=new URL(request.url), from=url.searchParams.get('from'), to=url.searchParams.get('to');
  const result=await authClient(session.access).rpc('pose_system_admin_ai_usage',{p_from:from||null,p_to:to||null});
  return result.error ? catalogDatabaseError(result.error) : catalogJson({items:result.data||[]});
}
async getAiDashboard(request:NextRequest, kind:'overview'|'series'|'kinds'|'turns'|'turn', id?:string) {
  // Read-only GET (see getUsage): authorization is the Admin session check below.
  const session=await authenticatedSession();
  if(!session)return catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401);
  if(session.role!=='Admin')return catalogError('FORBIDDEN','Bạn không có quyền xem dashboard AI.',403);
  const url=new URL(request.url), from=url.searchParams.get('from'), to=url.searchParams.get('to');
  const parseDate=(value:string|null)=>value && Number.isFinite(Date.parse(value)) ? value:null;
  const pFrom=parseDate(from), pTo=parseDate(to);
  if((from&&!pFrom)||(to&&!pTo)||(pFrom&&pTo&&Date.parse(pFrom)>=Date.parse(pTo)))return catalogError('INVALID_INPUT','Khoảng thời gian không hợp lệ.',400);
  if(kind==='overview') { const result=await authClient(session.access).rpc('pose_system_admin_ai_overview'); return result.error?catalogDatabaseError(result.error):catalogJson({items:result.data||[]}); }
  if(kind==='series'||kind==='kinds') {
    const bucket=url.searchParams.get('bucket');
    if(kind==='series'&&bucket&&!['day','week','month'].includes(bucket))return catalogError('INVALID_INPUT','Bucket không hợp lệ.',400);
    const result=await authClient(session.access).rpc(kind==='series'?'pose_system_admin_ai_series':'pose_system_admin_ai_by_kind',kind==='series'?{p_bucket:bucket||'day',p_from:pFrom||new Date(Date.now()-30*86400000).toISOString(),p_to:pTo||new Date().toISOString()}:{p_from:pFrom||new Date(Date.now()-30*86400000).toISOString(),p_to:pTo||new Date().toISOString()});
    return result.error?catalogDatabaseError(result.error):catalogJson({items:result.data||[]});
  }
  if(kind==='turn') { if(!id||!uuidPattern.test(id))return catalogError('INVALID_INPUT','Mã lượt không hợp lệ.',400); const result=await authClient(session.access).rpc('pose_system_admin_ai_turn_calls',{p_turn_id:id}); return result.error?catalogDatabaseError(result.error):catalogJson({items:result.data||[]}); }
  const page=Math.max(1,Number(url.searchParams.get('page')||1)); const limit=25; const result=await authClient(session.access).rpc('pose_system_admin_ai_turns',{p_from:pFrom||new Date(Date.now()-30*86400000).toISOString(),p_to:pTo||new Date().toISOString(),p_search:url.searchParams.get('q')||null,p_limit:limit,p_offset:(page-1)*limit});
  return result.error?catalogDatabaseError(result.error):catalogJson({items:result.data||[],total:result.data?.[0]?.total_count||0,page,limit});
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
