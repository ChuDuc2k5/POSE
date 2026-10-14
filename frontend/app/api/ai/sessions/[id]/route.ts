import { NextRequest } from 'next/server';
import { getChat } from '@/lib/ai/server';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){return getChat(request,(await params).id);}
