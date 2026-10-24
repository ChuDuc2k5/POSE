import { afterEach, describe, expect, it } from 'vitest';
import { estimateCostUsd } from '../src/modules/ai/request-log.js';

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

describe('AI request cost', () => {
  it('prices a known OpenAI model from the built-in table without any env', () => {
    for (const name of ['AI_PRICE_INPUT_PER_M', 'AI_PRICE_OUTPUT_PER_M', 'AI_EMBED_PRICE_PER_M']) delete process.env[name];
    expect(estimateCostUsd('chat', 'gpt-4.1-mini', 1000, 200)).toBeCloseTo(0.00072, 10);
    expect(estimateCostUsd('chat', 'gpt-4.1-mini-2025-04-14', 1000, 200)).toBeCloseTo(0.00072, 10);
    expect(estimateCostUsd('embed', 'text-embedding-3-small', 1_000_000, 0)).toBeCloseTo(0.02, 10);
  });
  it('lets env override the table when prices change', () => {
    process.env.AI_PRICE_INPUT_PER_M = '1'; process.env.AI_PRICE_OUTPUT_PER_M = '2';
    expect(estimateCostUsd('rerank', 'gpt-4.1-mini', 1_000_000, 1_000_000)).toBeCloseTo(3, 10);
  });
  it('is zero for local models that are not in the table', () => {
    for (const name of ['AI_PRICE_INPUT_PER_M', 'AI_PRICE_OUTPUT_PER_M']) delete process.env[name];
    expect(estimateCostUsd('chat', 'qwen3-4b-instruct-2507', 5000, 300)).toBe(0);
    expect(estimateCostUsd('embed', 'text-embedding-bge-m3', 5000, 0)).toBe(0);
  });
});
