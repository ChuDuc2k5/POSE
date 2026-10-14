import { NextRequest } from 'next/server';
import { campaignRoute } from '@/lib/campaigns/server';
export const GET=(request:NextRequest)=>campaignRoute(request);
export const POST=(request:NextRequest)=>campaignRoute(request);
