import '../dist/env.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RetrievalService, applyThresholds } from '../dist/modules/ai/retrieval.js';
import { rerank } from '../dist/modules/ai/rerank.js';
import { EmbeddingService } from '../dist/modules/ai/embeddings.js';
import { inferSearch } from '../dist/modules/ai/infer-search.js';
import { querySearch, getAiUsage, resetAiUsage } from '../dist/modules/ai/llm.js';

const fixture = JSON.parse(await readFile(new URL('../test/fixtures/rag-eval-real.json', import.meta.url)));
const snapshot = JSON.parse(await readFile(process.env.RAG_SNAPSHOT || 'C:/Users/Admin/POSE-tasks/rag-real-snapshot.json', 'utf8'));
if (fixture.length !== 40) throw new Error(`Expected 40 questions, got ${fixture.length}`);
const noAnswers = fixture.filter(item => !item.expected_codes.length).length;
if (noAnswers < 8) throw new Error('Expected at least eight no-answer questions');
const words = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || [];
for (const item of fixture) for (const code of item.expected_codes) if (!snapshot.some(row => row.code === code)) throw new Error(`Missing snapshot target ${code}`);

const fake = process.env.RAG_EVAL_FAKE === '1';
const useRerank = process.argv.includes('--rerank');
const cacheFile = join(tmpdir(), `pose-rag-eval-${useRerank ? 'rerank' : 'thresholds'}.json`);
let fileCache = {};
try { fileCache = JSON.parse(await readFile(cacheFile, 'utf8')); } catch {}
const service = fake ? new RetrievalService(new EmbeddingService(), async ({ p_query }) => {
  const query = words(p_query);
  const rows = snapshot.map((property, index) => {
    const content = words(`${property.header} ${property.content}`);
    const overlap = query.filter(token => content.includes(token)).length;
    return { chunk_id: `fake-${index}`, document_id: `fake-doc-${index}`, source_id: property.id, source_type: 'Property', header: property.header, content: property.content, vector_rank: null, text_rank: overlap ? Math.max(1, 20 - overlap * 3) : null, similarity: null, code: property.code, name: property.name, location: property.location, property_type: property.property_type, transaction_type: property.transaction_type, price: property.price, price_period: property.price_period, availability: property.availability };
  }).filter(row => row.text_rank);
  return { data: rows };
}) : new RetrievalService(new EmbeddingService());
const snapshotIds = new Map(snapshot.map(row => [row.code, row.id]));
const contextIds = codes => (codes || []).map(code => snapshotIds.get(code)).filter(Boolean);
const ordinal = (text, count=0) => {
  const numbered = [...String(text).matchAll(/\b(?:căn|can|lô|lo|khu|mẫu|mau)\s+(?:thứ|thu)\s+(\d+)\b/giu)].map(match => Number(match[1]));
  if (numbered.length) return numbered;
  if (/\b(?:các căn|cac can|các lô|cac lo)\b.*\b(?:đã nêu|da neu)\b/iu.test(text)) return Array.from({ length: count }, (_, index) => index + 1);
  if (/\b(?:căn đó|can do|khu đất này|khu dat nay|vừa nói|vua noi|vừa nhắc|vua nhac|kết quả vừa rồi|ket qua vua roi|tìm tiếp|tim tiep)\b/iu.test(text)) return count ? [count] : [];
  return [];
};
const cache = new Map();
const retrievalCache = new Map();
const rerankCache = new Map();
const latencies = [];
const rerankLatencies = [];
let rerankFallbacks = 0;

async function prepare(item) {
  const previous = item.context?.previous_expected_codes || [];
  let query = { standalone_question: item.question, filters: inferSearch(item.question) || {}, refers_to_previous: ordinal(item.question, previous.length) };
  if (process.argv.includes('--llm')) query = await querySearch(item.question, [{ role: 'assistant', content: previous.map((code, index) => `[${index + 1}] ${code}`).join('\n') }]);
  const refs = query.refers_to_previous.map(index => previous[index - 1]).filter(Boolean);
  const filters = Object.fromEntries(Object.entries(query.filters || {}).map(([key, value]) => [key === 'property_type' ? 'type' : key === 'min_price_vnd' ? 'minPrice' : key === 'max_price_vnd' ? 'maxPrice' : key, value]).filter(([, value]) => value !== null && value !== undefined));
  const embedding = cache.has(item.question) ? cache.get(item.question) : await service.embed(query.standalone_question);
  cache.set(item.question, embedding);
  return { query, filters, refs, embedding };
}

