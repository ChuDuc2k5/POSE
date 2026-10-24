import { AsyncLocalStorage } from 'node:async_hooks';

export type AiRequestContext = { sessionId: string | null; turnId: string | null; questionPreview: string | null };
const requestSession = new AsyncLocalStorage<AiRequestContext>();
const emptyContext = (): AiRequestContext => ({ sessionId: null, turnId: null, questionPreview: null });
export function setAiRequestSession(sessionId: string | null, turnId: string | null = null, questionPreview: string | null = null) { requestSession.enterWith({ sessionId, turnId, questionPreview }); }
export function withAiRequestSession<T>(sessionId: string | null, callback: () => T, turnId: string | null = null, questionPreview: string | null = null) { return requestSession.run({ sessionId, turnId, questionPreview }, callback); }
export function currentAiRequestSession() { return requestSession.getStore()?.sessionId ?? null; }
export type AiRequestStatus = 'ok' | 'fallback' | 'timeout' | 'invalid_json' | 'error';
export function requestStatus(error: unknown): AiRequestStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|aborted|timed out/i.test(message)) return 'timeout';
  if (/invalid|json|structured/i.test(message)) return 'invalid_json';
  return 'error';
}
// The API returns token usage but no price, so prices (USD per 1M tokens) come from this
// table of published OpenAI list prices; env vars override it when prices change. Models
// not in the table (local LM Studio) cost 0. The cost is fixed into the row at log time.
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};
export function estimateCostUsd(kind: string, model: string, promptTokens: number, completionTokens: number) {
  const env = (name: string) => { const raw = process.env[name]; if (raw === undefined || raw.trim() === '') return undefined; const value = Number(raw); return Number.isFinite(value) && value >= 0 ? value : undefined; };
  const listed = MODEL_PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (kind === 'embed') return promptTokens * (env('AI_EMBED_PRICE_PER_M') ?? listed?.input ?? 0) / 1e6;
  return (promptTokens * (env('AI_PRICE_INPUT_PER_M') ?? listed?.input ?? 0) + completionTokens * (env('AI_PRICE_OUTPUT_PER_M') ?? listed?.output ?? 0)) / 1e6;
}
export function logAiRequest(input: { kind: string; model?: string; promptName?: string | null; promptVersion?: string | null; toolsCalled?: string[]; promptTokens?: number; completionTokens?: number; totalTokens?: number; latencyMs: number; status: AiRequestStatus; errorCode?: string | null; sessionId?: string | null; turnId?: string | null; questionPreview?: string | null }) {
  const context = requestSession.getStore() ?? emptyContext();
  void import('../supabase/supabase.service.js').then(({systemClient})=>systemClient().rpc('pose_system_log_ai_request', {
    p_session_id: input.sessionId === undefined ? context.sessionId : input.sessionId,
    p_kind: input.kind, p_model: input.model || 'unknown', p_prompt_name: input.promptName || null,
    p_prompt_version: input.promptVersion || null, p_tools_called: input.toolsCalled || [],
    p_prompt_tokens: input.promptTokens || 0, p_completion_tokens: input.completionTokens || 0,
    p_total_tokens: input.totalTokens || 0, p_latency_ms: Math.max(0, Math.round(input.latencyMs)),
    p_status: input.status, p_error_code: input.errorCode || null,
    p_estimated_cost_usd: estimateCostUsd(input.kind, input.model || 'unknown', input.promptTokens || 0, input.completionTokens || 0),
    p_turn_id: input.turnId === undefined ? context.turnId : input.turnId,
    p_question_preview: input.questionPreview === undefined ? context.questionPreview : input.questionPreview,
  })).then(result => { if (result.error) console.warn(JSON.stringify({ event: 'ai_request_log_failed', kind: input.kind, error: result.error.message })); })
    .catch(error => console.warn(JSON.stringify({ event: 'ai_request_log_failed', kind: input.kind, error: error instanceof Error ? error.message : 'unknown' })));
}
