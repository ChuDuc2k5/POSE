import { requirePageSession } from '@/lib/page-session';
import { CallsWorkspace } from '@/components/calls-workspace';
export default async function Page({params}:{params:Promise<{id:string}>}){await requirePageSession('/admin/calls/[id]',['Admin']);return <CallsWorkspace id={(await params).id}/>;}
