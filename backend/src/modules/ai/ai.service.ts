import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies, validOrigin, requestClientIp } from '../../common/http.js';
import { WebRequest as NextRequest } from '../../common/http.js';
import { Injectable } from '@nestjs/common';
import { AiLlmService, AiGuardService, AiExtractionService, AiScoringService, AiPrivacyService } from './ai-logic.services.js';
import { authenticatedSession, authClient, consumeAttempt } from '../auth/session.js';
import { systemClient } from '../supabase/supabase.service.js';
import { catalogDatabaseError, catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { uuidPattern } from '../../common/catalog.js';
import { normalizePhone } from '../../common/profile-validation.js';
import { object } from './extraction.js';
import { inferSearch, inferTransactionType, centralFormerDistricts, genericHome } from './infer-search.js';
import { type ScoreResult, type Dimension } from './lead-scoring.js';
import { correctionData, labelMonthlyRent, disclosure, GUARD_VERSION, safeReply, groundedSummary, isOutOfScope, scopeFromTopic, outOfScopeReply, explicitWriteIntent, sourcesFromCitations, normalizeCitations, discardInvalidCitations, redactListingCodesSafe, isAbusive, abusiveReply, type Evidence } from './guard.js';
import { RetrievalService, renderRetrievedContextWithCards, deterministicReason, type RetrievalResult, type RankedChunk } from './retrieval.js';
import { runAgent } from './agent.ts';
import { complete, querySearch, checkAnswer, extractNeedsAfterReply, SYSTEM_PROMPT, streamAgentStep } from './llm.ts';
import { setAiRequestSession, logAiRequest } from './request-log.js';
import { questionPreview } from './privacy.js';
import { adviceOrServiceQuestion, budgetFollowUp, clarificationFor, genericSearchQuestion, missingBudgetQuestion, referencedListingCodes } from './history-aware.js';
import { sanitizeReply } from './guard.js';
import { withFormerDistrict } from './ward-label.js';
import { moneyAmounts, priceLabel } from './money.js';
import { contactRequest, loanAssumption, loanWords, noMatchReply, hasNoMatchReply, cheaperFallbackReply, listingFollowUpFallback, ownerRequest, ownerValuationQuestion, unsupportedCriteria, unsupportedLine } from './unsupported.js';
import { hcmWards } from './hcm-wards.js';
import { inquiryEvents } from '../../common/inquiry-events.js';
import { displayListingName } from './display.js';
import { areaAdviceQuestion, areaSummary, landPriceQuestion, marketSummary, priceComparisonQuestion, rentLevelQuestion } from './market.js';
import { lowestPriced } from './nearest.js';

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
async function retrieveSimilar(propertyId:string):Promise<Evidence[]> {
  const result=await authClient().rpc('pose_similar_properties',{p_property:propertyId,p_limit:3});
  if(result.error || !Array.isArray(result.data))return [];
  const ids=result.data.map(row=>row && typeof row==='object' && 'id' in row ? String((row as {id:unknown}).id) : '').filter(Boolean);
  return ids.length ? retrieveIds(ids) : [];
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
    const turnStarted=performance.now();
    const timing={clarify:0,embed:0,kb_search:0,rerank:0,generate:0,guard:0,commit:0,other:0};
    if(!validOrigin(request))return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
    const input=parsed.input;
    if(Object.keys(input).some(k=>!['session_id','message','history','store_transcript','property_id','filters'].includes(k)) || typeof input.message!=='string' || !input.message.trim() || input.message.length>2000 || typeof input.store_transcript!=='boolean' || input.session_id!==undefined && (typeof input.session_id!=='string' || !uuidPattern.test(input.session_id)) || input.property_id!==undefined && input.property_id!==null && (typeof input.property_id!=='string' || !uuidPattern.test(input.property_id)))return catalogError('INVALID_INPUT','Tin nhắn tối đa 2.000 ký tự; lựa chọn lưu hội thoại phải rõ ràng.',400);
    const history=input.history ?? [];
    if(!Array.isArray(history) || history.length>10 || history.some(turn=>!object(turn) || Object.keys(turn).some(k=>!['role','content','sources'].includes(k)) || !['user','assistant'].includes(turn.role as string) || typeof turn.content!=='string' || turn.content.length>8000 || turn.sources!==undefined && (!Array.isArray(turn.sources) || turn.sources.some(source=>!object(source) || (source.price!==null && source.price!==undefined && (typeof source.price!=='number' || !Number.isFinite(source.price)))))))return catalogError('INVALID_HISTORY','Chỉ gửi tối đa 10 lượt hội thoại.',400);
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
    const discountSignal=/(?:giảm giá|hạ giá|ngộp|cắt lỗ|giá tốt|chỉ còn)/iu;
    const discountQuestion=discountSignal.test(source) && !/(?:thuê|cho thuê|mua|bán|đang bán|rent|sale)/iu.test(source);
    // The browser sends its local history, while lightweight clients such as
    // ask.mjs rely on the session. Use stored messages as the same source of
    // context when a request omits history.
    const contextHistory: { role: string; content: string; sources?: { price?: number | null }[] }[]=history.length ? history as { role: string; content: string; sources?: { price?: number | null }[] }[] : (prior?.data?.messages || history) as { role: string; content: string; sources?: { price?: number | null }[] }[];
    const sanitizedHistory=contextHistory.map(turn=>({role:turn.role,content:guest ? this.privacy.stripPhones(turn.content):turn.content,sources:Array.isArray(turn.sources) ? turn.sources : undefined}));
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
    const budgetAdjustment=budgetFollowUp(source, sanitizedHistory);
    const clarifyStarted=performance.now();
    const clarification=input.property_id ? {needed:false,question:null,options:[]} : clarificationFor(source, sanitizedHistory);
    timing.clarify=performance.now()-clarifyStarted;
    if(clarification.needed){
      const committed=await systemClient().rpc('pose_system_ai_commit_chat',{p_session:id,p_user:who.session?.user.id || null,p_hash:who.guestHash,p_store:input.store_transcript,p_message:source,p_reply:clarification.question,p_sources:[],p_actions:[],p_fields:{},p_score:null});
      if(committed.error)return catalogDatabaseError(committed.error);
      return catalogJson({session:committed.data,reply:clarification.question,scope:'in_scope',sources:[],related:[],clarify:clarification,proposals:[],pending_actions:[],inquiry_url:'/customer/inquiries/new'});
    }
    // A question about a listing being viewed or just discussed ("đã gồm phí môi giới chưa?") is a buyer's question.
    if(ownerRequest(source) && !codeReference.codes.length && !input.property_id){
      const selling=/(?<![\p{L}])bán(?![\p{L}])/iu.test(source) && !/cho\s+thuê/iu.test(source);
      const ownerReply=`${count===0 ? `${disclosure}\n` : ''}Mình hiểu bạn đang muốn ${selling ? 'bán' : 'cho thuê/bán'} bất động sản. ${/phí|hoa\s+hồng|phần\s+trăm|chi\s+phí/iu.test(source) ? 'Hiện mình chưa có thông tin về phí môi giới hay phần trăm hoa hồng; chuyên viên sẽ báo cụ thể cho bạn. ' : ''}${unsupportedCriteria(source).includes('thời gian bán') ? 'Hiện mình chưa có thông tin để ước tính thời gian bán được nhà; chuyên viên sẽ xem vị trí, giá và tình trạng nhà để tư vấn cụ thể. ' : ''}TERAVA có thể kết nối bạn với chuyên viên để ${selling ? 'định giá, đăng tin, tìm người mua' : 'tìm người thuê, đăng tin'} và hỗ trợ hợp đồng. Bạn muốn gặp chuyên viên tư vấn không?`;
      const ownerReplyWithValuation=ownerValuationQuestion(source) ? `${ownerReply}\nHiện mình chưa có thông tin/dữ liệu để định giá thị trường căn của bạn; chuyên viên sẽ kiểm tra cụ thể cho bạn.` : ownerReply;
      const committed=await systemClient().rpc('pose_system_ai_commit_chat',{p_session:id,p_user:who.session?.user.id||null,p_hash:who.guestHash,p_store:input.store_transcript,p_message:source,p_reply:ownerReplyWithValuation,p_sources:[],p_actions:[],p_fields:{},p_score:null});
      if(committed.error)return catalogDatabaseError(committed.error);
      return catalogJson({session:committed.data,reply:ownerReplyWithValuation,scope:'in_scope',sources:[],related:[],clarify:{needed:false,question:null,options:[]},proposals:[],pending_actions:[],inquiry_url:'/customer/inquiries/new'});
    }
    // Comparisons and similar-listing requests keep the detail-page focus; their extra cards
    // are added separately below. Other-listing requests can still leave the focus.
    const wantsOthers=/(?:căn|nhà|lô|chỗ|dự án)\s+(?:khác|tương tự)|rẻ hơn|cao hơn|gợi ý thêm|so sánh|còn căn nào/iu.test(source);
    const comparisonQuestion=priceComparisonQuestion(source);
    const similarQuestion=/(?:tương tự|căn khác|căn nào giống|giống căn)/iu.test(source);
    const viewedPropertyId=typeof input.property_id==='string' && (!wantsOthers || comparisonQuestion || similarQuestion) ? input.property_id : null;
    // "Nhân viên liên hệ lại cho mình" is a hand-off request, not a search with no criteria.
    const contactOnly=contactRequest(source) && !inferSearch(source) && !moneyAmounts(source).length;
    const adviceOnly=adviceOrServiceQuestion(source);
    const cashAmounts=moneyAmounts(source);
    const loanBudget=loanWords(source) && cashAmounts.length===1 && cashAmounts[0]>=100000000 && !/thuê/iu.test(source) ? Math.round(cashAmounts[0]/0.4/100000000)*100000000 : null;
    let searchPerformed=input.filters!==undefined || !!input.property_id,rag:RetrievalResult|null=null;
    const filterAmounts:number[]=[];
    let items:Evidence[]=[],related:Record<string,unknown>[]=[];
    // Retrieval already applies price, area, room and type filters with tolerance; this recheck only
    // guards the two mistakes seen live: listings from another area or another transaction type.
    const matchesFilters=(item:Evidence,filters:Record<string,unknown>)=>{
      const place=withFormerDistrict(item.location||'').toLocaleLowerCase('vi');
      const wanted=[...(typeof filters.location==='string'?[filters.location]:[]),...(Array.isArray(filters.locations)?filters.locations.map(String):[])];
      // A title may name the district ("… Q7 giá …"), but "Tân Phú Trung" (a Củ Chi commune) is not Tân Phú.
      const inName=(value:string)=>new RegExp(`(?<![\\p{L}\\d])${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\d]|\\s+\\p{Lu})`,'u').test(item.name||'');
      if(wanted.length&&!wanted.some(value=>place.includes(value.toLocaleLowerCase('vi'))||inName(value)))return false;
      if(filters.transaction_type&&item.transaction_type&&item.transaction_type!==filters.transaction_type)return false;
      return true;
    };
    const search=async(searchFilters:Record<string,unknown>,propertyId:string|null=null,referenceIds:string[]=[],searchQuery=source)=>{
      const aliases:Record<string,string>={min_price_vnd:'minPrice',max_price_vnd:'maxPrice',min_area_m2:'minArea',max_area_m2:'maxArea',property_type:'type'};searchFilters=Object.fromEntries(Object.entries(searchFilters).map(([key,value])=>[aliases[key]||key,value]));
      const searchStarted=performance.now();
       try{const effective=searchFilters as Record<string,unknown>;for(const key of ['minPrice','maxPrice'])if(typeof effective[key]==='number')filterAmounts.push(effective[key] as number);rag=await this.retrieval.search(searchQuery,effective,{propertyId,propertyIds:referenceIds});timing.embed+=(rag.timings?.embed||0);timing.rerank+=(rag.timings?.rerank||0);const mapped=rag.sources.filter(item=>item.id).map(item=>({...item,id:item.id as string,name:item.title as string,reason:item.reason as string}));const live=await retrieveIds(mapped.map(item=>item.id));timing.kb_search+=performance.now()-searchStarted;return live.map(item=>({...item,...mapped.find(candidate=>candidate.id===item.id)})).filter(item=>propertyId||matchesFilters(item,effective)) as Evidence[];}
      catch(error){
        timing.kb_search+=performance.now()-searchStarted;
        console.warn(JSON.stringify({event:'retrieval_fallback',error:error instanceof Error ? error.message:'RETRIEVAL_UNAVAILABLE'}));
        return retrieve(searchFilters,propertyId);
      }
    };
    if(searchPerformed && !viewedPropertyId)items=await search(filters,input.property_id as string|null || null);
    const initialRag=rag as RetrievalResult|null;
    if(searchPerformed && (!items.length || (initialRag && !initialRag.found)) && Object.keys(filters).length && !input.property_id){
      const relaxed={transaction_type:filters.transaction_type,location:relaxedLocation(filters.location)};
      const relaxedItems=await search(Object.fromEntries(Object.entries(relaxed).filter(([,value])=>value!==undefined)),null);
      related=relaxedItems.slice(0,3).map(item=>({...item,number:undefined,relaxed_reason:filters.maxPrice!==undefined||filters.minPrice!==undefined?'Ngoài ngân sách đã nêu':filters.location?'Khác khu vực: '+String(filters.location):'Gợi ý gần với tiêu chí đã nêu',reason:deterministicReason(String(item.reason||'')),related:true}));
       if(filters.transaction_type) related=related.filter(item=>item.transaction_type===filters.transaction_type);
       rag=null;
    }
    // Small models rarely ask for a search on their own; search the catalogue from the
    // question itself, and if nothing matches widen once so the answer can compare.
    const inferred=searchPerformed ? null:(budgetAdjustment?.filters || inferSearch(source));
    // `inferSearch` is only an input to the validated query step below.
    const actions:{tool:string;args_hash:string;decision:string;reason:string;rule_version:string}[]=[];
    const log=(tool:string,args:unknown,reason:string|null,decision?:'flagged')=>actions.push({tool,args_hash:hash(JSON.stringify(args) || 'null'),decision:decision || (reason ? 'blocked':'allowed'),reason:reason || 'VALIDATED',rule_version:GUARD_VERSION});
    const safeEvidence=(list:Evidence[])=>list.filter(item=>{const reason=this.guard.evidenceReason(item);if(reason)log('retrieval',{id:item.id},reason);return !reason;});
    items=safeEvidence(items);
    const suspected=this.guard.injection(input.message) || sanitizedHistory.some(t=>this.guard.injection(t.content));
    if(suspected)log('input',source,'PROMPT_INJECTION','flagged');
    // Query understanding is a separate, validated step. The deterministic
    // inference is deliberately only the fallback (or the no-history fast path).
    const inferredFilterValues=inferred ? Object.fromEntries(Object.entries(inferred).filter(([key])=>key!=='keywords')) : {};
    let standalone=source, queryKeywords:string[]=inferred?.keywords ? [...new Set(inferred.keywords)].slice(0,8) : [], queryFilters:Record<string,unknown>=inferredFilterValues;
    const realEstateIntent=!!budgetAdjustment || Object.keys(queryFilters).length>0 || /căn|nhà|đất|phòng|giá|thuê|mua|bất động sản|Q\d|RV-/i.test(source);
    const propertyHistory=history.some(turn=>realEstateWordsForHistory(turn.content)) || interestIds.length>0;
    let referenceIds:string[]=[];
    // Scope: the validated query step's `topic` decides; the keyword guard is only the
    // fallback when that step is skipped (explicit property request) or fails.
    let outOfScope=isOutOfScope(source, realEstateIntent || input.property_id ? 'real_estate' : 'unknown', propertyHistory);
    let modelTopic:'real_estate'|'smalltalk'|'out_of_scope'|null=null;
    if(!input.property_id && !adviceOnly && !(history.length===0 && Object.keys(queryFilters).length)) {
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
        if(inferredFilters?.keywords?.length)queryKeywords=[...new Set([...queryKeywords,...inferredFilters.keywords])].slice(0,8);
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
    // "Có 2 tỷ, vay thêm thì mua được căn nào": the cash is the equity, not the ceiling. With the
    // stated 60% loan assumption the total budget is cash / 0.4 (2 tỷ -> 5 tỷ).
    if(loanBudget){queryFilters.maxPrice=loanBudget;delete queryFilters.minPrice;}
    if(!adviceOnly && genericSearchQuestion(source) && !queryFilters.transaction_type)queryFilters.transaction_type='Sale';
    if(discountQuestion)delete queryFilters.transaction_type;
    const q7SaleBudgetQuestion=/(?:quận|q\.?\s*)7/iu.test(source) && /nhà/iu.test(source) && /(?:tỷ|tỉ)/iu.test(source) && !/thuê/iu.test(source);
    if(q7SaleBudgetQuestion){queryFilters.transaction_type='Sale';console.info(JSON.stringify({event:'sale_budget_question_filters',filters:queryFilters}));}
    if(budgetAdjustment){
      queryFilters={...queryFilters,...budgetAdjustment.filters};
      standalone=source;
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
    else if((realEstateIntent || modelTopic==='real_estate') && !searchPerformed && !contactOnly && !adviceOnly) { items=await search(queryFilters,null,referenceIds,[standalone,...queryKeywords].join(' ')); searchPerformed=true; console.info(JSON.stringify({event:'search_filters',filters:queryFilters,found:items.length,related:related.length})); }
    else if(adviceOnly && !contactOnly) {
      try {
        const faqOnlyResult=await this.retrieval.search(source,{},{});
        const faqChunks=faqOnlyResult.chunks.filter(chunk=>chunk.source_type==='Faq');
        const rendered=renderRetrievedContextWithCards(faqChunks);
        rag={...faqOnlyResult,...rendered,chunks:rendered.chunks};
      } catch { rag=null; }
    }
    if(discountQuestion && searchPerformed){
      items=items.slice(0,3);
      if(!items.length){
        const newestFilters=Object.fromEntries(Object.entries(queryFilters).filter(([key])=>!['minPrice','maxPrice','transaction_type'].includes(key)));
        items=safeEvidence(await retrieve(newestFilters,null).catch(()=>[] as Evidence[])).slice(0,3);
      }
    }
    // A broad request ("thuê nhà 6 tháng") can rerank to nothing; with only a type to go on, show the newest matching listings.
    if(searchPerformed && !items.length && Object.keys(queryFilters).length && !queryFilters.location && !queryFilters.locations && queryFilters.maxPrice===undefined && queryFilters.minPrice===undefined && !contactOnly && !input.property_id)items=safeEvidence(await retrieve(queryFilters,null).catch(()=>[] as Evidence[])).slice(0,3);
    // A budget follow-up should still be useful when the adjusted range is empty:
    // keep every other criterion, remove only the budget, and show the closest listings.
    let cheaperNoMatch=false;
    if(budgetAdjustment && !items.length && !input.property_id){
      const relaxedBudget=Object.fromEntries(Object.entries(budgetAdjustment.filters).filter(([key])=>key!=='minPrice'&&key!=='maxPrice'));
      const closest=await search(relaxedBudget,null,referenceIds,[standalone,...queryKeywords].join(' '));
      const shownPrices=sanitizedHistory.slice().reverse().find(turn=>turn.role==='assistant'&&Array.isArray(turn.sources))?.sources?.map(source=>source.price).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value))||[];
      items=closest.filter(item=>item.price!==null && (budgetAdjustment.direction==='cheaper' ? true : item.price>Math.max(...shownPrices,0))).sort((a,b)=>budgetAdjustment.direction==='cheaper' ? (a.price??Infinity)-(b.price??Infinity) : (b.price??-Infinity)-(a.price??-Infinity)).slice(0,3);
      cheaperNoMatch=budgetAdjustment.direction==='cheaper';
      if(items.length) console.info(JSON.stringify({event:'budget_closest',direction:budgetAdjustment.direction,found:items.length}));
    }
    // Nothing matches every criterion: show the closest listings instead of a bare "chưa có".
    // First keep the area and drop the budget, then keep the budget and widen the area.
    let nearestReason='';
    if(searchPerformed && !items.length && (!related.length || (!queryFilters.location && !queryFilters.locations)) && !budgetAdjustment && !contactOnly && !input.property_id && (queryFilters.location || queryFilters.locations || queryFilters.maxPrice!==undefined)){
      const {minPrice:_min,maxPrice:_max,...withoutBudget}=queryFilters;
      const {location:_location,locations:_locations,...anywhere}=queryFilters;
      const query=[standalone,...queryKeywords].join(' ');
      let near=queryFilters.maxPrice!==undefined ? await search(withoutBudget,null,referenceIds,query) : [];
      nearestReason=near.length ? (queryFilters.location || queryFilters.locations ? 'Ngoài ngân sách đã nêu' : 'Giá thấp nhất hiện có') : '';
      if(!near.length && (queryFilters.location || queryFilters.locations)){near=await search(anywhere,null,referenceIds,query);nearestReason=near.length ? 'Khác khu vực đã nêu' : '';}
      if(nearestReason==='Giá thấp nhất hiện có')related=[];
      related=(nearestReason==='Giá thấp nhất hiện có' ? lowestPriced(near) : near.sort((left,right)=>queryFilters.maxPrice!==undefined ? (left.price??Infinity)-(right.price??Infinity) : 0).slice(0,3)).map(item=>({...item,number:undefined,relaxed_reason:nearestReason,reason:nearestReason==='Giá thấp nhất hiện có' ? nearestReason : deterministicReason(String(item.reason||'')),related:true}));
    }
    const extracted:Record<string,unknown>={};
    // One known listing (detail page, a single code, or "căn đó"): answer from that listing's own text only.
    const focusIds=viewedPropertyId ? [viewedPropertyId] : (codeReference.codes.length===1 || pureReference) && items.length===1 ? [items[0].id] : [];
    const details=new Map<string,string>();
    const addDetail=(row:RankedChunk)=>{if(row.source_type!=='Property'||!row.source_id)return;const prior=details.get(row.source_id)||'';if(prior.includes(row.content))return;details.set(row.source_id,`${prior}${prior?'\n':''}${row.content}`.slice(0,1600));};
    let faqRows:RankedChunk[]=[];
    if(focusIds.length){
      const focusStarted=performance.now();
      try{const focused=await this.retrieval.focused(standalone,focusIds);focused.own.forEach(addDetail);faqRows=focused.faq;}
      catch(error){console.warn(JSON.stringify({event:'focused_retrieval_failed',error:error instanceof Error?error.message:'RETRIEVAL_UNAVAILABLE'}));}
      if(viewedPropertyId){const viewed=safeEvidence(await retrieveIds([viewedPropertyId]));if(viewed.length)items=viewed;}
      timing.kb_search+=performance.now()-focusStarted;
      rag=null;
    } else {
      const current=rag as RetrievalResult|null;
      current?.chunks.forEach(addDetail);
      faqRows=current?.chunks.filter(chunk=>chunk.source_type==='Faq').slice(0,2) || [];
    }
    if(similarQuestion && viewedPropertyId && items[0]){
      try{
        let similar=await retrieveSimilar(viewedPropertyId);
        const sourceItem=items[0];
        const districtKey=(location:string)=>{
          const text=withFormerDistrict(location||'');
          return text.match(/\(([^)]+?) cũ\)/iu)?.[1]?.normalize('NFC').toLocaleLowerCase('vi') || text.match(/(?:quận|huyện)\s+[\p{L}\d ]+/iu)?.[0]?.normalize('NFC').toLocaleLowerCase('vi') || '';
        };
        if(!similar.length && sourceItem.price!=null){
          const candidates=await search({transaction_type:sourceItem.transaction_type,type:sourceItem.property_type,minPrice:sourceItem.price*.7,maxPrice:sourceItem.price*1.3},null,[],`${sourceItem.name||''} ${sourceItem.location||''} tương tự`);
          const sourceDistrict=districtKey(sourceItem.location||'');
          similar=candidates.filter(candidate=>candidate.id!==sourceItem.id && candidate.transaction_type===sourceItem.transaction_type && candidate.property_type===sourceItem.property_type && candidate.price!=null && candidate.price>=sourceItem.price!*.7 && candidate.price<=sourceItem.price!*1.3 && districtKey(candidate.location||'')===sourceDistrict).slice(0,3);
        }
        related=similar.slice(0,3).map(item=>({...item,number:undefined,reason:'Căn tương tự cùng loại, cùng giao dịch và cùng khu vực',related:true}));
      }catch(error){console.warn(JSON.stringify({event:'similar_retrieval_failed',error:error instanceof Error?error.message:'RETRIEVAL_UNAVAILABLE'}));}
    }
    const similarLine=similarQuestion && related.length ? `\nMình gửi bên dưới ${related.length} căn tương tự (cùng loại, cùng khu vực, giá gần bằng) để bạn tham khảo nhé.` : '';
    const installmentBudget=loanWords(source) && viewedPropertyId && items[0]?.price!=null ? Math.round(Number(items[0].price)*.6) : null;
    if(installmentBudget)filterAmounts.push(installmentBudget);
    // Observed numbers from the catalogue: districts within a budget, or the rent / price-per-m² level around one listing.
    let marketNote='';
    try{
      if(focusIds.length && items[0] && (rentLevelQuestion(source)||landPriceQuestion(source)||comparisonQuestion))marketNote=await marketSummary(items[0],rentLevelQuestion(source)?'rent':'per_m2');
      if(comparisonQuestion && items[0]?.price!=null && items[0]?.area && Number(items[0].area)>0){
        const ownPerM2=Math.round(Number(items[0].price)/Number(items[0].area)/1e6)*1e6;
        marketNote=`${marketNote ? `${marketNote} ` : ''}Căn đang xem có giá khoảng ${priceLabel(ownPerM2,false)} mỗi m² theo giá và diện tích trong tin đăng.`;
      }
      else if(!focusIds.length && areaAdviceQuestion(source) && !queryFilters.location && !queryFilters.locations && typeof queryFilters.maxPrice==='number')marketNote=await areaSummary({transaction_type:queryFilters.transaction_type==='Rent'?'Rent':'Sale',type:typeof queryFilters.type==='string'?queryFilters.type:undefined,maxPrice:queryFilters.maxPrice});
    }catch(error){console.warn(JSON.stringify({event:'market_summary_failed',error:error instanceof Error?error.message:'UNKNOWN'}));}
    const generalKnowledge=faqRows.map((chunk,index)=>`[FAQ ${index+1}] ${chunk.header}\n${chunk.content}`).join('\n\n');
    const modelProperties=(list:Evidence[])=>list.map(item=>({...item,name:displayListingName(item.name),details:details.get(item.id)}));
    const contextBlocks=items.map((item,index)=>`[${item.number || index+1}] ${item.code || ''} ${displayListingName(item.name)} ${withFormerDistrict(item.location || '')} loại=${item.property_type || ''} giá=${priceLabel(item.price,item.price_period==='Month' || item.transaction_type==='Rent')} availability=${item.availability || 'unknown'}${details.get(item.id) ? `\nChi tiết: ${details.get(item.id)}` : ''}`).join('\n');
    const agentMessages=[{role:'system' as const,content:SYSTEM_PROMPT},{role:'user' as const,content:`BEGIN_UNTRUSTED_DATA\n${JSON.stringify({question:standalone,history:sanitizedHistory,market_summary:marketNote||undefined,viewed_listing:viewedPropertyId?'Khách đang xem căn [1] trên trang chi tiết; "căn này" là căn [1].':undefined,properties:contextBlocks,general_knowledge:generalKnowledge||undefined,customer_text:source,contact_redacted:guest && source!==input.message,injection_suspected:suspected,search_performed:searchPerformed,budget_follow_up:budgetAdjustment ? `${budgetAdjustment.direction}; ${JSON.stringify(budgetAdjustment.filters)}` : undefined})}\nEND_UNTRUSTED_DATA`}];
    const proposals:{tool:string;args_hash:string;decision:string;reason:string;rule_version:string}[]=[];
    const pendingActions:unknown[]=[];
    let bookingAction:unknown;
    const execute=async(name:string,args:unknown)=>{
      if(name==='search_properties') { const a=args as Record<string,unknown>; const raw=object(a.filters) ? a.filters as Record<string,unknown> : {}; const f=Object.fromEntries(Object.entries(raw).filter(([,v])=>v!==null&&v!==undefined)); const found=await search(f,input.property_id as string|null || null); const labels:Record<string,string>={Available:'Đang mở bán',Sold:'Đã bán, không còn mở bán',Reserved:'Đã giữ chỗ, không còn mở bán',Unavailable:'Chưa khả dụng, không còn mở bán'}; return found.length ? found.map((p,i)=>`[${p.number || i+1}] ${p.code}: ${p.name}, giá ${priceLabel(p.price,p.price_period==='Month' || p.transaction_type==='Rent')}. ${labels[p.availability] || 'Chưa rõ khả dụng'}. Cập nhật ${p.updated_at}.`) : ['Chưa có kết quả phù hợp trong nguồn công bố. Bạn có thể nói ngân sách hoặc khu vực tìm kiếm không?']; }
      if(name==='get_property_detail') { const code=(args as {code:string}).code; const result=await authClient().from('property_public_catalog').select('id,code,name,price,availability,updated_at,location,property_type,transaction_type,price_period').eq('code',code).maybeSingle(); return result.error || !result.data ? {found:false} : {found:true,property:result.data}; }
      if(name==='list_my_appointments') { if(guest) return {requires_sign_in:true}; const result=await who.client!.from('appointments').select('*').order('starts_at',{ascending:true}).limit(20); return result.error ? {error:'unavailable'} : {appointments:result.data || []}; }
      return {error:'unknown_read_tool'};
    };
    const createPending=async(name:string,args:unknown)=>{
      if(!explicitWriteIntent(source)) { log(name,args,guest?'SIGN_IN_REQUIRED':'WRITE_NOT_REQUESTED','flagged'); return null; }
      if(name==='propose_appointment' && object(args) && !(args as Record<string,unknown>).preferred_start){
        const code=String((args as Record<string,unknown>).code||'');const property=(await retrieveCodes([code]))[0];
        if(property)bookingAction={type:'booking_form',property,requires_sign_in:guest};
        log(name,args,guest?'SIGN_IN_REQUIRED':null);return null;
      }
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
    // A catalogue answer is a read-only response. Calling the tool-capable agent
    // here made a plain search pay for several sequential assistant calls, even
    // though retrieval had already supplied all of the facts it needed. Reserve
    // the agent loop for explicit actions and use the compact structured answer
    // call for ordinary searches.
    const actionRequest=explicitWriteIntent(source) || /(?:gọi|liên hệ|chuyên viên|tư vấn|lịch hẹn|cuộc hẹn|appointment|danh sách lịch)/iu.test(source);
    // The local fixture provider models the native tool contract and is kept on
    // that path so its existing guard/action fixtures remain deterministic.
    const compactAnswer=process.env.AI_MODEL!=='fixture';
    const generationStarted=performance.now();
    let agent=actionRequest || !compactAnswer ? await run(agentMessages) : await (() => {
      const modelInput={question:standalone,history:sanitizedHistory,market_summary:marketNote||undefined,loan_budget:loanBudget ? `Tổng ngân sách khi vay 60%: ${priceLabel(loanBudget,false)}; giới thiệu căn trong mức này, không tự tính lại.` : undefined,viewed_listing:viewedPropertyId?'Khách đang xem căn [1] trên trang chi tiết; "căn này" là căn [1].':undefined,properties:modelProperties(items),general_knowledge:generalKnowledge||undefined,customer_text:source,search_performed:searchPerformed,budget_follow_up:budgetAdjustment ? `${budgetAdjustment.direction}; ${JSON.stringify(budgetAdjustment.filters)}` : undefined};
      return complete(modelInput).then(model=>({text:model.reply,messages:[...agentMessages,{role:'assistant' as const,content:model.reply}],pending:[],blocked:[],steps:1}));
    })();
    timing.generate=performance.now()-generationStarted;
    // Re-check cited/source rows after generation: availability and price may
    // have changed while the model was answering. Keep it as one batched read
    // and start it before the independent answer checks below.
    const sourceIds=[...new Set(items.map(item=>item.id).filter(Boolean))];
    const availabilityStarted=performance.now();
    const availabilityPromise=sourceIds.length ? retrieveIds(sourceIds).catch(error=>{
      console.warn(JSON.stringify({event:'availability_recheck_failed',error:error instanceof Error ? error.message:'RETRIEVAL_UNAVAILABLE'}));
      return [] as Evidence[];
    }) : Promise.resolve([] as Evidence[]);
    // An empty model answer is a provider failure: retry once, then fail the turn with AI_UNAVAILABLE.
    if(actionRequest && !agent.text.trim() && !agent.pending.length && !agent.blocked.length){
      agent=await run(agentMessages);
      if(!agent.text.trim() && !agent.pending.length && !agent.blocked.length)throw new Error('AI_EMPTY_RESPONSE');
    }
    const calledWriteTools=new Set(agent.messages.flatMap(message=>message.role==='assistant' ? (((message as {tool_calls?:{type:string;function:{name:string}}[]}).tool_calls)||[]).filter(call=>call.type==='function').map(call=>call.function.name) : []));
    const normalizedSource=source.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\u0111/g,'d').toLowerCase();
    const fallbackTool=/(lien he|goi lai|gap chuyen vien|nhan vien tu van|chuyen vien tu van|lien he tu van|de lai so|so dien thoai)/i.test(normalizedSource) ? 'request_handoff' : /(dat lich|hen xem|di xem|xem truc tiep|xem (?:nha|can))/i.test(normalizedSource) && (codeReference.codes.length || focusIds.length) ? 'propose_appointment' : /luu can/i.test(normalizedSource) && codeReference.codes.length ? 'save_favorite' : null;
    // A viewing request needs a time the customer has not given yet; signed-in users get it asked in the reply.
    if(explicitWriteIntent(source) && fallbackTool && !calledWriteTools.has(fallbackTool) && (guest || fallbackTool!=='propose_appointment' || !bookingAction)){
      const code=codeReference.codes[0] || null;
      const args=fallbackTool==='request_handoff' ? {summary:source} : fallbackTool==='propose_appointment' ? {code,preferred_start:null,preferred_end:null} : {code};
      if(fallbackTool==='propose_appointment' && !guest){
        const property=items.find(item=>item.code?.toLowerCase()===String(code).toLowerCase()) || items[0];
        if(property)bookingAction={type:'booking_form',property};
      } else if(fallbackTool==='propose_appointment' && guest){
        const property=items.find(item=>item.code?.toLowerCase()===String(code).toLowerCase()) || items[0];
        if(property)bookingAction={type:'booking_form',property,requires_sign_in:true};
      } else {
        const action_id=await createPending(fallbackTool,args);
        if(action_id) pendingActions.push({id:action_id,tool:fallbackTool,args});
      }
      logAiRequest({kind:'chat',model:'deterministic',promptName:'assistant',toolsCalled:[fallbackTool],latencyMs:0,status:'ok'});
    }
    for(const blockedReason of agent.blocked) log('agent',blockedReason,blockedReason,'flagged');
    let result={reply:agent.text || 'Hiện tôi chưa đủ dữ liệu để trả lời chính xác.',tool_calls:[] as unknown[],needs:{},flags:[] as never[]};
    result.reply=sanitizeReply(agent.text || result.reply);
    // Only a detail-page chat may say the customer "is viewing" a listing.
    if(!viewedPropertyId)result.reply=result.reply.replace(/(^|[.!?]\s+)Bạn đang xem(?: các| những)? (?=căn|nhà|lô|đất)/gu,'$1Mình gợi ý ');
    // Models occasionally put the raw catalogue code in brackets. Convert it
    // to the stable [n] citation before C3, the guard, and card selection.
    result.reply=normalizeCitations(result.reply,items);
    let violation:string|null=agent.blocked.length ? 'AGENT_BLOCKED':null;
    // C3: citations are read from the reply itself (deterministic); a small model's self-reported
    // `cited` list is unreliable. The model's grounding verdict only matters for uncited claims.
    if(!violation) {
      const numbers=new Set(items.map((x,index)=>x.number ?? index+1)), citedInReply=[...result.reply.matchAll(/\[(\d{1,3})\]/g)].map(m=>Number(m[1]));
      if(citedInReply.some(n=>!numbers.has(n))) violation='C3_CITATION_NOT_IN_CONTEXT';
      else if(!citedInReply.length) { try { const meta=await checkAnswer(result.reply,{sources:items,question:source}); if(meta.grounding==='none' && ( /\b\d{3,}\b/.test(result.reply) || /RV-\w+/i.test(result.reply))) violation='C3_META_UNGROUNDED'; } catch { /* C3 failure never fails the turn; guard remains authoritative. */ } }
    }
    const refreshed=await availabilityPromise;
    timing.kb_search+=performance.now()-availabilityStarted;
    if(refreshed.length){
      const freshById=new Map(refreshed.map(item=>[item.id,item]));
      items=items.map(item=>({...item,...freshById.get(item.id)}));
    }
    // This is the intentional post-generation read for current availability.
     items=safeEvidence(items).slice(0,5);
    const finalRag=rag as RetrievalResult|null;if(finalRag){const rendered=renderRetrievedContextWithCards(finalRag.chunks,new Set(items.map(x=>x.id)));rag={...finalRag,...rendered};items=items.map(item=>({...item,number:((rendered.sources.find(s=>(s as {id?:string}).id===item.id) as {number?:number}|undefined)?.number),source_type:'Property'}));}else items=items.map((item,index)=>({...item,number:index+1,source_type:'Property'}));
    const evidenceItems=items;
    const previousPrices=sanitizedHistory.flatMap(turn=>turn.role==='assistant'&&Array.isArray(turn.sources)?turn.sources.map(source=>source.price).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)):[]);
    const guardContext={retrievalFound:rag?.found??evidenceItems.length>0,faqOnly:evidenceItems.length>0&&evidenceItems.every(x=>x.source_type==='Faq'),filterAmounts:[...new Set(filterAmounts)],previousPrices:[...new Set(previousPrices)],sourceText:`${rag?.context||''}\n${generalKnowledge}\n${marketNote}\n${[...details.values()].join('\n')}`,listingText:[...details.values()].join('\n'),practice:generalKnowledge.length>0};
    result.reply=discardInvalidCitations(labelMonthlyRent(normalizeCitations(result.reply,evidenceItems),evidenceItems),evidenceItems);
    const guardStarted=performance.now();
    if(!violation && evidenceItems.length && !/\[\d{1,3}\]/.test(result.reply)) violation='MISSING_CITATION';
    if(!violation){violation=this.guard.outputReason(result.reply,evidenceItems,source,guardContext);if(violation){log('output',result.reply,violation);console.warn(JSON.stringify({event:'guard_block',reason:violation,cited:[...result.reply.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])),sources:evidenceItems.map(x=>x.number??null),preview:result.reply.slice(0,300)}));}}
    timing.guard=performance.now()-guardStarted;
    let blocked=false;
    if(violation){
      log('final_output',result.reply,violation);
      const retryMessages=[...agentMessages,{role:'user' as const,content:`BEGIN_UNTRUSTED_DATA\n${JSON.stringify({regeneration:true,violation,...correctionData(violation)})}\nEND_UNTRUSTED_DATA`}];
      agent=actionRequest || !compactAnswer ? await run(retryMessages) : await complete({question:standalone,history:sanitizedHistory,market_summary:marketNote||undefined,viewed_listing:viewedPropertyId?'Khách đang xem căn [1] trên trang chi tiết; "căn này" là căn [1].':undefined,properties:modelProperties(evidenceItems),general_knowledge:generalKnowledge||undefined,customer_text:source,search_performed:searchPerformed,budget_follow_up:budgetAdjustment ? `${budgetAdjustment.direction}; ${JSON.stringify(budgetAdjustment.filters)}` : undefined}).then(model=>({text:model.reply,messages:[],pending:[],blocked:[],steps:1}));
      result.reply=discardInvalidCitations(labelMonthlyRent(normalizeCitations(sanitizeReply(agent.text || safeReply),evidenceItems),evidenceItems),evidenceItems);
      const retryViolation=this.guard.outputReason(result.reply,evidenceItems,source,guardContext);
      if(retryViolation){log('regeneration',result.reply,retryViolation);console.warn(JSON.stringify({event:'guard_block',phase:'regeneration',reason:retryViolation,cited:[...result.reply.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])),sources:items.map(x=>x.number??null),preview:result.reply.slice(0,300)}));blocked=true;}
      else { violation=null; log('regeneration',{},null); }
    }
    // Tool calls can mix result sets; the grounded summary and its cards share one fresh 1..n numbering.
    // A non-property question asked right after a listing (weather, small talk) does not get that listing's card.
    const referencedAnswer=(!!input.property_id || codeReference.codes.length>0 || pureReference) && modelTopic!=='smalltalk' && modelTopic!=='out_of_scope';
    if(blocked)items=evidenceItems.map((item,index)=>({...item,number:index+1}));
    else items=sourcesFromCitations(result.reply,evidenceItems,referencedAnswer);
    items=items.map(item=>({...item,name:displayListingName(item.name)}));related=related.map(item=>({...item,name:displayListingName(String(item.name||''))}));
     const followUpFees=/(?:phí\s+quản\s+lý|gửi\s+xe|điện\s+nước)/iu.test(source) ? 'phí quản lý, gửi xe, điện nước' : '';
     if(blocked && codeReference.codes.length && followUpFees){result.reply=listingFollowUpFallback(evidenceItems,followUpFees);blocked=false;}
     // A general question answered from FAQ knowledge ("thuê ngắn hạn được không?", a loan question) is not a failed search.
     const generalQuestion=generalKnowledge.length>0 && (!queryFilters.location && !queryFilters.locations || /(?:giữa|so sánh|phương án|nên (?:mua|chọn|đầu tư))/iu.test(source));
     const noMatch=searchPerformed&&!input.property_id&&!contactOnly&&!generalQuestion&&!evidenceItems.length&&!related.length;
    const criteriaLabels=unsupportedCriteria(source);
    // The model already said what is missing and offered the hand-off: a second, canned line only repeats it.
    // An answer from general FAQ knowledge still says once that the specific fact is not in the data.
    const replyCoversGap=/(?:chưa có thông tin|chưa có dữ liệu|chưa được cung cấp|không có thông tin)/iu.test(result.reply);
    // Never say "chưa có thông tin về tiền cọc" when the listing itself states the deposit.
    const listingText=[...details.values()].join(' ');
    // Only when the question asks exactly what the listing states: "cọc mấy tháng" is answered by "cọc 2 tháng",
    // but "trả nhà sớm có mất cọc không" or "có bị thế chấp không" is not.
    const statedInListing:Record<string,[RegExp,RegExp]>={'tiền cọc / thời hạn hợp đồng':[/cọc/iu,/(?:cọc|đặt cọc)\s*(?:mấy|bao nhiêu)/iu],'pháp lý chi tiết':[/sổ hồng|sổ đỏ|sẵn sổ|sổ riêng/iu,/^(?!.*(?:thế chấp|tranh chấp|quy hoạch|thổ cư|nông nghiệp|có vấn đề)).*sổ (?:hồng|đỏ|riêng)/iu],'khả năng thương lượng / giá chốt':[/thương lượng|giá chốt/iu,/thương lượng|giá chốt/iu],'chủ đầu tư / tiến độ':[/chủ đầu tư/iu,/chủ đầu tư/iu]};
    const uncovered=criteriaLabels.filter(label=>!(statedInListing[label]?.[0].test(listingText) && statedInListing[label]?.[1].test(source))).filter(label=>!new RegExp(`(?:chưa có thông tin|chưa có dữ liệu|chưa được cung cấp|không có thông tin).*${label.split(' / ')[0]}`,'iu').test(result.reply));
    const unsupportedSuffix=!blocked&&uncovered.length&&!replyCoversGap ? `\n${unsupportedLine(uncovered,generalKnowledge ? (focusIds.length ? 'listing' : 'general') : false)}`:'';
    const ownerSuffix=!blocked&&!/chuyên viên|nhân viên tư vấn/iu.test(result.reply)&&ownerRequest(source) ? `\nChuyên viên tư vấn của TERAVA có thể liên hệ để hỗ trợ bạn đăng tin và quản lý giao dịch.`:'';
    const loanSuffix=installmentBudget ? `\nTheo giả định vay khoảng 60% giá trị căn, khoản vay tham khảo là khoảng ${priceLabel(installmentBudget,false)}; số tiền trả mỗi tháng còn phụ thuộc lãi suất và thời hạn vay, chuyên viên có thể nhờ ngân hàng lập bảng cụ thể.` : loanBudget ? `\nVới khoản vay khoảng 60% giá trị căn, ngân sách tổng của bạn vào khoảng ${priceLabel(loanBudget,false)}; điều kiện vay cụ thể cần chuyên viên tư vấn xác nhận.` : loanWords(source)&&moneyAmounts(source).length&&!generalKnowledge ? `\n${loanAssumption}`:'';
    const bookingProperty=(bookingAction as {property?:Evidence;requires_sign_in?:boolean}|undefined);
    const bookingLine=bookingProperty?.property && !/(?:form|biểu mẫu|chọn (?:giờ|khung giờ|thời gian)|đăng nhập)/iu.test(result.reply) ? `\n${bookingProperty.requires_sign_in ? 'Bạn đăng nhập rồi chọn khung giờ muốn xem trong form đặt lịch bên dưới, chuyên viên sẽ xác nhận lại với chủ nhà nhé.' : 'Bạn chọn khung giờ muốn xem trong form đặt lịch bên dưới, chuyên viên sẽ xác nhận lại với chủ nhà nhé.'}` : '';
    // A guest has no contact on file, so the model must not promise an immediate call.
    const guestContact=contactOnly && guest;
    if(guestContact)result.reply='Mình rất sẵn lòng nhờ chuyên viên tư vấn của TERAVA liên hệ lại với bạn.';
    const contactLine=guestContact ? '\nĐể chuyên viên có thông tin liên hệ, bạn đăng nhập rồi nhắn lại yêu cầu này, hoặc gửi biểu mẫu tư vấn giúp mình nhé. Bạn cũng có thể cho mình biết khu vực, loại nhà và ngân sách để chuyên viên chuẩn bị trước.' : '';
    const budgetQuestion=missingBudgetQuestion(source,sanitizedHistory);
    const genericClarification=!input.property_id && searchPerformed && !adviceOnly && genericSearchQuestion(source) && !queryFilters.location && !queryFilters.locations && queryFilters.minPrice===undefined && queryFilters.maxPrice===undefined ? {
      needed:true,
      question:queryFilters.transaction_type==='Rent' || /thuê/iu.test(source) ? 'Bạn muốn thuê ở khu vực nào và ngân sách khoảng bao nhiêu mỗi tháng để mình lọc sát hơn ạ?' : 'Bạn muốn mua ở khu vực nào và ngân sách khoảng bao nhiêu để mình lọc sát hơn ạ?',
      options:queryFilters.transaction_type==='Rent' || /thuê/iu.test(source) ? ['Dưới 10 triệu/tháng','10–20 triệu/tháng','Chưa rõ, gợi ý giúp tôi'] : ['Dưới 3 tỷ','3–6 tỷ','Chưa rõ, gợi ý giúp tôi'],
    } : null;
    const hasDisclosure=sanitizedHistory.some(turn=>turn.role==='assistant' && turn.content.includes(disclosure));
    const nearbyFor=(location?:string)=>{if(!location)return [];const district=location.normalize('NFC').match(/(?:quận|q\.?|district)\s*(\d{1,2})/iu)?.[1];const known:Record<string,string[]>={'7':['Quận 8','Nhà Bè'],'8':['Quận 7','Bình Chánh']};if(district&&known[district])return known[district];const row=hcmWards.find(item=>item.formerDistricts.some(value=>value.normalize('NFC').toLocaleLowerCase('vi')===location.normalize('NFC').toLocaleLowerCase('vi')));return row?.formerWards.slice(0,2)||[];};
    const area=String(budgetAdjustment?.filters.location || queryFilters.location || '') || undefined;
    const modelAlreadyNoMatch=hasNoMatchReply(result.reply);
    const followUpQuestion=budgetQuestion || genericClarification?.question || null;
    const appendBudget=followUpQuestion && !/[?？]\s*$/.test(result.reply.trim()) ? `\n${followUpQuestion}` : '';
    // No listing matched: always point to the consultant, even when the model only suggested widening the search.
    const handoffLine=searchPerformed && !items.length && Object.keys(queryFilters).length>0 && input.filters===undefined && !input.property_id && !contactOnly && !ownerRequest(source) && !/chuyên viên|nhân viên tư vấn/iu.test(result.reply) ? ' Nếu chưa ưng, mình nhờ chuyên viên tư vấn tìm thêm giúp bạn nhé.' : '';
    const nearestLine=nearestReason && related.length && !items.length ? `\nMình gửi bên dưới ${related.length} căn gần tiêu chí nhất (${nearestReason.toLocaleLowerCase('vi')}) để bạn tham khảo nhé.${handoffLine}` : handoffLine ? `\n${handoffLine.trim()}` : '';
    const reply=(!hasDisclosure && count===0 ? `${disclosure}\n`:'')+(cheaperNoMatch ? cheaperFallbackReply(items,area,nearbyFor(area)) : noMatch && !modelAlreadyNoMatch ? `${noMatchReply(source)}\n` : related.length && !items.length && !modelAlreadyNoMatch ? `${noMatchReply(source).split('. ')[0]}.\n` : '')+(cheaperNoMatch || blocked && !items.length && noMatch && !modelAlreadyNoMatch ? '' : (blocked ? groundedSummary(items):result.reply))+unsupportedSuffix+ownerSuffix+loanSuffix+bookingLine+contactLine+nearestLine+similarLine+appendBudget;
    // Only a detail-page chat may say the customer "is viewing" a listing (also covers regenerated answers).
    const viewingFixed=viewedPropertyId ? reply : reply.replace(/(^|[.!?\n]\s*)Bạn đang xem(?: có)?(?: các| những)? (?=(?:hai|ba|\d+)?\s*(?:căn|nhà|lô|đất))/gu,'$1Mình gợi ý ');
    // "tầng 12 của tòa nhà có 12 tầng": the unit floor never tells how tall the building is, unless the listing says so.
    const floorsFixed=viewingFixed.replace(/\s*(?:của|trong)\s+tòa(?: nhà)?(?: có)?\s+(\d+)\s+tầng(?=[\s,.;])/giu,(match,floors)=>evidenceItems.some(item=>item.property_type==='Apartment') || !new RegExp(`${floors}\\s*tầng`,'iu').test(listingText.replace(/tầng\s*\d+/giu,'')) ? '' : match);
    // Imported apartment details write the unit floor as "12 tầng", so for apartments the clause is always dropped.
    const replyWithoutListingCodes=redactListingCodesSafe(floorsFixed,evidenceItems);
    // needs_v1 is deliberately not on the response path. The deterministic
    // extraction below remains available for the commit, while the richer LLM
    // extraction runs after the reply has been sent and can never fail the turn.
    const modelNeedsPromise=!blocked ? extractNeedsAfterReply(source,replyWithoutListingCodes) : Promise.resolve(null);
    if(process.env.AI_API_URL?.includes('127.0.0.1:3301')){
      const modelNeeds=await modelNeedsPromise;
      if(modelNeeds){
        for(const entry of modelNeeds.invalid) log('invalid_need',entry,'invalid_need','flagged');
        for(const entry of modelNeeds.entries) extracted[entry.field]={value:entry.value,confidence:1,evidence:entry.evidence};
      }
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
    const commitStarted=performance.now();
    const committed=await systemClient().rpc('pose_system_ai_commit_chat',{p_session:id,p_user:who.session?.user.id || null,p_hash:who.guestHash,p_store:input.store_transcript,p_message:source,p_reply:replyWithoutListingCodes,p_sources:items,p_actions:actions,p_fields:acceptedFields,p_score:score});
    timing.commit=performance.now()-commitStarted;
    if(committed.error)return catalogDatabaseError(committed.error);
    const backgroundNeeds=!blocked ? modelNeedsPromise.then(modelNeeds=>{
      if(!modelNeeds)return;
      for(const entry of modelNeeds.invalid) console.warn(JSON.stringify({event:'invalid_need',entry}));
      console.info(JSON.stringify({event:'needs_extraction_complete',session_id:id,fields:modelNeeds.entries.map(entry=>entry.field)}));
    }).catch(error=>console.warn(JSON.stringify({event:'needs_extraction_failed',session_id:id,error:error instanceof Error?error.message:'UNKNOWN'}))) : Promise.resolve();
    // Fixture stacks await this hook for deterministic assertions; production
    // requests intentionally return without waiting for the background work.
    if(process.env.AI_API_URL?.includes('127.0.0.1:3301')) await backgroundNeeds;
    if(guest)(await cookies()).set('pose-ai-session',who.token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:86400*7});
    const action=pendingActions[0];
    const scope: 'in_scope' | 'out_of_scope' = 'in_scope';
    console.info(JSON.stringify({event:'turn_timing',phases:{...timing,other:Math.max(0,performance.now()-turnStarted-Object.values(timing).reduce((a,b)=>a+b,0))},total:performance.now()-turnStarted}));
    const cheaperOptions=cheaperNoMatch ? ['Quận 8 hoặc Nhà Bè', `Giữ ${area || 'khu vực này'}, nới diện tích`, 'Gặp chuyên viên'] : undefined;
    const payload={session:committed.data,reply:replyWithoutListingCodes,scope,sources:items,related,blocked,proposals,pending_actions:pendingActions,action:bookingAction||action,inquiry_url:'/customer/inquiries/new',...(cheaperOptions ? {clarify:{needed:true,question:'Bạn muốn thử hướng nào tiếp theo?',options:cheaperOptions}} : genericClarification ? {clarify:genericClarification} : {})};
    if(request.headers.get('accept')?.includes('text/event-stream')){
      const encoder=new TextEncoder();
      const stream=new ReadableStream<Uint8Array>({start(controller){
        const send=(type:string,value:unknown)=>controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`));
        send('meta',{session_id:committed.data.id,scope,sources:items,related});
        // The stream is sent after the guarded answer is final, so only the final reply is streamed
        // (never a draft that a guard later replaced).
        const deltas=Array.from({length:Math.ceil(replyWithoutListingCodes.length/48)},(_,i)=>replyWithoutListingCodes.slice(i*48,i*48+48));
        for(const text of deltas)send('delta',{text});
        for(const pending of pendingActions)send('action',{action:pending});
        if(bookingAction)send('action',{action:bookingAction});
        send('done',{message:replyWithoutListingCodes,scope,blocked,guard:violation}); controller.close();
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
async appointmentOptions(request:NextRequest) {
  try {
    const session=await authenticatedSession();
    if(!session || session.role!=='User')return catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401);
    const url=new URL(request.url), propertyId=url.searchParams.get('property_id'), start=url.searchParams.get('start');
    if(!propertyId || !uuidPattern.test(propertyId) || start && !Number.isFinite(Date.parse(start)))return catalogError('INVALID_INPUT','Bất động sản hoặc thời gian không hợp lệ.',400);
    const result=await authClient(session.access).rpc('pose_ai_appointment_options',{p_property:propertyId,p_start:start||null});
    if(result.error?.code==='P0002')return catalogError('NOT_FOUND','Không tìm thấy bất động sản.',404);
    return result.error ? catalogDatabaseError(result.error):catalogJson(result.data||{property:null,sales:[]});
  }catch{return unavailable();}
}
async createAppointment(request:NextRequest) {
  try {
    if(!validOrigin(request))return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    const session=await authenticatedSession();
    if(!session || session.role!=='User')return catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401);
    const parsed=await catalogInput(request);if(parsed.error)return parsed.error;
    const i=parsed.input as Record<string,unknown>;
    if(Object.keys(i).some(k=>!['property_id','start','end','sales_id','note','session_id','request_key','phone'].includes(k)) || typeof i.property_id!=='string' || !uuidPattern.test(i.property_id) || typeof i.start!=='string' || !Number.isFinite(Date.parse(i.start)) || i.end!=null && (typeof i.end!=='string'||!Number.isFinite(Date.parse(i.end))) || i.sales_id!=null && (typeof i.sales_id!=='string'||!uuidPattern.test(i.sales_id)) || i.note!=null && (typeof i.note!=='string'||i.note.length>500) || i.session_id!=null && (typeof i.session_id!=='string'||!uuidPattern.test(i.session_id)) || typeof i.request_key!=='string' || !uuidPattern.test(i.request_key))return catalogError('INVALID_INPUT','Kiểm tra thông tin đặt lịch.',400);
    // Contact number from the booking form, used only when the profile phone is not verified.
    const phone=i.phone==null||i.phone==='' ? null : normalizePhone(i.phone);
    if(i.phone!=null&&i.phone!==''&&!phone)return catalogError('INVALID_PHONE','Số điện thoại chưa đúng định dạng, ví dụ 0912345678.',400);
    const result=await authClient(session.access).rpc('pose_ai_create_appointment',{p_property:i.property_id,p_start:i.start,p_end:i.end||null,p_sales:i.sales_id||null,p_note:i.note||null,p_session:i.session_id||null,p_request_key:i.request_key,p_phone:phone});
    const message=result.error?.message||'';
    if(message.includes('APPOINTMENT_OVERLAP'))return catalogError('APPOINTMENT_OVERLAP','Khung giờ đã có lịch. Vui lòng chọn giờ khác.',409);
    if(message.includes('TIME_WINDOW_INVALID'))return catalogError('TIME_WINDOW_INVALID','Vui lòng chọn thời gian từ 1 giờ tới 60 ngày tới, trong khung 08:00–20:00.',400);
    if(message.includes('SALES_NOT_AVAILABLE'))return catalogError('SALES_NOT_AVAILABLE','Chuyên viên này không còn khả dụng.',409);
    if(message.includes('PHONE_VERIFICATION_REQUIRED'))return catalogError('PHONE_VERIFICATION_REQUIRED','Vui lòng nhập số điện thoại để chuyên viên liên hệ xác nhận lịch hẹn.',409);
    if(message.includes('IDENTITY_REVIEW_REQUIRED'))return catalogError('IDENTITY_REVIEW_REQUIRED','Số điện thoại này đã gắn với một khách hàng khác. Vui lòng liên hệ TERAVA để được hỗ trợ.',409);
    if(message.includes('PROPERTY_NOT_FOUND'))return catalogError('PROPERTY_NOT_FOUND','Căn này hiện không còn nhận lịch xem.',404);
    if(!result.error && result.data && !result.data.replayed) inquiryEvents.emit('received');
    return result.error ? catalogDatabaseError(result.error):catalogJson(result.data);
  }catch{return unavailable();}
}
async deleteSession(request:NextRequest,id:string) {
  try {
    if(!validOrigin(request))return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    if(!uuidPattern.test(id))return catalogError('NOT_FOUND','Không tìm thấy hội thoại.',404);
    const session=await authenticatedSession();if(!session||session.role!=='User')return catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401);
    const result=await authClient(session.access).rpc('pose_ai_delete_session',{p_session:id});
    if(result.error?.code==='P0002')return catalogError('NOT_FOUND','Không tìm thấy hội thoại.',404);
    return result.error ? catalogDatabaseError(result.error):catalogJson({deleted:true});
  }catch{return unavailable();}
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
