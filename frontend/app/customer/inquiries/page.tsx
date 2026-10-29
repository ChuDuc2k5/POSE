import { requirePageSession } from '@/lib/page-session';
import { CustomerInquiries } from '@/components/customer-inquiries';
import { AiChatPage } from '@/components/ai-chat-provider';
export const metadata = { title: 'Yêu cầu tư vấn của tôi | TERAVA', robots: { index: false, follow: false } };
export default async function InquiriesPage() {
  const session = await requirePageSession('/customer/inquiries', ['User']);
  return (
    <>
      <CustomerInquiries role={session.role} />
      <AiChatPage ownerKey={session.user.id} signedIn />
    </>
  );
}
