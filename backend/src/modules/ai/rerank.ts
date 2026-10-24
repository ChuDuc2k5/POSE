import { z } from 'zod';
import { structured } from './llm.js';
import { applyThresholds, type RankedChunk } from './retrieval.js';
import { prompt } from './prompts.js';

const RerankEnvelopeSchema = z.object({ has_answer: z.boolean(), ranked: z.array(z.unknown()) });
const RerankEntrySchema = z.object({ n: z.number().int().positive(), relevance: z.number().int().min(0).max(3) });
export type RerankModel = (schema: z.ZodType<unknown>, name: string, messages: Parameters<typeof structured>[2], model?: string, maxTokens?: number) => Promise<unknown>;
export type RerankOptions = { pool?: number; min?: number; batch?: number; timeoutMs?: number; model?: RerankModel };
export type RerankResult = { chunks: RankedChunk[]; found: boolean; hasAnswer: boolean; fallback: boolean; latencyMs: number; reason?: string };
const sourceKey = (row: RankedChunk) => row.source_type === 'Faq' ? `Faq:${row.document_id}` : `Property:${row.source_id || row.document_id}`;
const poolRows = (rows: RankedChunk[], pool: number) => { const seen = new Set<string>(); return rows.filter(row => { const key = sourceKey(row); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, pool); };
const fallback = (rows: RankedChunk[], reason: string, started: number): RerankResult => { console.warn(JSON.stringify({ event: 'rerank_fallback', reason })); const chunks = applyThresholds(rows); return { chunks, found: chunks.length > 0, hasAnswer: chunks.length > 0, fallback: true, latencyMs: Date.now() - started, reason }; };
const withTimeout = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
const timeoutFor = (override?: number) => { if (override !== undefined) return Math.max(100, Math.min(120000, override)); const configured = Number(process.env.AI_RAG_RERANK_TIMEOUT_MS); if (Number.isFinite(configured) && configured > 0) return Math.max(100, Math.min(120000, configured)); try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.AI_API_URL || '').hostname) ? 60000 : 20000; } catch { return 20000; } };

export async function rerank(question: string, rows: RankedChunk[], options: RerankOptions = {}): Promise<RerankResult> {
  const started = Date.now();
  if (process.env.AI_RAG_RERANK === 'off') return fallback(rows, 'disabled', started);
  const pool = Math.max(1, Math.min(100, options.pool ?? Number(process.env.AI_RAG_RERANK_POOL || 20)));
  const min = Math.max(0, Math.min(3, options.min ?? Number(process.env.AI_RAG_RERANK_MIN || 2)));
  const batch = Math.max(1, Math.min(pool, options.batch ?? Number(process.env.AI_RAG_RERANK_BATCH || 10)));
  const timeoutMs = timeoutFor(options.timeoutMs), candidates = poolRows(rows, pool);
  if (!candidates.length) return { chunks: [], found: false, hasAnswer: false, fallback: false, latencyMs: Date.now() - started };
  const model = options.model || (structured as unknown as RerankModel), scores = new Map<number, number>();
  let modelSaysAnswer = false, hasRelevant = false;
  const answerable = new Set<number>();
  try {
    for (let offset = 0; offset < candidates.length; offset += batch) {
      const group = candidates.slice(offset, offset + batch);
      const data = group.map((row, index) => `[${index + 1}] ${row.header}\n${row.content.slice(0, 200)}`).join('\n\n');
      const messages = [
        { role: 'system' as const, content: prompt('rerank.system').text },
        { role: 'user' as const, content: prompt('rerank.user', { question, data }).text },
      ];
      const raw = await withTimeout(model(RerankEnvelopeSchema, 'rag_rerank', messages, undefined, Math.max(160, Math.min(300, group.length * 14 + 80))), timeoutMs);
      const envelope = RerankEnvelopeSchema.safeParse(raw); if (!envelope.success) throw new Error('invalid_json');
      modelSaysAnswer ||= envelope.data.has_answer;
      for (const entry of envelope.data.ranked) { const parsed = RerankEntrySchema.safeParse(entry); if (!parsed.success || parsed.data.n > group.length) continue; const globalN = offset + parsed.data.n; if (scores.has(globalN)) continue; scores.set(globalN, parsed.data.relevance); if (envelope.data.has_answer) answerable.add(globalN); if (envelope.data.has_answer && parsed.data.relevance >= min) hasRelevant = true; }
    }
    const hasAnswer = modelSaysAnswer && hasRelevant;
    const chosen = candidates.map((row, index) => ({ row, relevance: scores.get(index + 1), index })).filter(item => item.relevance !== undefined && item.relevance >= min && hasAnswer && answerable.has(item.index + 1)).sort((a, b) => (b.relevance! - a.relevance!) || ((b.row.rrf || 0) - (a.row.rrf || 0))).map(item => item.row);
    const limited: RankedChunk[] = [], counts = new Map<string, number>();
    for (const row of chosen) { const key = sourceKey(row), count = counts.get(key) || 0; if (count >= 2) continue; counts.set(key, count + 1); limited.push(row); if (limited.length >= Number(process.env.AI_RAG_TOP_K || 5)) break; }
    console.info(JSON.stringify({ event: 'rerank', latency_ms: Date.now() - started, candidates: candidates.length, returned: limited.length }));
    return { chunks: limited, found: hasAnswer && limited.length > 0, hasAnswer, fallback: false, latencyMs: Date.now() - started };
  } catch (error) { return fallback(rows, error instanceof Error ? error.message : 'unknown', started); }
}
