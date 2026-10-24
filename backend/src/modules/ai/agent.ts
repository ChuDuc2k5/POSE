import type OpenAI from 'openai';
import { agentStep, parseToolCall } from './llm.ts';
import { ToolNameSchema } from './schemas.ts';

export const MAX_AGENT_STEPS = 4;
export type ToolExecution = (name: string, args: unknown) => Promise<unknown>;
export type AgentResult = { text: string; messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]; pending: { action_id: string; tool: string; args: unknown }[]; blocked: string[]; steps: number };

export async function runAgent(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], execute: ToolExecution, createPending: (tool: string, args: unknown) => Promise<string>, maxSteps = Number(process.env.AI_AGENT_MAX_STEPS || MAX_AGENT_STEPS)): Promise<AgentResult> {
  const transcript = [...messages], pending: AgentResult['pending'] = [], blocked: string[] = [];
  for (let step = 1; step <= Math.min(MAX_AGENT_STEPS, Math.max(1, maxSteps)); step++) {
    const completion = await agentStep(transcript);
    const message = completion.choices[0]?.message;
    if (!message) throw new Error('INVALID_MODEL_JSON');
    transcript.push(message);
    if (!message.tool_calls?.length) return { text: message.content || '', messages: transcript, pending, blocked, steps: step };
    for (const call of message.tool_calls) {
      if (call.type !== 'function') { blocked.push('custom_tool'); continue; }
      const name = call.function.name;
      const parsedName = ToolNameSchema.safeParse(name);
      let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { args = null; }
      const parsed = parsedName.success ? parseToolCall(name, args) : { success: false as const, error: 'unknown_tool' };
      if (!parsed.success) { blocked.push(`${name}:invalid_arguments`); transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'invalid_arguments' }) }); continue; }
      if (name === 'save_favorite' || name === 'request_handoff' || name === 'propose_appointment') {
        const action_id = await createPending(name, parsed.data);
        pending.push({ action_id, tool: name, args: parsed.data });
        transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: 'awaiting_confirmation', action_id }) });
      } else {
        transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(await execute(name, parsed.data)) });
      }
    }
  }
  blocked.push('max_steps');
  return { text: '', messages: transcript, pending, blocked, steps: Math.min(MAX_AGENT_STEPS, Math.max(1, maxSteps)) };
}
