import { complete } from '../../../backend/src/modules/ai/llm';
import { evidenceReason, outputReason, safeReply, type Evidence } from '../../../backend/src/modules/ai/guard';
// Script lines are spoken back to back; give each one a sentence end.
const sentence=(line:string)=>{const text=line.trim();return !text || /[.!?…]$/.test(text) ? text:`${text}.`;};
export type Script={greeting:string;ai_disclosure:string;purpose:string;consent_prompt:{ai_voice:string;recording:string;transcript:string};needs_questions:string[];closing:string;opt_out:{confirmation:string};policy_version?:string};
export type Conversation={phase:'start'|'AIVoice'|'Recording'|'Transcript'|'needs'|'ended';silences:number;turns:number;consents:Partial<Record<'AIVoice'|'Recording'|'Transcript',boolean>>;end_reason?:string};
export type ConversationResult={state:Conversation;text:string;interrupted:boolean;optOut?:boolean;consent?:{purpose:'AIVoice'|'Recording'|'Transcript';granted:boolean};withdraw?:'Recording'|'Transcript'};
export const initialConversation=():Conversation=>({phase:'start',silences:0,turns:0,consents:{}});
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().trim();
export async function converse(previous:Conversation,script:Script,input:{text:string;speaking?:boolean;mediaFailure?:boolean},properties:Evidence[]=[],lead:unknown={}):Promise<ConversationResult>{
 const state:Conversation=structuredClone(previous),text=input.text.trim(),plain=normalize(text),result:ConversationResult={state,text:'',interrupted:!!input.speaking};
 const end=(reason:string,line=script.closing)=>{state.phase='ended';state.end_reason=reason;result.text=line;return result;};
 if(state.phase==='ended')return result;
 if(/dung goi nua|xoa so|khong muon nhan cuoc goi|do not call/.test(plain)){result.optOut=true;return end('OPT_OUT',script.opt_out.confirmation);}
 if(input.mediaFailure)return end('AI_ERROR','Xin lỗi, hệ thống gặp sự cố. Xin phép kết thúc cuộc gọi.');
 if(/(?:rut|dung|khong).*(?:ghi am|luu ghi am|luu hoi thoai|luu van ban)/.test(plain)){
  const purpose=/ghi am/.test(plain)?'Recording':'Transcript';state.consents[purpose]=false;result.withdraw=purpose;result.text='Đã dừng lưu theo yêu cầu của bạn.';return result;
 }
 if(state.phase==='start'){state.phase='AIVoice';result.text=[script.greeting,script.ai_disclosure,script.purpose,script.consent_prompt.ai_voice].map(sentence).filter(Boolean).join(' ');return result;}
 if(!text){state.silences++;if(state.silences>=3)return end('SILENCE');result.text='Bạn có nghe rõ không? Xin vui lòng trả lời.';return result;}
 state.silences=0;state.turns++;
 if(['AIVoice','Recording','Transcript'].includes(state.phase)){
  const purpose=state.phase as 'AIVoice'|'Recording'|'Transcript',no=/khong|tu choi|no\b/.test(plain),yes=/dong y|duoc|vang|co\b|yes\b|ok\b/.test(plain);
  if(!no&&!yes){result.text='Bạn vui lòng xác nhận đồng ý hay không đồng ý?';return result;}
  state.consents[purpose]=!no;result.consent={purpose,granted:!no};
  if(purpose==='AIVoice'&&no)return end('NO_AI_VOICE_CONSENT');
  state.phase=purpose==='AIVoice'?'Recording':purpose==='Recording'?'Transcript':'needs';
  result.text=state.phase==='Recording'?script.consent_prompt.recording:state.phase==='Transcript'?script.consent_prompt.transcript:script.needs_questions[0];return result;
 }
 if(/khong quan tam|tu choi|khong can|thoi nhe/.test(plain))return end('DECLINED');
 if(/tam biet|ket thuc|cam on.*du roi/.test(plain))return end('CLOSED');
 if(text.length<3){result.text='Bạn có thể nói rõ nhu cầu hơn được không?';return result;}
 try{
  const evidence=properties.filter(p=>!evidenceReason(p)),response=await complete({customer_text:text,lead_context:lead,properties:evidence,search_performed:true,tools_complete:true,voice_call:true});
  result.text=outputReason(response.reply,evidence,text)||response.tool_calls?.length?safeReply:response.reply;return result;
 }catch{return end('AI_ERROR','Xin lỗi, hệ thống gặp sự cố. Xin phép kết thúc cuộc gọi.');}
}
