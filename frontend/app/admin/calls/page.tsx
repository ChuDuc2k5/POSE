import { requirePageSession } from '@/lib/auth-server';
import { CallsWorkspace } from '@/components/calls-workspace';
export default async function Page(){await requirePageSession('/admin/calls',['Admin']);return <CallsWorkspace/>;}
