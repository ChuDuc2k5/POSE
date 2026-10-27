import { runAgent } from '../src/modules/ai/agent.js';
import { AnswerMetaSchema, NeedsV1Schema, SearchQuerySchema, ToolArgs } from '../src/modules/ai/schemas.js';
import { parseToolCall } from '../src/modules/ai/llm.js';

describe('M06 native agent contract', () => {
  it('accepts and rejects every structured schema', () => {
    expect(
      SearchQuerySchema.safeParse({
        topic: 'real_estate',
        standalone_question: 'căn hộ Q7',
        filters: {},
        refers_to_previous: [],
      }).success,
    ).toBe(true);
    expect(
      SearchQuerySchema.safeParse({
        topic: 'real_estate',
        standalone_question: '',
        filters: {},
        refers_to_previous: [],
      }).success,
    ).toBe(false);
    expect(
      SearchQuerySchema.safeParse({ standalone_question: 'căn hộ Q7', filters: {}, refers_to_previous: [] }).success,
    ).toBe(false);
    expect(
      SearchQuerySchema.safeParse({ topic: 'weather', standalone_question: 'x', filters: {}, refers_to_previous: [] })
        .success,
    ).toBe(false);
    expect(
      AnswerMetaSchema.safeParse({ grounding: 'grounded', cited: [1], claims: [{ type: 'price', text: 'giá' }] })
        .success,
    ).toBe(true);
    expect(AnswerMetaSchema.safeParse({ grounding: 'bad', cited: [], claims: [] }).success).toBe(false);
    expect(NeedsV1Schema.safeParse([{ field: 'locations', value: ['Q7'], evidence: 'Q7' }]).success).toBe(true);
    expect(NeedsV1Schema.safeParse([{ field: 'nope', value: 'x', evidence: 'x' }]).success).toBe(false);
    expect(ToolArgs.search_properties.safeParse({ query: 'Q7', filters: {} }).success).toBe(true);
    expect(ToolArgs.propose_appointment.safeParse({ preferred_start: '2027-01-01T09:00:00.000Z' }).success).toBe(true);
    expect(parseToolCall('unknown_tool', {}).success).toBe(false);
    expect(parseToolCall('save_favorite', { code: 'RV-A0805' }).success).toBe(true);
    expect(parseToolCall('save_favorite', { code: '' }).success).toBe(false);
  });

  it('blocks unknown tools, limits steps, and sends writes only to pending creation', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const createPending = vi.fn(async () => 'pending-1');
    const step = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: '1',
                  type: 'function',
                  function: { name: 'request_handoff', arguments: '{"summary":"Gọi tư vấn"}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ choices: [{ message: { role: 'assistant', content: 'Đã tạo yêu cầu.' } }] });
    const result = await runAgent([{ role: 'user', content: 'gọi cho tôi' }], execute, createPending, 4, step as never);
    expect(createPending).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(result.pending[0].action_id).toBe('pending-1');
    const blocked = await runAgent(
      [{ role: 'user', content: 'x' }],
      execute,
      createPending,
      1,
      vi
        .fn()
        .mockResolvedValue({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [{ id: '2', type: 'function', function: { name: 'no_such_tool', arguments: '{}' } }],
              },
            },
          ],
        }) as never,
    );
    expect(blocked.blocked).toContain('no_such_tool:invalid_arguments');
    expect(blocked.steps).toBe(1);
  });
});
