import { requirePageSession } from '@/lib/page-session';
import { CallPlayground } from '@/components/call-playground';
export default async function Page() {
  await requirePageSession('/admin/calls/playground', ['Admin']);
  return <CallPlayground />;
}
