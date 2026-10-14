import { NextRequest } from 'next/server';
import { callAccess } from '@/lib/calling/server';
import { catalogInput,catalogDatabaseError,catalogError,catalogJson } from '@/lib/next-api-bridge';
import { converse,initialConversation,type Conversation } from '@/lib/calling/conversation';
import { authClient } from '@/lib/next-api-bridge';
import { uuidPattern } from '@/lib/catalog';
export async function POST(request:NextRequest){
 try{const access=await callAccess(request,true);if(access.error)return access.error;const parsed=await catalogInput(request);if(parsed.error)return parsed.error;const i=parsed.input;
  if(!uuidPattern.test(String(i.script_version_id))||typeof i.text!=='string'||i.text.length>2000||i.property_id!=null&&!uuidPattern.test(String(i.property_id)))return catalogError('INVALID_INPUT','Chọn kịch bản và nhập tối đa 2.000 ký tự.',400);
  const script=await access.client.from('call_script_versions').select('content').eq('id',i.script_version_id).eq('status','Published').maybeSingle();if(script.error)return catalogDatabaseError(script.error);if(!script.data)return catalogError('NOT_FOUND','Kịch bản chưa công bố.',404);
  const products=i.property_id?await authClient().from('property_public_catalog').select('id,code,name,price,availability,updated_at,location,property_type').eq('id',i.property_id):{data:[],error:null};if(products.error)return catalogDatabaseError(products.error);
  const state=i.state as Conversation|undefined;
  if(state&&(!['start','AIVoice','Recording','Transcript','needs','ended'].includes(state.phase)||!state.consents||!Number.isInteger(state.silences)||!Number.isInteger(state.turns)))return catalogError('INVALID_INPUT','Trạng thái hội thoại không hợp lệ.',400);
  return catalogJson(await converse(state||initialConversation(),script.data.content,{text:i.text,speaking:i.speaking===true,mediaFailure:i.mediaFailure===true},products.data||[]));
 }catch{return catalogError('CALLS_UNAVAILABLE','Không thể mô phỏng hội thoại.',503);}
}
