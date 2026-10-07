import { requirePageSession } from '@/lib/auth-server';
import { SiteHeader } from '@/components/site-header';
import { CustomerNav } from '@/components/customer-nav';
import { InquiryForm } from '@/components/inquiry-form';
export const metadata={title:'Gửi yêu cầu tư vấn | NexCall',robots:{index:false,follow:false}};
export default async function NewInquiryPage(){const session=await requirePageSession('/customer/inquiries/new',['User']);return <><SiteHeader role={session.role}/><main className="discovery-main container"><CustomerNav active="inquiries"/><InquiryForm/></main></>;}
