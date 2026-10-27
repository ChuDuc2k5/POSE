import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHUNK_OVERLAP,
  CHUNK_SINGLE_MAX,
  CHUNK_SIZE,
  cleanKnowledgeText,
  propertyChunks,
  splitKnowledgeText,
} from '../src/modules/ai/chunking.js';
import { embeddingConfig, EmbeddingService, EMBEDDING_BATCH_MAX } from '../src/modules/ai/embeddings.js';
import {
  applyThresholds,
  currentModelRows,
  deterministicReason,
  reciprocalRankFusion,
  renderRetrievedContext,
  RetrievalService,
  type RankedChunk,
} from '../src/modules/ai/retrieval.js';
import { indexNeedsEmbedding } from '../src/modules/ai/indexing.js';
import { cosineSimilarity, meanVector, ruleSimilarProperties } from '../src/modules/ai/similar.js';
import { rerank } from '../src/modules/ai/rerank.js';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});
const row = (id: string, source = 'p1', extra: Partial<RankedChunk> = {}): RankedChunk => ({
  chunk_id: id,
  document_id: `d-${source}`,
  source_id: source,
  source_type: 'Property',
  header: 'h',
  content: 'c',
  vector_rank: null,
  text_rank: null,
  similarity: null,
  ...extra,
});

describe('knowledge chunking', () => {
  it('keeps a clean short description in one chunk with the required header', () => {
    const source = {
      code: 'RV-A0805',
      name: 'Căn hộ Riverside',
      location: 'Thủ Đức',
      property_type: 'Apartment',
      transaction_type: 'Sale' as const,
      description: 'Căn hộ thoáng, gần chợ và có hẻm xe hơi.',
      project_name: 'Riverside',
      amenities: 'Hồ bơi',
    };
    const chunks = propertyChunks(source);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].header).toBe('Mã RV-A0805 · Căn hộ Riverside · Thủ Đức · Apartment · Bán');
    expect(chunks[0].embedded).toContain(chunks[0].header);
  });
  it('uses one chunk through the 1200-character boundary', () => {
    expect(splitKnowledgeText('a '.repeat(600).trim())).toHaveLength(1);
    expect('a '.repeat(600).trim().length).toBeLessThanOrEqual(CHUNK_SINGLE_MAX);
  });
  it('splits long text without breaking words and overlaps complete sentences', () => {
    const text = Array.from(
        { length: 35 },
        (_, i) => `Câu số ${i} mô tả căn nhà với nhiều thông tin hữu ích và rõ ràng.`,
      ).join(' '),
      chunks = splitKnowledgeText(text);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.length <= CHUNK_SIZE + CHUNK_OVERLAP)).toBe(true);
    expect(chunks.every((chunk) => !/^\S*\s/.test(chunk) || !chunk.startsWith('ả'))).toBe(true);
    expect(chunks[1].split(' ').slice(0, 3).join(' ')).toMatch(/Câu số/);
  });
  it('removes HTML, emoji bullets, PII, broker lines and price sentences', () => {
    const clean = cleanKnowledgeText(
      '<p>🏠 Nhà có hẻm xe hơi.</p> Giá 3,5 tỷ. Liên hệ anh Tuấn 090-123-4567. email broker@example.vn. https://example.vn',
    );
    expect(clean).toContain('hẻm xe hơi');
    expect(clean).not.toMatch(/3,5|090|broker|example|Liên hệ/i);
  });
  it('removes real-catalogue money clauses but keeps factual measurements', () => {
    const examples = [
      ['Nhà có hẻm xe hơi 6m, giá 3.2 tỷ, gần chợ.', '6m'],
      ['Căn hộ có 2 phòng ngủ, 25 triệu/tháng, nội thất đầy đủ.', '2 phòng'],
      ['Đất rộng 110m2, mặt tiền đường 20m, 10.000.000.000 VND.', '110m2'],
      ['Giá thương lượng, pháp lý sẵn sổ và xây 2 tầng.', '2 tầng'],
    ];
    for (const [example, kept] of examples) {
      const clean = cleanKnowledgeText(example);
      expect(clean).not.toMatch(/3\.2|25\s*tri|10\.000|VND|thương\s*lượng/i);
      expect(clean).toContain(kept);
    }
  });
  it('adds only district aliases present in the listing text', () => {
    const source = {
      code: 'R1',
      name: 'Căn hộ Q12',
      location: 'Phường Tân Thới Hiệp, Thành phố Hồ Chí Minh',
      property_type: 'Apartment',
      transaction_type: 'Sale' as const,
      description: 'Gần Quận 7 nhưng không thuộc khu vực khác.',
      project_name: null,
      amenities: null,
    };
    expect(propertyChunks(source)[0].header).toContain('Quận 12');
    expect(propertyChunks(source)[0].header).toContain('Quận 7');
    expect(propertyChunks(source)[0].header).not.toMatch(/Quận 1(?:\s|·|$)/u);
  });
});

