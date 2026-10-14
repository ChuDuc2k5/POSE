import { NextRequest } from 'next/server';
import { callAccess } from '@/lib/calling/server';
import { catalogDatabaseError,catalogError,catalogJson } from '@/lib/next-api-bridge';
import { uuidPattern } from '@/lib/catalog';
export async function GET(request:NextRequest){
 try{const access=await callAccess();if(access.error)return access.error;
  let query=access.client.from('calls').select('*').order('created_at',{ascending:false}).limit(100);
  for(const key of ['campaign_id','status','provider']){const value=request.nextUrl.searchParams.get(key);if(value){if(key==='campaign_id'&&!uuidPattern.test(value)||value.length>80)return catalogError('INVALID_FILTER','Bộ lọc không hợp lệ.',400);query=query.eq(key,value);}}
  const result=await query;return result.error?catalogDatabaseError(result.error):catalogJson({items:result.data});
 }catch{return catalogError('CALLS_UNAVAILABLE','Không thể tải cuộc gọi.',503);}
}
