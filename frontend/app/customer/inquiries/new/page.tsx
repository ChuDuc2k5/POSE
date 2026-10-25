import { requirePageSession } from '@/lib/page-session';
import { SiteHeader } from '@/components/site-header';
import { CustomerNav } from '@/components/customer-nav';
import { InquiryForm } from '@/components/inquiry-form';
import { AiChatPage } from '@/components/ai-chat-provider';
export const metadata={title:'Gửi yêu cầu tư vấn | TERAVA',robots:{index:false,follow:false}};
export default async function NewInquiryPage(){const session=await requirePageSession('/customer/inquiries/new',['User']);return <><SiteHeader role={session.role}/><main className="discovery-main container"><CustomerNav active="inquiries"/><InquiryForm/></main><AiChatPage ownerKey={session.user.id} signedIn/></>;}