async function evaluate(prepared, min, no, textRank, modelRerank = useRerank) {
  const thresholdOptions = { minScore: min, noAnswerScore: no, minTextRank: textRank };
  let hit = 0, mrr = 0, truePositive = 0, falsePositive = 0;
  for (let i = 0; i < fixture.length; i++) {
    const item = fixture[i], plan = prepared[i];
    const pureReference = plan.refs.length > 0 && Object.keys(plan.filters).length === 0;
    const context = { propertyIds: plan.refs.length ? contextIds(plan.refs) : [] };
    const cacheKey = JSON.stringify([item.question, plan.query.standalone_question, plan.filters, context.propertyIds]);
    let ranked = retrievalCache.get(cacheKey);
    if (!pureReference && !ranked) {
      const started = Date.now();
      ranked = retrievalCache.get(cacheKey) || fileCache[`retrieval:${cacheKey}`] || await service.searchRowsWithEmbedding(plan.query.standalone_question, plan.filters, context, plan.embedding);
      latencies.push(Date.now() - started);
      retrievalCache.set(cacheKey, ranked);
      fileCache[`retrieval:${cacheKey}`] = ranked;
    }
    let reranked = null;
    if (!pureReference && modelRerank) {
      const cached = rerankCache.get(cacheKey) || fileCache[`rerank:${cacheKey}`];
      if (cached && !cached.fallback) reranked = cached;
      if (!reranked) {
        const started = Date.now();
        reranked = await rerank(plan.query.standalone_question, ranked, {});
        rerankLatencies.push(Date.now() - started);
        if (reranked.fallback) rerankFallbacks++; else { rerankCache.set(cacheKey, reranked); fileCache[`rerank:${cacheKey}`] = reranked; }
      }
      console.log(`[${i + 1}/${fixture.length}] ${item.id} rerank ${reranked.latencyMs}ms returned ${reranked.chunks.length}`);
    }
    const result = pureReference
      ? { found: true, chunks: plan.refs.map(code => snapshot.find(row => row.code === code)).filter(Boolean) }
      : reranked ? { found: reranked.found, chunks: reranked.chunks } : (() => { const chunks = applyThresholds(ranked, thresholdOptions); return { found: chunks.length > 0, chunks }; })();
    const codes = result.chunks.slice(0, 5).map(row => row.code).filter(Boolean);
    if (item.expected_codes.length) {
      const rank = item.expected_codes.map(code => codes.indexOf(code)).find(index => index >= 0);
      if (rank !== undefined) { hit++; mrr += 1 / (rank + 1); }
    } else if (!result.found) truePositive++; else falsePositive++;
  }
  const noansP = truePositive / (truePositive + falsePositive) || 0, noansR = truePositive / noAnswers || 0;
  const f1 = noansP + noansR ? 2 * noansP * noansR / (noansP + noansR) : 0;
  return { recall: hit / (fixture.length - noAnswers), mrr: mrr / (fixture.length - noAnswers), noansP, noansR, f1 };
}

