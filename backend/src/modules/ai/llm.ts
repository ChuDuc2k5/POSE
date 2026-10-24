import OpenAI from 'openai';
import { zodFunction, zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { object, extractNeeds } from './extraction.ts';
import { toolAllowed } from './guard.ts';
import { ToolArgs, ToolCallSchema, SearchQuerySchema, AnswerMetaSchema, NeedsV1Schema, NeedEntrySchema, type ToolName } from './schemas.ts';
import { prompt, promptVersion } from './prompts.js';
import { logAiRequest, requestStatus } from './request-log.js';

export type ModelResult = { reply: string; intent: 'real_estate' | 'other' | 'unknown'; needs?: Record<string, unknown>; tool_calls?: unknown[]; flags: { tool: 'invalid_need' | 'invalid_tool'; args: unknown; reason: string }[] };
export type AiUsageTotals = { prompt_tokens: number; completion_tokens: number; total_tokens: number; calls: number };
const aiUsage: AiUsageTotals = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 };
export function resetAiUsage() { aiUsage.prompt_tokens = 0; aiUsage.completion_tokens = 0; aiUsage.total_tokens = 0; aiUsage.calls = 0; }
export function getAiUsage(): AiUsageTotals { return { ...aiUsage }; }
export const SYSTEM_PROMPT = prompt('assistant').text;
export const SYSTEM_PROMPT_VERSION = promptVersion('assistant');
const TurnSchema = z.object({ reply: z.string().trim().min(1).max(4000), intent: z.enum(['real_estate', 'other', 'unknown']), needs: NeedsV1Schema.nullable().default(null) });
export const TURN_SCHEMA = zodResponseFormat(TurnSchema, 'assistant_turn');
const tools = [
  zodFunction({ name: 'search_properties', description: 'Tìm bất động sản theo câu hỏi và bộ lọc.', parameters: ToolArgs.search_properties }),
  zodFunction({ name: 'get_property_detail', description: 'Xem chi tiết một mã bất động sản đã công bố.', parameters: ToolArgs.get_property_detail }),
  zodFunction({ name: 'list_my_appointments', description: 'Liệt kê lịch hẹn của khách đã đăng nhập.', parameters: ToolArgs.list_my_appointments }),
  zodFunction({ name: 'save_favorite', description: 'Lưu một bất động sản sau khi khách xác nhận.', parameters: ToolArgs.save_favorite }),
  zodFunction({ name: 'request_handoff', description: 'Đề nghị chuyên viên liên hệ sau khi khách xác nhận.', parameters: ToolArgs.request_handoff }),
  zodFunction({ name: 'propose_appointment', description: 'Đề nghị lịch xem sau khi khách xác nhận.', parameters: ToolArgs.propose_appointment }),
];
export const AGENT_TOOLS = tools.map(tool => ({ type: 'function' as const, function: tool.function }));
export function providerConfig() {
  const raw = process.env.AI_API_URL?.trim(), model = process.env.AI_MODEL?.trim() || 'gpt-4.1-mini', key = process.env.AI_API_KEY?.trim();
  if (!raw) throw new Error('AI_UNAVAILABLE');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (!key && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('AI_UNAVAILABLE');
  url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '') || '/v1';
  const configured = Number(process.env.AI_TIMEOUT_MS || 60000);
  const baseURL = url.toString().replace(/\/$/, '');
  return { baseURL, url: `${baseURL}/chat/completions`, key, model, timeout: Math.min(120000, Math.max(5000, Number.isFinite(configured) ? Math.round(configured) : 60000)) };
}
function client() { const c = providerConfig(); return { api: new OpenAI({ apiKey: c.key || 'local', baseURL: c.baseURL, timeout: c.timeout, maxRetries: 0 }), config: c }; }

export function validateModel(raw: unknown, source?: string): ModelResult {
  if (!object(raw) || typeof raw.reply !== 'string' || !raw.reply.trim() || raw.reply.length > 4000 || !['real_estate', 'other', 'unknown'].includes(raw.intent as string)) throw new Error('INVALID_MODEL_JSON');
  const flags: ModelResult['flags'] = [], needs: Record<string, unknown> = {}, calls: unknown[] = [];
  if (raw.needs !== undefined) {
    const parsed = NeedsV1Schema.safeParse(raw.needs);
    if (parsed.success) for (const entry of parsed.data) {
      const normalized = extractNeeds({ [entry.field]: { value: entry.value, confidence: 1, evidence: entry.evidence } }, source || entry.evidence);
      if (!Object.hasOwn(normalized, entry.field)) flags.push({ tool: 'invalid_need', args: entry, reason: 'invalid_need' });
      else needs[entry.field] = normalized[entry.field];
    } else flags.push({ tool: 'invalid_need', args: raw.needs, reason: 'invalid_need' });
  }
  if (raw.tool_calls !== undefined && raw.tool_calls !== null) {
    if (!Array.isArray(raw.tool_calls)) flags.push({ tool: 'invalid_tool', args: raw.tool_calls, reason: 'invalid_tool' });
    else for (const call of raw.tool_calls) { if (toolAllowed(call)) calls.push(call); else flags.push({ tool: 'invalid_tool', args: call, reason: 'invalid_tool' }); }
  }
  return { reply: raw.reply, intent: raw.intent as ModelResult['intent'], needs, tool_calls: calls, flags };
}

