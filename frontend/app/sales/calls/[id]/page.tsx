import { requirePageSession } from '@/lib/page-session';
import { CallsWorkspace } from '@/components/calls-workspace';
export default async function Page({params}:{params:Promise<{id:string}>}){await requirePageSession('/sales/calls/[id]',['Sales','Admin']);return <CallsWorkspace sales id={(await params).id}/>;}
