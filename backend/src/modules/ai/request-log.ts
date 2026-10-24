let activeSessionId: string | null = null;
export function setAiRequestSession(sessionId: string | null) { activeSessionId = sessionId; }
export type AiRequestStatus = 'ok' | 'fallback' | 'timeout' | 'invalid_json' | 'error';
export function requestStatus(error: unknown): AiRequestStatus {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|aborted|timed out/i.test(message)) return 'timeout';
  if (/invalid|json|structured/i.test(message)) return 'invalid_json';
  return 'error';
}
export function logAiRequest(input: { kind: string; model?: string; promptName?: string | null; promptVersion?: string | null; toolsCalled?: string[]; promptTokens?: number; completionTokens?: number; totalTokens?: number; latencyMs: number; status: AiRequestStatus; errorCode?: string | null; sessionId?: string | null }) {
  void import('../supabase/supabase.service.js').then(({systemClient})=>systemClient().rpc('pose_system_log_ai_request', {
    p_session_id: input.sessionId === undefined ? activeSessionId : input.sessionId,
    p_kind: input.kind, p_model: input.model || 'unknown', p_prompt_name: input.promptName || null,
    p_prompt_version: input.promptVersion || null, p_tools_called: input.toolsCalled || [],
    p_prompt_tokens: input.promptTokens || 0, p_completion_tokens: input.completionTokens || 0,
    p_total_tokens: input.totalTokens || 0, p_latency_ms: Math.max(0, Math.round(input.latencyMs)),
    p_status: input.status, p_error_code: input.errorCode || null,
  })).catch(() => undefined);
}
