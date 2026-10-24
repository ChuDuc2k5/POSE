import { Injectable } from '@nestjs/common';
import { systemClient } from '../supabase/supabase.service.js';
import { EmbeddingService } from './embeddings.js';

export type RetrievalFilters={transaction_type?:'Sale'|'Rent';type?:string;minPrice?:number;maxPrice?:number;location?:string};
export type RetrievalContext={propertyId?:string|null;propertyIds?:string[]};
export type RankedChunk={chunk_id:string;document_id:string;source_id:string|null;source_type:'Property'|'Faq';header:string;content:string;vector_rank:number|null;text_rank:number|null;similarity:number|null;embed_model?:string|null;rrf?:number;code?:string;name?:string;price?:number|null;availability?:string;updated_at?:string;location?:string;property_type?:string;transaction_type?:string;price_period?:string};
export type RetrievalResult={found:boolean;grounding:'hybrid'|'fulltext'|'none';chunks:RankedChunk[];context:string;sources:Record<string,unknown>[]};
export function currentModelRows(rows:RankedChunk[],model:string){return rows.filter(row=>row.embed_model===model||row.text_rank!=null);}
export function reciprocalRankFusion(rows:RankedChunk[],k=60){
  const merged=new Map<string,RankedChunk>();
  for(const row of rows){const prior=merged.get(row.chunk_id);const score=(row.vector_rank?1/(k+row.vector_rank):0)+(row.text_rank?1/(k+row.text_rank):0);if(prior){prior.rrf=(prior.rrf||0)+score;prior.vector_rank??=row.vector_rank;prior.text_rank??=row.text_rank;prior.similarity??=row.similarity;}else merged.set(row.chunk_id,{...row,rrf:score});}
  return [...merged.values()].sort((a,b)=>(b.rrf||0)-(a.rrf||0)||a.chunk_id.localeCompare(b.chunk_id));
}
export function applyThresholds(rows:RankedChunk[],options?:{minScore?:number;relativeGap?:number;noAnswerScore?:number;topK?:number}){
  const min=options?.minScore??Number(process.env.AI_RAG_MIN_SCORE||0.35),gap=options?.relativeGap??Number(process.env.AI_RAG_RELATIVE_GAP||0.15),noAnswer=options?.noAnswerScore??Number(process.env.AI_RAG_NO_ANSWER_SCORE||0.30),topK=options?.topK??Number(process.env.AI_RAG_TOP_K||5);
  const best=Math.max(0,...rows.map(row=>row.similarity??0)),hasText=rows.some(row=>row.text_rank!=null);
  if(best<noAnswer&&!hasText)return [];
  const counts=new Map<string,number>();
  return rows.filter(row=>row.text_rank!=null||(row.similarity!=null&&row.similarity>=min&&row.similarity>=best-gap)).filter(row=>{const key=row.source_id||row.document_id,n=counts.get(key)||0;if(n>=2)return false;counts.set(key,n+1);return true;}).slice(0,Math.max(1,Math.min(20,topK)));
}
@Injectable()
export class RetrievalService{
  constructor(private readonly embeddings:EmbeddingService){}
  async search(query:string,filters:RetrievalFilters={},context:RetrievalContext={}):Promise<RetrievalResult>{
    let vector:string|null=null,model:string|null=null;
    try{const embedded=await this.embeddings.embed([query]);if(embedded){model=embedded.model;vector=`[${embedded.vectors[0].join(',')}]`;}}catch{/* Full-text is the safe fallback. */}
    const result=await systemClient().rpc('pose_system_search_knowledge',{p_query:query,p_embedding:vector,p_embed_model:model,p_filters:filters,p_context:[...(context.propertyIds||[]),...(context.propertyId?[context.propertyId]:[])]});
    if(result.error)throw new Error(result.error.message||'RETRIEVAL_UNAVAILABLE');
    const ranked=reciprocalRankFusion((result.data||[]) as RankedChunk[]),chunks=applyThresholds(ranked);
    if(!chunks.length)return {found:false,grounding:'none',chunks:[],context:'',sources:[]};
    let tokenBudget=2500*4,number=0;const selected:RankedChunk[]=[],blocks:string[]=[],sources:Record<string,unknown>[]=[];
    for(const row of chunks){const live=row.source_type==='Property'?`Giá hiện tại: ${row.price==null?'chưa công bố':`${row.price} VND${row.price_period==='Month'?'/tháng':''}`} · Tình trạng: ${row.availability} · Cập nhật: ${row.updated_at}`:'';const block=`[${number+1}] ${row.header}\n${row.content}${live?`\n${live}`:''}`;if(block.length>tokenBudget)continue;tokenBudget-=block.length;number++;selected.push(row);blocks.push(block);sources.push({number,id:row.source_id,code:row.code,title:row.name||row.header,price:row.price,availability:row.availability,updated_at:row.updated_at,location:row.location,property_type:row.property_type,transaction_type:row.transaction_type,price_period:row.price_period});}
    return {found:!!selected.length,grounding:vector?'hybrid':'fulltext',chunks:selected,context:blocks.join('\n\n'),sources};
  }
}
