import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { CHUNK_OVERLAP, CHUNK_SINGLE_MAX, CHUNK_SIZE, cleanKnowledgeText, propertyChunks, splitKnowledgeText } from '../src/modules/ai/chunking.js';
import { embeddingConfig, EmbeddingService, EMBEDDING_BATCH_MAX } from '../src/modules/ai/embeddings.js';
import { applyThresholds, currentModelRows, deterministicReason, reciprocalRankFusion, renderRetrievedContext, type RankedChunk } from '../src/modules/ai/retrieval.js';
import { indexNeedsEmbedding } from '../src/modules/ai/indexing.js';
import { cosineSimilarity, meanVector, ruleSimilarProperties } from '../src/modules/ai/similar.js';

const env={...process.env};
afterEach(()=>{process.env={...env};});
const row=(id:string,source='p1',extra:Partial<RankedChunk>={}):RankedChunk=>({chunk_id:id,document_id:`d-${source}`,source_id:source,source_type:'Property',header:'h',content:'c',vector_rank:null,text_rank:null,similarity:null,...extra});

describe('knowledge chunking',()=>{
 it('keeps a clean short description in one chunk with the required header',()=>{
  const source={code:'RV-A0805',name:'Căn hộ Riverside',location:'Thủ Đức',property_type:'Apartment',transaction_type:'Sale' as const,description:'Căn hộ thoáng, gần chợ và có hẻm xe hơi.',project_name:'Riverside',amenities:'Hồ bơi'};
  const chunks=propertyChunks(source);expect(chunks).toHaveLength(1);expect(chunks[0].header).toBe('Mã RV-A0805 · Căn hộ Riverside · Thủ Đức · Apartment · Bán');expect(chunks[0].embedded).toContain(chunks[0].header);
 });
 it('uses one chunk through the 1200-character boundary',()=>{expect(splitKnowledgeText('a '.repeat(600).trim())).toHaveLength(1);expect('a '.repeat(600).trim().length).toBeLessThanOrEqual(CHUNK_SINGLE_MAX);});
 it('splits long text without breaking words and overlaps complete sentences',()=>{
  const text=Array.from({length:35},(_,i)=>`Câu số ${i} mô tả căn nhà với nhiều thông tin hữu ích và rõ ràng.`).join(' '),chunks=splitKnowledgeText(text);
  expect(chunks.length).toBeGreaterThan(2);expect(chunks.every(chunk=>chunk.length<=CHUNK_SIZE+CHUNK_OVERLAP)).toBe(true);expect(chunks.every(chunk=>!/^\S*\s/.test(chunk)||!chunk.startsWith('ả'))).toBe(true);
  expect(chunks[1].split(' ').slice(0,3).join(' ')).toMatch(/Câu số/);
 });
 it('removes HTML, emoji bullets, PII, broker lines and price sentences',()=>{
  const clean=cleanKnowledgeText('<p>🏠 Nhà có hẻm xe hơi.</p> Giá 3,5 tỷ. Liên hệ anh Tuấn 090-123-4567. email broker@example.vn. https://example.vn');
  expect(clean).toContain('hẻm xe hơi');expect(clean).not.toMatch(/3,5|090|broker|example|Liên hệ/i);
 });
});

describe('embeddings',()=>{
 it('joins a base URL, supports localhost without a key, and defaults to 1024 dimensions',()=>{process.env.AI_EMBED_API_URL='http://127.0.0.1:1234/v1/';process.env.AI_EMBED_MODEL='bge-m3';delete process.env.AI_EMBED_API_KEY;const config=embeddingConfig()!;expect(config.url).toBe('http://127.0.0.1:1234/v1/embeddings');expect(config.dimensions).toBe(1024);expect(config.openai).toBe(false);});
 it('batches at 64 and sends dimensions only to OpenAI',async()=>{
  let calls=0,max=0,hasDimensions=false;const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);calls++;max=Math.max(max,body.input.length);hasDimensions||='dimensions'in body;res.setHeader('content-type','application/json');res.end(JSON.stringify({data:body.input.map((_:string,index:number)=>({index,embedding:Array(4).fill(index+1)}))}));});server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();
  process.env.AI_EMBED_API_URL=`http://127.0.0.1:${typeof address==='object'&&address?.port}/v1`;process.env.AI_EMBED_MODEL='fake';process.env.AI_EMBED_DIMENSIONS='4';
  try{const result=await new EmbeddingService().embed(Array(EMBEDDING_BATCH_MAX+1).fill('x'));expect(result?.vectors).toHaveLength(65);expect(calls).toBe(2);expect(max).toBe(64);expect(hasDimensions).toBe(false);}finally{server.close();}
 });
});