describe('embeddings', () => {
  it('joins a base URL, supports localhost without a key, and defaults to 1024 dimensions', () => {
    process.env.AI_EMBED_API_URL = 'http://127.0.0.1:1234/v1/';
    process.env.AI_EMBED_MODEL = 'bge-m3';
    delete process.env.AI_EMBED_API_KEY;
    const config = embeddingConfig()!;
    expect(config.url).toBe('http://127.0.0.1:1234/v1/embeddings');
    expect(config.dimensions).toBe(1024);
    expect(config.openai).toBe(false);
  });
  it('batches at 64 and sends dimensions only to OpenAI', async () => {
    let calls = 0,
      max = 0,
      hasDimensions = false;
    const server = createServer(async (req, res) => {
      let raw = '';
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      calls++;
      max = Math.max(max, body.input.length);
      hasDimensions ||= 'dimensions' in body;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          data: body.input.map((_: string, index: number) => ({ index, embedding: Array(4).fill(index + 1) })),
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    process.env.AI_EMBED_API_URL = `http://127.0.0.1:${typeof address === 'object' && address?.port}/v1`;
    process.env.AI_EMBED_MODEL = 'fake';
    process.env.AI_EMBED_DIMENSIONS = '4';
    try {
      const result = await new EmbeddingService().embed(Array(EMBEDDING_BATCH_MAX + 1).fill('x'));
      expect(result?.vectors).toHaveLength(65);
      expect(calls).toBe(2);
      expect(max).toBe(64);
      expect(hasDimensions).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe('hybrid ranking', () => {
  it('uses previous-result ids as a ranking hint instead of an eligibility filter', async () => {
    process.env.AI_RAG_RERANK = 'off';
    const rows = [row('a', 'p1', { text_rank: 1 }), row('b', 'p2', { text_rank: 2 })];
    const service = new RetrievalService(
      { embed: async () => ({ model: 'test', vectors: [[1]] }) } as never,
      async (args) => {
        expect(args.p_context).toEqual(['p1']);
        return { data: rows };
      },
    );
    const result = await service.search('câu hỏi', {}, { propertyIds: ['p1'] });
    expect(result.chunks.map((item) => item.source_id)).toEqual(['p1', 'p2']);
  });
  it('merges vector and text ranks with reciprocal rank fusion', () => {
    const merged = reciprocalRankFusion([
      row('a', 'p1', { vector_rank: 1, similarity: 0.8 }),
      row('b', 'p2', { vector_rank: 2, similarity: 0.7 }),
      row('b', 'p2', { text_rank: 1 }),
      row('c', 'p3', { text_rank: 2 }),
    ]);
    expect(merged[0].chunk_id).toBe('b');
    expect(merged[0].rrf).toBeCloseTo(1 / 62 + 1 / 61);
  });
  it('applies minimum and relative thresholds and limits two chunks per property', () => {
    const rows = [
      row('a', 'p1', { vector_rank: 1, similarity: 0.8 }),
      row('b', 'p1', { vector_rank: 2, similarity: 0.75 }),
      row('c', 'p1', { vector_rank: 3, similarity: 0.74 }),
      row('d', 'p2', { vector_rank: 4, similarity: 0.55 }),
      row('e', 'p3', { text_rank: 1, similarity: null }),
    ];
    expect(
      applyThresholds(rows, { minScore: 0.35, relativeGap: 0.15, noAnswerScore: 0.3, topK: 5 }).map((x) => x.chunk_id),
    ).toEqual(['a', 'b', 'e']);
  });
  it('returns no answer below the threshold when full text found nothing', () => {
    expect(
      applyThresholds([row('a', 'p1', { vector_rank: 1, similarity: 0.25 })], {
        minScore: 0.2,
        relativeGap: 0.15,
        noAnswerScore: 0.3,
        topK: 5,
      }),
    ).toEqual([]);
  });
  it('keeps full-text fallback and isolates vectors by model through ranked input', () => {
    expect(
      applyThresholds([row('text', 'faq', { text_rank: 1 })], {
        minScore: 0.5,
        relativeGap: 0.1,
        noAnswerScore: 0.5,
        topK: 5,
      }),
    ).toHaveLength(1);
    const current = [row('current', 'p1', { vector_rank: 1, similarity: 0.7 })];
    expect(reciprocalRankFusion(current).map((x) => x.chunk_id)).not.toContain('old-model');
  });
  it('filters vector candidates to the current model while retaining text candidates', () => {
    const rows = [
      row('new', 'p1', { embed_model: 'bge-m3', vector_rank: 1 }),
      row('old', 'p2', { embed_model: 'old', vector_rank: 1 }),
      row('text', 'faq', { text_rank: 1 }),
    ];
    expect(currentModelRows(rows, 'bge-m3').map((x) => x.chunk_id)).toEqual(['new', 'text']);
  });
  it('keeps citation numbers stable per property after a sold result is removed', () => {
    const first = row('a', 'p1', { content: 'first' }),
      second = row('b', 'p1', { content: 'second' }),
      sold = row('c', 'p2', { availability: 'Sold' });
    const rendered = renderRetrievedContext([first, second, sold], new Set(['p1']));
    expect(rendered.sources.map((x) => x.number)).toEqual([1]);
    expect(rendered.chunks.map((x) => x.citation_number)).toEqual([1, 1]);
    expect(rendered.context.match(/\[1\]/g)).toHaveLength(2);
  });
});

describe('model reranking', () => {
  it('orders by relevance and keeps the answer flag', async () => {
    const rows = [row('a', 'p1', { rrf: 0.9 }), row('b', 'p2', { rrf: 0.8 }), row('c', 'p3', { rrf: 0.7 })];
    const result = await rerank('câu hỏi', rows, {
      model: async () => ({
        has_answer: true,
        ranked: [
          { n: 3, relevance: 2 },
          { n: 1, relevance: 3 },
          { n: 2, relevance: 1 },
        ],
      }),
    });
    expect(result.found).toBe(true);
    expect(result.chunks.map((x) => x.chunk_id)).toEqual(['a', 'c']);
  });
  it('returns no answer when the model says no answer', async () => {
    const result = await rerank('không có', [row('a', 'p1', { similarity: 0.9 })], {
      model: async () => ({ has_answer: false, ranked: [{ n: 1, relevance: 3 }] }),
    });
    expect(result.found).toBe(false);
    expect(result.chunks).toEqual([]);
  });
  it('ignores duplicate and out-of-range entries without discarding valid results', async () => {
    const result = await rerank('q', [row('a', 'p1'), row('b', 'p2')], {
      model: async () => ({
        has_answer: true,
        ranked: [
          { n: 99, relevance: 3 },
          { n: 1, relevance: 2 },
          { n: 1, relevance: 3 },
          { n: 2, relevance: 2 },
        ],
      }),
    });
    expect(result.chunks.map((x) => x.chunk_id)).toEqual(['a', 'b']);
  });
  it('falls back to thresholds for invalid output and timeout', async () => {
    const rows = [row('a', 'p1', { similarity: 0.8 })];
    const invalid = await rerank('q', rows, { model: async () => ({ bad: true }) });
    expect(invalid.fallback).toBe(true);
    expect(invalid.chunks.map((x) => x.chunk_id)).toEqual(['a']);
    const timeout = await rerank('q', rows, { timeoutMs: 10, model: async () => new Promise(() => {}) });
    expect(timeout.fallback).toBe(true);
    expect(timeout.reason).toBe('timeout');
  });
  it('does not remove low-similarity candidates before reranking and caps listings at two chunks', async () => {
    const rows = [
      row('a', 'p1', { similarity: 0.01 }),
      row('b', 'p2', { similarity: 0.02 }),
      row('c', 'p3', { similarity: 0.03 }),
    ];
    const seen: number[] = [];
    const result = await rerank('q', rows, {
      pool: 3,
      model: async (_schema, _name, messages) => {
        seen.push((messages[1].content as string).split('[').length - 1);
        return {
          has_answer: true,
          ranked: [
            { n: 1, relevance: 2 },
            { n: 2, relevance: 2 },
            { n: 3, relevance: 2 },
          ],
        };
      },
    });
    expect(seen[0]).toBe(3);
    expect(result.chunks).toHaveLength(3);
    expect(result.chunks.filter((x) => x.source_id === 'p1')).toHaveLength(1);
  });
});

describe('index idempotency', () => {
  it('skips only when both hash and model match', () => {
    expect(indexNeedsEmbedding({ content_hash: 'h', embed_model: 'm' }, 'h', 'm')).toBe(false);
    expect(indexNeedsEmbedding({ content_hash: 'h', embed_model: 'm' }, 'h', 'other')).toBe(true);
    expect(indexNeedsEmbedding({ content_hash: 'h', embed_model: null }, 'h', null)).toBe(false);
  });
});
describe('similar properties', () => {
  it('computes a mean vector and cosine ranking primitives', () => {
    expect(
      meanVector([
        [1, 3],
        [3, 1],
      ]),
    ).toEqual([2, 2]);
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it('uses the deterministic rule fallback constraints', () => {
    const source = { id: 'a', district: 'Q7', property_type: 'Apartment', transaction_type: 'Rent', price: 100 };
    expect(
      ruleSimilarProperties(source, [
        { id: 'b', district: 'Q7', property_type: 'Apartment', transaction_type: 'Rent', price: 120 },
        { id: 'c', district: 'Q7', property_type: 'House', transaction_type: 'Rent', price: 100 },
        { id: 'a', district: 'Q7', property_type: 'Apartment', transaction_type: 'Rent', price: 100 },
      ]).map((item) => item.id),
    ).toEqual(['b']);
  });
  it('extracts a short reason without price and PII', () => {
    expect(deterministicReason('Gần chợ, sổ hồng riêng. Giá 3 tỷ, gọi 0901234567.')).toBe('Gần chợ, sổ hồng riêng.');
  });
});

describe('rerank keep-similarity guard', () => {
  it('keeps confident retrieval when the model rejects everything, only above the configured similarity', async () => {
    const rows = [row('a', 'p1', { similarity: 0.8, text_rank: 1 }), row('b', 'p2', { similarity: 0.75 })];
    const reject = async () => ({ has_answer: false, ranked: [] });
    process.env.AI_RAG_RERANK_KEEP_SIM = '0.7';
    expect((await rerank('q', rows, { model: reject })).chunks.length).toBeGreaterThan(0);
    process.env.AI_RAG_RERANK_KEEP_SIM = '0.9';
    expect((await rerank('q', rows, { model: reject })).found).toBe(false);
    delete process.env.AI_RAG_RERANK_KEEP_SIM;
    expect((await rerank('q', rows, { model: reject })).found).toBe(false);
  });
});

describe('knowledge text cleaning keeps non-price Vietnamese words', () => {
  it('keeps "thời gian", "gia đình", "chiều rộng" and drops real price/broker clauses', async () => {
    const { cleanKnowledgeText, faqChunks } = await import('../src/modules/ai/chunking.js');
    const text = cleanKnowledgeText(
      'Phù hợp cho gia đình trẻ. Chiều rộng 5m, thời gian bàn giao quý 3. Giá bán 3,2 tỷ. Liên hệ anh Tuấn 0901234567.',
    );
    expect(text).toContain('gia đình');
    expect(text).toContain('Chiều rộng 5m');
    expect(text).toContain('thời gian bàn giao');
    expect(text).not.toMatch(/3,2 tỷ|Giá bán|Liên hệ|0901234567/);
    expect(
      faqChunks('Làm sao đăng ký xem nhà?', 'Thời gian chỉ được xác nhận sau khi chuyên viên liên hệ.')[0].content,
    ).toContain('liên hệ');
  });
});
