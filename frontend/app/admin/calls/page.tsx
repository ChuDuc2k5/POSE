import { requirePageSession } from '@/lib/page-session';
import { CallsWorkspace } from '@/components/calls-workspace';
export default async function Page(){await requirePageSession('/admin/calls',['Admin']);return <CallsWorkspace/>;}
