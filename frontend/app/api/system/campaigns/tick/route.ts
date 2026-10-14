import { NextRequest } from 'next/server';
import { cronAuthorized, systemClient } from '@/lib/next-api-bridge';
import { telephonyConfigured } from '@/lib/calling/config';
import { catalogError, catalogJson } from '@/lib/next-api-bridge';
import { campaignDatabaseError } from '@/lib/campaigns/server';
export async function POST(request:NextRequest) {
 if(!cronAuthorized(request.headers.get('authorization')))return catalogError('UNAUTHORIZED','Cron chưa được xác thực.',401);
 if(!telephonyConfigured())return catalogError('TELEPHONY_NOT_CONFIGURED','Chưa cấu hình nhà cung cấp cuộc gọi.',503);
 try {
  const r=await systemClient().rpc('pose_system_campaign_tick',{p_now:new Date().toISOString()});
  return r.error ? campaignDatabaseError(r.error):catalogJson({item:r.data});
 }catch{return catalogError('CAMPAIGN_UNAVAILABLE','Không thể điều phối chiến dịch.',503);}
}
