import { uuidPattern } from '../../common/catalog.ts';
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 4000;
export type ScriptContent = {
  greeting: string;
  ai_disclosure: string;
  purpose: string;
  consent_prompt: { ai_voice: string; recording: string; transcript: string };
  needs_questions: string[];
  product_source: { property_ids: string[] };
  objections: { trigger: string; response: string }[];
  opt_out: { prompt: string; confirmation: string };
  closing: string;
};
export function scriptErrors(v: unknown) {
  const errors: Record<string, string> = {};
  if (!object(v)) return { content: 'Nhập nội dung kịch bản.' };
  if (
    Object.keys(v).some(
      (k) =>
        ![
          'greeting',
          'ai_disclosure',
          'purpose',
          'consent_prompt',
          'needs_questions',
          'product_source',
          'objections',
          'opt_out',
          'closing',
        ].includes(k),
    )
  )
    errors.content = 'Kịch bản có trường không hợp lệ.';
  for (const k of ['greeting', 'ai_disclosure', 'purpose', 'closing'])
    if (!text(v[k])) errors[k] = 'Nội dung bắt buộc, tối đa 4.000 ký tự.';
  if (typeof v.ai_disclosure !== 'string' || !/\bAI\b/i.test(v.ai_disclosure))
    errors.ai_disclosure = 'Phải giới thiệu rõ trợ lý AI.';
  for (const k of ['ai_voice', 'recording', 'transcript'])
    if (!object(v.consent_prompt) || !text(v.consent_prompt[k]))
      errors[`consent_prompt.${k}`] = 'Cần câu hỏi đồng ý riêng cho từng mục đích.';
  if (
    object(v.consent_prompt) &&
    Object.keys(v.consent_prompt).some((k) => !['ai_voice', 'recording', 'transcript'].includes(k))
  )
    errors.consent_prompt = 'Trường đồng ý không hợp lệ.';
  for (const k of ['prompt', 'confirmation'])
    if (!object(v.opt_out) || !text(v.opt_out[k]))
      errors[`opt_out.${k}`] = 'Cần hướng dẫn và xác nhận từ chối liên hệ.';
  if (object(v.opt_out) && Object.keys(v.opt_out).some((k) => !['prompt', 'confirmation'].includes(k)))
    errors.opt_out = 'Trường từ chối không hợp lệ.';
  if (
    !Array.isArray(v.needs_questions) ||
    v.needs_questions.length < 1 ||
    v.needs_questions.length > 30 ||
    v.needs_questions.some((x) => !text(x))
  )
    errors.needs_questions = 'Cần 1–30 câu hỏi nhu cầu.';
  if (
    !object(v.product_source) ||
    Object.keys(v.product_source).some((k) => k !== 'property_ids') ||
    !Array.isArray(v.product_source.property_ids) ||
    v.product_source.property_ids.length > 500 ||
    v.product_source.property_ids.some((x) => typeof x !== 'string' || !uuidPattern.test(x))
  )
    errors.product_source = 'Chọn sản phẩm hợp lệ.';
  if (
    !Array.isArray(v.objections) ||
    v.objections.length > 30 ||
    v.objections.some(
      (x) =>
        !object(x) ||
        Object.keys(x).some((k) => !['trigger', 'response'].includes(k)) ||
        !text(x.trigger) ||
        !text(x.response),
    )
  )
    errors.objections = 'Kiểm tra câu từ chối và câu trả lời.';
  return errors;
}
export function conversation(v: ScriptContent) {
  return [
    v.greeting,
    v.ai_disclosure,
    v.purpose,
    v.consent_prompt.ai_voice,
    v.consent_prompt.recording,
    v.consent_prompt.transcript,
    ...v.needs_questions,
    ...v.objections.map((x) => `${x.trigger}: ${x.response}`),
    v.opt_out.prompt,
    v.opt_out.confirmation,
    v.closing,
  ].map((text, i) => ({ turn: i + 1, text }));
}
export const defaultScript: ScriptContent = {
  greeting: 'Xin chào anh/chị.',
  ai_disclosure: 'Tôi là trợ lý AI của TERAVA Group.',
  purpose: 'Tôi liên hệ để tìm hiểu nhu cầu bất động sản.',
  consent_prompt: {
    ai_voice: 'Anh/chị có đồng ý trao đổi với trợ lý AI không?',
    recording: 'Anh/chị có đồng ý lưu ghi âm không?',
    transcript: 'Anh/chị có đồng ý lưu bản chép lời không?',
  },
  needs_questions: ['Anh/chị quan tâm khu vực nào?'],
  product_source: { property_ids: [] },
  objections: [],
  opt_out: {
    prompt: 'Anh/chị có thể yêu cầu dừng và không liên hệ lại bất cứ lúc nào.',
    confirmation: 'Tôi xác nhận yêu cầu không liên hệ lại.',
  },
  closing: 'Cảm ơn anh/chị đã dành thời gian.',
};
