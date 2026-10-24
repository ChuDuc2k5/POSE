import { Injectable, Logger } from '@nestjs/common';
import { logAiRequest } from './request-log.js';

export const EMBEDDING_BATCH_MAX=64;
let warned=false;
export type EmbeddingConfig={url:string;key?:string;model:string;dimensions:number;timeout:number;openai:boolean};
export function embeddingConfig():EmbeddingConfig|null{
  const base=(process.env.AI_EMBED_API_URL || process.env.AI_API_URL || '').trim();
  const model=(process.env.AI_EMBED_MODEL || '').trim();
  const key=(process.env.AI_EMBED_API_KEY ?? process.env.AI_API_KEY)?.trim();
  if(!base || !model){if(!warned){warned=true;new Logger('EmbeddingService').warn('Embedding chưa cấu hình; truy xuất dùng toàn văn.');}return null;}
  const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!key&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return null;
  url.pathname=url.pathname.replace(/\/+$/,'');if(!url.pathname.endsWith('/embeddings'))url.pathname+='/embeddings';
  const raw=Number(process.env.AI_EMBED_DIMENSIONS||1024),dimensions=Number.isInteger(raw)&&raw>0&&raw<=4096?raw:1024;
  const configured=Number(process.env.AI_TIMEOUT_MS||60000),timeout=Math.min(120000,Math.max(5000,Number.isFinite(configured)?Math.round(configured):60000));
  return {url:url.toString(),key:key||undefined,model,dimensions,timeout,openai:url.hostname==='api.openai.com'};
}
@Injectable()
export class EmbeddingService{
  config(){return embeddingConfig();}
  async embed(inputs:string[]){
    const config=this.config();if(!config) return null;
    const started=Date.now();
    const vectors:number[][]=[];
    for(let offset=0;offset<inputs.length;offset+=EMBEDDING_BATCH_MAX){
      const input=inputs.slice(offset,offset+EMBEDDING_BATCH_MAX);
      const response=await fetch(config.url,{method:'POST',headers:{'Content-Type':'application/json',...(config.key?{Authorization:`Bearer ${config.key}`}:{})},body:JSON.stringify({model:config.model,input,...config.openai?{dimensions:config.dimensions}:{}}),signal:AbortSignal.timeout(config.timeout)});
      if(!response.ok)throw new Error('EMBEDDING_UNAVAILABLE');
      const body=await response.json() as {data?:{index:number;embedding:number[]}[]};
      const batch=(body.data||[]).sort((a,b)=>a.index-b.index).map(item=>item.embedding);
      if(batch.length!==input.length||batch.some(vector=>vector.length!==config.dimensions||vector.some(value=>!Number.isFinite(value))))throw new Error('INVALID_EMBEDDING');
      vectors.push(...batch);
    }
    logAiRequest({kind:'embed',model:config.model,latencyMs:Date.now()-started,status:'ok'});
    return {model:config.model,vectors};
  }
}
