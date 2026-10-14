import { NextRequest } from 'next/server';
import { evidence } from '@/lib/calling/server';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){return evidence(request,(await params).id,'recording');}