// Maps a structured-output schema name to ai_request_log.kind.
const logKind=(name:string)=>({rag_rerank:'rerank',search_query:'query',needs_v1:'needs',answer_meta:'answer_meta'} as Record<string,string>)[name] || name;
export async function structured<T>(schema: z.ZodType<T>, name: string, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], model = process.env.AI_META_MODEL || providerConfig().model, maxTokens = 300): Promise<T> {
  const started=Date.now(); const { api } = client();
  try {
  const result = await api.chat.completions.create({ model, temperature: 0, max_tokens: maxTokens, response_format: zodResponseFormat(schema, name), messages });
  const usage = result.usage;
  aiUsage.prompt_tokens += usage?.prompt_tokens || 0;
  aiUsage.completion_tokens += usage?.completion_tokens || 0;
  aiUsage.total_tokens += usage?.total_tokens || 0;
  aiUsage.calls++;
  const content = result.choices[0]?.message?.content;
  if (!content) throw new Error('INVALID_STRUCTURED_OUTPUT');
  if (name === 'rag_rerank' && process.env.AI_RAG_RERANK_DEBUG === '1') {
    const count = Number(process.env.AI_RAG_RERANK_DEBUG_COUNT || 3);
    const seen = Number(process.env.AI_RAG_RERANK_DEBUG_SEEN || 0);
    if (seen < count) { console.info(JSON.stringify({ event: 'rerank_raw', raw: content })); process.env.AI_RAG_RERANK_DEBUG_SEEN = String(seen + 1); }
  }
  const value=schema.parse(JSON.parse(content));
  logAiRequest({kind:logKind(name),model,promptName:name,promptVersion:name==='search_query'?promptVersion('query'):name==='needs_v1'?promptVersion('needs'):name==='rag_rerank'?`${promptVersion('rerank.system')}+${promptVersion('rerank.user')}`:promptVersion('answer-meta'),promptTokens:usage?.prompt_tokens,completionTokens:usage?.completion_tokens,totalTokens:usage?.total_tokens,latencyMs:Date.now()-started,status:'ok'});
  return value;
  } catch(error) { logAiRequest({kind:logKind(name),model,promptName:name,latencyMs:Date.now()-started,status:requestStatus(error),errorCode:error instanceof Error?error.message:'UNKNOWN'}); throw error; }
}