describe('hybrid ranking',()=>{
 it('merges vector and text ranks with reciprocal rank fusion',()=>{const merged=reciprocalRankFusion([row('a','p1',{vector_rank:1,similarity:.8}),row('b','p2',{vector_rank:2,similarity:.7}),row('b','p2',{text_rank:1}),row('c','p3',{text_rank:2})]);expect(merged[0].chunk_id).toBe('b');expect(merged[0].rrf).toBeCloseTo(1/62+1/61);});
 it('applies minimum and relative thresholds and limits two chunks per property',()=>{const rows=[row('a','p1',{vector_rank:1,similarity:.8}),row('b','p1',{vector_rank:2,similarity:.75}),row('c','p1',{vector_rank:3,similarity:.74}),row('d','p2',{vector_rank:4,similarity:.55}),row('e','p3',{text_rank:1,similarity:null})];expect(applyThresholds(rows,{minScore:.35,relativeGap:.15,noAnswerScore:.3,topK:5}).map(x=>x.chunk_id)).toEqual(['a','b','e']);});
 it('returns no answer below the threshold when full text found nothing',()=>{expect(applyThresholds([row('a','p1',{vector_rank:1,similarity:.25})],{minScore:.2,relativeGap:.15,noAnswerScore:.3,topK:5})).toEqual([]);});
 it('keeps full-text fallback and isolates vectors by model through ranked input',()=>{expect(applyThresholds([row('text','faq',{text_rank:1})],{minScore:.5,relativeGap:.1,noAnswerScore:.5,topK:5})).toHaveLength(1);const current=[row('current','p1',{vector_rank:1,similarity:.7})];expect(reciprocalRankFusion(current).map(x=>x.chunk_id)).not.toContain('old-model');});
 it('filters vector candidates to the current model while retaining text candidates',()=>{const rows=[row('new','p1',{embed_model:'bge-m3',vector_rank:1}),row('old','p2',{embed_model:'old',vector_rank:1}),row('text','faq',{text_rank:1})];expect(currentModelRows(rows,'bge-m3').map(x=>x.chunk_id)).toEqual(['new','text']);});
 it('keeps citation numbers stable per property after a sold result is removed',()=>{const first=row('a','p1',{content:'first'}),second=row('b','p1',{content:'second'}),sold=row('c','p2',{availability:'Sold'});const rendered=renderRetrievedContext([first,second,sold],new Set(['p1']));expect(rendered.sources.map(x=>x.number)).toEqual([1]);expect(rendered.chunks.map(x=>x.citation_number)).toEqual([1,1]);expect(rendered.context.match(/\[1\]/g)).toHaveLength(2);});
});

describe('index idempotency',()=>{it('skips only when both hash and model match',()=>{expect(indexNeedsEmbedding({content_hash:'h',embed_model:'m'},'h','m')).toBe(false);expect(indexNeedsEmbedding({content_hash:'h',embed_model:'m'},'h','other')).toBe(true);expect(indexNeedsEmbedding({content_hash:'h',embed_model:null},'h',null)).toBe(false);});});
describe('similar properties',()=>{it('computes a mean vector and cosine ranking primitives',()=>{expect(meanVector([[1,3],[3,1]])).toEqual([2,2]);expect(cosineSimilarity([1,0],[1,0])).toBe(1);expect(cosineSimilarity([1,0],[0,1])).toBe(0);});it('uses the deterministic rule fallback constraints',()=>{const source={id:'a',district:'Q7',property_type:'Apartment',transaction_type:'Rent',price:100};expect(ruleSimilarProperties(source,[{id:'b',district:'Q7',property_type:'Apartment',transaction_type:'Rent',price:120},{id:'c',district:'Q7',property_type:'House',transaction_type:'Rent',price:100},{id:'a',district:'Q7',property_type:'Apartment',transaction_type:'Rent',price:100}]).map(item=>item.id)).toEqual(['b']);});it('extracts a short reason without price and PII',()=>{expect(deterministicReason('Gần chợ, sổ hồng riêng. Giá 3 tỷ, gọi 0901234567.')).toBe('Gần chợ, sổ hồng riêng.');});});
