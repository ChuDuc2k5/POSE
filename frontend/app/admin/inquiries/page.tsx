import { requirePageSession } from '@/lib/page-session';
import { AdminInquiries } from '@/components/admin-inquiries';
export const metadata = { title: 'Tiếp nhận yêu cầu tư vấn | TERAVA', robots: { index: false, follow: false } };
export default async function AdminInquiryPage() {
  await requirePageSession('/admin/inquiries', ['Admin']);
  return <AdminInquiries />;
}
