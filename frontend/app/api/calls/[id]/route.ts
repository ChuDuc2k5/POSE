import { NextRequest } from 'next/server';
import { callAccess } from '@/lib/calling/server';
import { catalogDatabaseError,catalogError,catalogJson } from '@/lib/next-api-bridge';
import { uuidPattern } from '@/lib/catalog';
export async function GET(_request:NextRequest,{params}:{params:Promise<{id:string}>}){
 try{const access=await callAccess();if(access.error)return access.error;const {id}=await params;
  if(!uuidPattern.test(id))return catalogError('NOT_FOUND','Không tìm thấy cuộc gọi.',404);
  const call=await access.client.from('calls').select('*').eq('id',id).maybeSingle();if(call.error)return catalogDatabaseError(call.error);if(!call.data)return catalogError('NOT_FOUND','Không tìm thấy cuộc gọi.',404);
  const [events,consents,turns]=await Promise.all([access.client.from('call_events').select('*').eq('call_id',id).order('received_at'),access.client.from('contact_consents').select('*').eq('lead_id',call.data.lead_id).order('recorded_at'),access.client.from('call_turns').select('*').eq('call_id',id).order('seq')]);
  const error=events.error||consents.error||turns.error;if(error)return catalogDatabaseError(error);
  return catalogJson({item:call.data,events:events.data,consents:consents.data?.filter(c=>c.evidence.includes(id)),turns:turns.data});
 }catch{return catalogError('CALLS_UNAVAILABLE','Không thể tải cuộc gọi.',503);}
}
