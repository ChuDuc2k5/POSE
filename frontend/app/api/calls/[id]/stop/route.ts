import { NextRequest } from 'next/server';
import { stop } from '@/lib/calling/server';
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return stop(request,(await params).id);}
