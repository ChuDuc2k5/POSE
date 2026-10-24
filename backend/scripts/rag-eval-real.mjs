import '../dist/env.js';
import { readFile } from 'node:fs/promises';
import { RetrievalService } from '../dist/modules/ai/retrieval.js';
import { EmbeddingService } from '../dist/modules/ai/embeddings.js';

const fixture = JSON.parse(await readFile(new URL('../test/fixtures/rag-eval-real.json', import.meta.url)));
const snapshot = JSON.parse(await readFile('C:/Users/Admin/POSE-tasks/rag-real-snapshot.json'));
if (fixture.length !== 40) throw new Error(`Expected 40 questions, got ${fixture.length}`);
const noAnswers = fixture.filter(item => !item.expected_codes.length).length;
const rentals = fixture.filter(item => item.id <= 'real-10').length;
const followups = fixture.filter(item => item.context?.previous_expected_codes?.length).length;
if (noAnswers < 8 || rentals < 8 || followups < 6) throw new Error('Fixture category requirements are not met');
const words = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || [];
for (const item of fixture) for (const code of item.expected_codes) {
  const target = snapshot.find(row => row.code === code);
  if (!target) throw new Error(`Missing snapshot target ${code}`);
  const question = words(item.question), content = words(target.content);
  for (let i = 0; i <= question.length - 4; i++) for (let j = 0; j <= content.length - 4; j++)
    if (question.slice(i, i + 4).join(' ') === content.slice(j, j + 4).join(' ')) throw new Error(`Question copies four words: ${item.question}`);
}

const service = process.env.RAG_EVAL_FAKE === '1'
  ? new RetrievalService(new EmbeddingService(), async ({ p_query }) => {
    const query = words(p_query);
    const rows = snapshot.map((property, index) => {
      const content = words(property.content);
      const overlap = query.filter(token => content.includes(token)).length;
      return { chunk_id: `fake-${index}`, document_id: `fake-doc-${index}`, source_id: property.id, source_type: 'Property', header: property.header, content: property.content, vector_rank: null, text_rank: overlap ? Math.max(1, 20 - overlap * 3) : null, similarity: null, code: property.code, name: property.name, location: property.location, property_type: property.property_type, transaction_type: property.transaction_type, price: property.price, price_period: property.price_period, availability: property.availability };
    }).filter(row => row.text_rank);
    return { data: rows };
  })
  : new RetrievalService(new EmbeddingService());
const snapshotIds = new Map(JSON.parse(await readFile(process.env.RAG_SNAPSHOT || 'C:/Users/Admin/POSE-tasks/rag-real-snapshot.json', 'utf8')).map(row => [row.code, row.id]));
const contextIds = codes => (codes || []).map(code => snapshotIds.get(code)).filter(Boolean);
async function evaluate() {
  let hit = 0, mrr = 0, truePositive = 0, falsePositive = 0;
  const misses = [];
  for (const item of fixture) {
    const result = await service.search(item.question, {}, { propertyIds: contextIds(item.context?.previous_expected_codes) });
    const got = result.chunks.slice(0, 5).map(row => ({ code: row.code, similarity: row.similarity, text_rank: row.text_rank }));
    const codes = got.map(row => row.code).filter(Boolean);
    if (item.expected_codes.length) {
      const rank = item.expected_codes.map(code => codes.indexOf(code)).find(index => index >= 0);
      if (rank === undefined) misses.push({ question: item.question, expected: item.expected_codes, got });
      else { hit++; mrr += 1 / (rank + 1); }
    } else if (!result.found) truePositive++; else falsePositive++;
  }
  const answerable = fixture.length - noAnswers;
  const precision = truePositive / (truePositive + falsePositive) || 0;
  const recall = truePositive / noAnswers || 0;
  console.log(`RAG eval real: ${fixture.length} questions; recall@5 ${(hit / answerable).toFixed(3)}; MRR ${(mrr / answerable).toFixed(3)}; no-answer precision ${precision.toFixed(3)} recall ${recall.toFixed(3)}`);
  for (const miss of misses) console.log(`MISS question=${JSON.stringify(miss.question)} expected=${miss.expected.join(',')} got=${miss.got.map(row => `${row.code || '-'}:${Number(row.similarity ?? 0).toFixed(4)}/${row.text_rank ?? '-'}`).join(',')}`);
  return { hit, mrr, truePositive, falsePositive };
}

await evaluate();
let best = null;
for (let min = 0.30; min <= 0.70 + 1e-9; min += 0.05) for (let no = 0.30; no <= 0.70 + 1e-9; no += 0.05) for (const textRank of [1, 3, 5, 10]) {
  process.env.AI_RAG_MIN_SCORE = min.toFixed(2); process.env.AI_RAG_NO_ANSWER_SCORE = no.toFixed(2); process.env.AI_RAG_MIN_TEXT_RANK = String(textRank);
  const result = await evaluate();
  const noAnswerF1 = result.truePositive ? (2 * result.truePositive) / (2 * result.truePositive + result.falsePositive + noAnswers - result.truePositive) : 0;
  const score = result.hit / (fixture.length - noAnswers) + noAnswerF1;
  if (!best || score > best.score) best = { min, no, textRank, score };
}
console.log(`BEST min_score=${best.min.toFixed(2)} no_answer=${best.no.toFixed(2)} min_text_rank=${best.textRank} objective=${best.score.toFixed(3)}`);
