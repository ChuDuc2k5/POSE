import { requirePageSession } from '@/lib/auth-server';
import { CallPlayground } from '@/components/call-playground';
export default async function Page(){await requirePageSession('/admin/calls/playground',['Admin']);return <CallPlayground/>;}