export async function complete(data: unknown): Promise<ModelResult> {
  const started=Date.now();
  const input: Record<string, unknown> = object(data) ? { ...data } : { data };
  if (Array.isArray(input.properties)) { input.listing_terms = input.properties.map(p => object(p) ? { code: p.code, transaction_type: p.transaction_type ?? 'Sale', price_period: p.price_period ?? 'Total' } : p); input.properties = input.properties.map(p => object(p) ? Object.fromEntries(['code', 'name', 'price', 'availability', 'updated_at', 'location', 'property_type'].map(k => [k, p[k]])) : p); }
  const config = providerConfig();
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const response = await fetch(`${config.baseURL}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) }, signal: AbortSignal.timeout(config.timeout), cache: 'no-store', body: JSON.stringify({ model: config.model, temperature: 0, max_tokens: 600, response_format: TURN_SCHEMA, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `BEGIN_UNTRUSTED_DATA\n${JSON.stringify({ ...input, schema_retry: attempt === 1 }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\nEND_UNTRUSTED_DATA` }] }) }); if (!response.ok) throw new Error('AI_UNAVAILABLE'); const body = await response.json(); let parsed: unknown; try { parsed = JSON.parse(body.choices?.[0]?.message?.content); } catch { throw new Error('INVALID_MODEL_JSON'); } return validateModel(parsed, typeof input.customer_text === 'string' ? input.customer_text : undefined); }
    catch (error) { logAiRequest({kind:'chat',model:config.model,promptName:'assistant',promptVersion:SYSTEM_PROMPT_VERSION,latencyMs:Date.now()-started,status:requestStatus(error),errorCode:error instanceof Error?error.message:'UNKNOWN'}); if (error instanceof Error && error.message === 'INVALID_MODEL_JSON' && attempt === 0) continue; throw error; }
  }
  throw new Error('INVALID_MODEL_JSON');
}
export async function agentStep(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], temperature = 0.2) { const started=Date.now(); const { api, config } = client(); try { const result=await api.chat.completions.create({ model: config.model, temperature, max_tokens: 600, tool_choice: 'auto', parallel_tool_calls: false, tools: AGENT_TOOLS, messages }); const calls=result.choices[0]?.message?.tool_calls?.map(call=>call.type==='function'?call.function.name:'').filter(Boolean) || []; logAiRequest({kind:'chat',model:config.model,promptName:'assistant',promptVersion:SYSTEM_PROMPT_VERSION,toolsCalled:calls,promptTokens:result.usage?.prompt_tokens,completionTokens:result.usage?.completion_tokens,totalTokens:result.usage?.total_tokens,latencyMs:Date.now()-started,status:'ok'}); return result; } catch(error) { logAiRequest({kind:'chat',model:config.model,promptName:'assistant',promptVersion:SYSTEM_PROMPT_VERSION,latencyMs:Date.now()-started,status:requestStatus(error),errorCode:error instanceof Error?error.message:'UNKNOWN'}); throw error; } }
export async function streamAgentStep(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], onDelta: (text:string)=>void) {
  const started=Date.now(); const config=providerConfig(); const response=await fetch(config.url,{method:'POST',headers:{'Content-Type':'application/json',...(config.key?{Authorization:`Bearer ${config.key}`}:{})},signal:AbortSignal.timeout(config.timeout),body:JSON.stringify({model:config.model,temperature:.2,max_tokens:600,tool_choice:'auto',parallel_tool_calls:false,tools:AGENT_TOOLS,messages,stream:true,stream_options:{include_usage:true}})});
  if(!response.ok||!response.body) throw new Error('AI_UNAVAILABLE');
  const reader=response.body.getReader(), decoder=new TextDecoder(); let buffer='',content='',usage:any,toolCalls:Record<number,{id:string;type:'function';function:{name:string;arguments:string}}>= {};
  const consume=(line:string)=>{if(!line.startsWith('data:'))return; const value=line.slice(5).trim(); if(value==='[DONE]')return; const chunk=JSON.parse(value); usage=chunk.usage||usage; const delta=chunk.choices?.[0]?.delta; if(delta?.content){content+=delta.content;onDelta(delta.content);} for(const call of delta?.tool_calls||[]){const item=toolCalls[call.index] ||= {id:call.id||'',type:'function',function:{name:'',arguments:''}}; item.id+=call.id||''; item.function.name+=call.function?.name||''; item.function.arguments+=call.function?.arguments||'';}};
  while(true){const part=await reader.read(); if(part.done)break; buffer+=decoder.decode(part.value,{stream:true}); let index; while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);consume(line);}}
  logAiRequest({kind:'chat',model:config.model,promptName:'assistant',promptVersion:SYSTEM_PROMPT_VERSION,toolsCalled:Object.values(toolCalls).map(call=>call.function.name).filter(Boolean),promptTokens:usage?.prompt_tokens,completionTokens:usage?.completion_tokens,totalTokens:usage?.total_tokens,latencyMs:Date.now()-started,status:'ok'});
  return {choices:[{message:{role:'assistant',content,tool_calls:Object.values(toolCalls)},usage}]} as unknown as OpenAI.Chat.Completions.ChatCompletion;
}
export async function querySearch(customerText: string, history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []) { return structured(SearchQuerySchema, 'search_query', [{ role: 'system', content: prompt('query').text }, ...history.slice(-6), { role: 'user', content: customerText }]); }
export async function checkAnswer(reply: string, context: unknown) { return structured(AnswerMetaSchema, 'answer_meta', [{ role: 'system', content: prompt('answer-meta').text }, { role: 'user', content: JSON.stringify({ reply, context }) }]); }
export async function extractNeedsAfterReply(customerText: string, reply: string) {
  const messages=[{ role: 'system' as const, content: prompt('needs').text }, { role: 'user' as const, content: JSON.stringify({ customer_text: customerText, assistant_reply: reply }) }];
  const raw=(await structured(z.object({needs:z.array(NeedEntrySchema).max(8)}), 'needs_v1', messages)).needs;
  const entries: z.infer<typeof NeedEntrySchema>[] = [], invalid: unknown[] = [];
  for (const entry of raw) { const parsed=NeedEntrySchema.safeParse(entry); if(parsed.success) entries.push(parsed.data); else invalid.push(entry); }
  return { entries, invalid };
}
export function parseToolCall(name: string, args: unknown) { const schema = ToolArgs[name as ToolName]; if (!schema) return { success: false as const, error: 'unknown_tool' }; const parsed = schema.safeParse(args); return parsed.success ? { success: true as const, data: parsed.data } : { success: false as const, error: 'invalid_arguments' }; }
export { SearchQuerySchema, AnswerMetaSchema, NeedsV1Schema, ToolCallSchema };
