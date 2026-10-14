import { NextRequest } from 'next/server';
import { authenticatedSession, authClient } from '@/lib/auth-server';
import { catalogDatabaseError, catalogError, catalogInput, catalogJson } from '@/lib/catalog-server';
import { uuidPattern } from '@/lib/catalog';
export async function GET(request:NextRequest){
  try{
    const session=await authenticatedSession();if(!session)return catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401);
    if(!['Sales','Admin'].includes(session.role))return catalogError('FORBIDDEN','Bạn không có quyền truy cập.',403);
    const client=authClient(session.access);
    if(request.nextUrl.searchParams.get('logs')==='true'){
      if(session.role!=='Admin')return catalogError('FORBIDDEN','Chỉ quản trị viên được xem nhật ký.',403);
      const result=await client.from('ai_action_log').select('*').in('decision',['blocked','flagged']).order('created_at',{ascending:false}).limit(50);
      return result.error ? catalogDatabaseError(result.error):catalogJson({items:result.data});
    }
    const result=await client.from('lead_tasks').select('*,leads(id,version,lead_score,temperature,score_rule_version,score_evidence,customers(full_name))').in('kind',['Handoff','Review']).eq('status','Open').order('created_at',{ascending:false}).limit(50);
    const items=result.data?.map(task=>({...task,leads:task.leads ? {...task.leads,full_name:task.leads.customers?.full_name || 'Khách hàng',score:task.leads.lead_score,classification:task.leads.temperature ? task.leads.temperature[0]+task.leads.temperature.slice(1).toLowerCase():'Unrated'}:null}));
    return result.error ? catalogDatabaseError(result.error):catalogJson({items});
  }catch{return catalogError('AI_UNAVAILABLE','Chưa thể tải công việc.',503);}
}
export async function POST(request:NextRequest){
  try{
    if(request.headers.get('origin')!==request.nextUrl.origin)return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    const session=await authenticatedSession();if(!session)return catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401);
    if(!['Sales','Admin'].includes(session.role))return catalogError('FORBIDDEN','Bạn không có quyền truy cập.',403);
    const parsed=await catalogInput(request);if(parsed.error)return parsed.error;const i=parsed.input;
    if(Object.keys(i).some(k=>!['lead_id','version','classification','reason'].includes(k)) || typeof i.lead_id!=='string' || !uuidPattern.test(i.lead_id) || !Number.isSafeInteger(i.version) || Number(i.version)<0 || !['Hot','Warm','Cold','Unrated'].includes(i.classification as string) || typeof i.reason!=='string' || i.reason.trim().length<3 || i.reason.length>1000)return catalogError('INVALID_INPUT','Nhập lý do thay đổi ít nhất 3 ký tự.',400);
    const result=await authClient(session.access).rpc('pose_override_lead_score',{p_lead:i.lead_id,p_version:i.version,p_classification:i.classification,p_reason:i.reason});
    return result.error ? catalogDatabaseError(result.error):catalogJson({item:result.data});
  }catch{return catalogError('AI_UNAVAILABLE','Chưa thể cập nhật phân loại.',503);}
}
