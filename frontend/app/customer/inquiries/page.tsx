import { requirePageSession } from '@/lib/auth-server';
import { CustomerInquiries } from '@/components/customer-inquiries';
export const metadata={title:'Yêu cầu tư vấn của tôi | NexCall',robots:{index:false,follow:false}};
export default async function InquiriesPage(){const session=await requirePageSession('/customer/inquiries',['User']);return <CustomerInquiries role={session.role}/>;}
