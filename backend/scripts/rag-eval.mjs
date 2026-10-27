import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
const fixture = JSON.parse(await readFile(resolve('test/fixtures/rag-eval.json'), 'utf8'));
const corpus = JSON.parse(await readFile(resolve('test/fixtures/rag-eval-corpus.json'), 'utf8'));
const words = (value) =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
for (const question of fixture) {
  for (const expected of question.expected_codes) {
    const target = corpus.find((x) => x.code === expected);
    if (!target) throw new Error(`Missing corpus target ${expected}`);
    const q = words(question.question),
      d = words(target.description);
    for (let i = 0; i < q.length - 3; i++)
      if (d.some((_, j) => q.slice(i, i + 4).join(' ') === d.slice(j, j + 4).join(' ')))
        throw new Error(`Question copies description: ${question.question}`);
  }
}
const embed = (value) => {
  const text = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
  const t = text.match(/[a-z0-9]+/g) || [];
  const f = [...t, ...t.slice(0, -1).map((x, i) => `${x}_${t[i + 1]}`)],
    v = Array(1024).fill(0);
  for (const s of f) {
    let h = 2166136261;
    for (const c of s) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    v[(h >>> 0) % 1024]++;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
const docs = corpus.map((p, i) => ({
  code: p.code,
  source_id: `f${String(i).padStart(11, '0')}`,
  document_id: `d${i}`,
  chunk_id: `c${i}`,
  source_type: 'Property',
  header: `${p.code} · ${p.name} · ${p.ward} · ${p.district} · ${p.type}`,
  content: p.description,
  vector_rank: null,
  text_rank: null,
  similarity: null,
  embed_model: 'eval-hash',
  name: p.name,
  location: `${p.ward}, ${p.district}`,
  property_type: p.type,
  transaction_type: p.transaction_type,
  price: p.price,
  price_period: p.price_period,
  availability: p.availability,
}));
const server = createServer(async (req, res) => {
  const body = JSON.parse(
    await new Promise((resolve, reject) => {
      let s = '';
      req.on('data', (x) => (s += x));
      req.on('end', () => resolve(s));
      req.on('error', reject);
    }),
  );
  const values = Array.isArray(body.input) ? body.input : [body.input];
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ model: 'eval-hash', data: values.map((x, index) => ({ index, embedding: embed(x) })) }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.AI_EMBED_API_URL = `http://127.0.0.1:${server.address().port}/v1`;
process.env.AI_EMBED_MODEL = 'eval-hash';
const { EmbeddingService } = await import('../dist/modules/ai/embeddings.js');
const { RetrievalService } = await import('../dist/modules/ai/retrieval.js');
const rpc = async ({ p_query, p_embedding }) => {
  const qv = p_embedding ? JSON.parse(p_embedding.slice(0, -1) + ']') : null;
  const qtokens = new Set(
    String(p_query)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z0-9]+/g) || [],
  );
  const rows = docs
    .map((d) => {
      const text = d.content.toLowerCase();
      const overlap = [...qtokens].filter((t) => text.includes(t)).length;
      const dv = embed(d.content);
      const sim = qv ? dv.reduce((s, x, k) => s + x * qv[k], 0) : 0;
      return {
        ...d,
        similarity: sim,
        text_rank: overlap ? Math.max(1, 20 - overlap * 3) : null,
        vector_rank: qv ? 1 + Math.round((1 - sim) * 19) : null,
      };
    })
    .filter((x) => x.text_rank || x.similarity > 0.05);
  return { data: rows };
};
const service = new RetrievalService(new EmbeddingService(), rpc);
let hits = 0,
  mrr = 0,
  noTp = 0,
  noFp = 0;
const misses = [];
for (const item of fixture) {
  const result = await service.search(item.question);
  const got = result.sources.map((x) => x.code).filter(Boolean),
    expected = item.expected_codes;
  const rank = expected.map((x) => got.indexOf(x)).find((x) => x >= 0);
  if (expected.length) {
    if (rank === undefined)
      misses.push({ question: item.question, expected, got, best_similarity: result.chunks[0]?.similarity ?? 0 });
    else {
      hits++;
      mrr += 1 / (rank + 1);
    }
  } else if (!result.found) noTp++;
  else noFp++;
}
const answerable = fixture.filter((x) => x.expected_codes.length).length,
  noAnswer = fixture.length - answerable;
console.log(
  `RAG eval offline: ${fixture.length} questions; recall@5 ${(hits / answerable).toFixed(3)}; MRR ${(mrr / answerable).toFixed(3)}; no-answer precision ${(noTp / (noTp + noFp) || 0).toFixed(3)} recall ${(noTp / noAnswer || 0).toFixed(3)}`,
);
for (const miss of misses)
  console.log(
    `MISS question=${JSON.stringify(miss.question)} expected=${miss.expected.join(',')} got=${miss.got.join(',')} best_similarity=${Number(miss.best_similarity).toFixed(4)}`,
  );
console.log(
  'Text-rank scale: text_rank is the SQL row_number ordered by ts_rank_cd (1 is best); min_text_rank is therefore a maximum accepted rank, not a ts_rank_cd score.',
);
for (const textRank of [1, 5, 10])
  for (const score of [0.2, 0.3, 0.4]) {
    process.env.AI_RAG_MIN_TEXT_RANK = String(textRank);
    process.env.AI_RAG_MIN_SCORE = String(score);
    process.env.AI_RAG_NO_ANSWER_SCORE = String(score);
    let found = 0;
    for (const item of fixture) {
      if ((await service.search(item.question)).found) found++;
    }
    console.log(
      `sweep min_score=${score.toFixed(2)} no_answer=${score.toFixed(2)} min_text_rank=${textRank} found=${found}/${fixture.length}`,
    );
  }
console.log(
  'Calibration note: hashed embeddings approximate lexical overlap; thresholds must be re-calibrated with bge-m3 or text-embedding-3-small.',
);
server.close();