const prepared = await Promise.all(fixture.map(prepare));
const defaultOptions = { minScore: Number(process.env.AI_RAG_MIN_SCORE || 0.30), noAnswerScore: Number(process.env.AI_RAG_NO_ANSWER_SCORE || 0.50), minTextRank: Number(process.env.AI_RAG_MIN_TEXT_RANK || 5) };
const defaultMisses = [];
for (let i = 0; i < fixture.length; i++) {
  const item = fixture[i], plan = prepared[i];
  if (!item.expected_codes.length || (plan.refs.length && !Object.keys(plan.filters).length)) continue;
  const key = JSON.stringify([item.question, plan.query.standalone_question, plan.filters, plan.refs.length ? contextIds(plan.refs) : []]);
  const ranked = retrievalCache.get(key) || await service.searchRowsWithEmbedding(plan.query.standalone_question, plan.filters, { propertyIds: plan.refs.length ? contextIds(plan.refs) : [] }, plan.embedding);
  retrievalCache.set(key, ranked);
  if (!applyThresholds(ranked, defaultOptions).some(row => item.expected_codes.includes(row.code))) defaultMisses.push(item.id);
}
console.log(`DEFAULT_MISSES ${defaultMisses.join(',') || 'none'}`);
const causes = { hard_filter: 0, below_top5: 0, absent_vector_and_text: 0, other: 0 };
for (const id of defaultMisses) {
  const i = fixture.findIndex(item => item.id === id), item = fixture[i], plan = prepared[i], expected = new Set(item.expected_codes);
  const context = { propertyIds: plan.refs.length ? contextIds(plan.refs) : [] };
  const filtered = retrievalCache.get(JSON.stringify([item.question, plan.query.standalone_question, plan.filters, context.propertyIds]));
  const unfiltered = await service.searchRowsWithEmbedding(plan.query.standalone_question, {}, context, plan.embedding);
  const filteredCodes = new Set((filtered || []).map(row => row.code));
  const allCodes = new Set(unfiltered.map(row => row.code));
  if ([...expected].some(code => allCodes.has(code) && !filteredCodes.has(code))) causes.hard_filter++;
  else if ([...expected].some(code => filteredCodes.has(code))) causes.below_top5++;
  else if (![...expected].some(code => allCodes.has(code))) causes.absent_vector_and_text++;
  else causes.other++;
}
console.log(`MISS_CAUSES hard_filter=${causes.hard_filter} below_top5=${causes.below_top5} absent_vector_and_text=${causes.absent_vector_and_text} other=${causes.other}`);
let best = null;
console.log('min_score no_answer min_text_rank recall@5 MRR noans_P noans_R F1');
for (const min of [0.30,0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70]) for (const no of [0.30,0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70]) for (const textRank of [1,3,5,10]) {
  const result = await evaluate(prepared, min, no, textRank, false), row = { min, no, textRank, ...result };
  console.log(`${min.toFixed(2)} ${no.toFixed(2)} ${textRank} ${result.recall.toFixed(3)} ${result.mrr.toFixed(3)} ${result.noansP.toFixed(3)} ${result.noansR.toFixed(3)} ${result.f1.toFixed(3)}`);
  if (!best || row.recall > best.recall || row.recall === best.recall && row.f1 > best.f1) best = row;
}
console.log(`BEST ${best.min.toFixed(2)} ${best.no.toFixed(2)} ${best.textRank} ${best.recall.toFixed(3)} ${best.mrr.toFixed(3)} ${best.noansP.toFixed(3)} ${best.noansR.toFixed(3)} ${best.f1.toFixed(3)}`);
if (useRerank) {
  resetAiUsage();
  const rerankResult = await evaluate(prepared, defaultOptions.minScore, defaultOptions.noAnswerScore, defaultOptions.minTextRank, true);
  const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0; };
  console.log('variant recall@5 MRR noans_P noans_R F1 fallback_count latency_p50 latency_p95 prompt_tokens completion_tokens total_tokens');
  console.log(`baseline ${best.recall.toFixed(3)} ${best.mrr.toFixed(3)} ${best.noansP.toFixed(3)} ${best.noansR.toFixed(3)} ${best.f1.toFixed(3)} 0 ${percentile(latencies,.5)} ${percentile(latencies,.95)} 0 0 0`);
  const usage = getAiUsage();
  console.log(`rerank(pool=${process.env.AI_RAG_RERANK_POOL || 20},min=${process.env.AI_RAG_RERANK_MIN || 2},batch=${process.env.AI_RAG_RERANK_BATCH || 10}) ${rerankResult.recall.toFixed(3)} ${rerankResult.mrr.toFixed(3)} ${rerankResult.noansP.toFixed(3)} ${rerankResult.noansR.toFixed(3)} ${rerankResult.f1.toFixed(3)} ${rerankFallbacks} ${percentile(rerankLatencies,.5)} ${percentile(rerankLatencies,.95)} ${usage.prompt_tokens} ${usage.completion_tokens} ${usage.total_tokens}`);
}
await writeFile(cacheFile, JSON.stringify(fileCache));
