import { NextRequest } from 'next/server';
import { campaignRoute } from '@/lib/campaigns/server';
async function handle(request:NextRequest,context:RouteContext<'/api/admin/campaigns/[...path]'>) {
 return campaignRoute(request,(await context.params).path);
}
export { handle as GET, handle as POST, handle as PATCH };
