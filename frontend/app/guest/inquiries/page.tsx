import { publicPageRole } from '@/lib/page-session';
import { CustomerInquiries } from '@/components/customer-inquiries';
export const metadata={title:'Yêu cầu trên trình duyệt này | TERAVA',robots:{index:false,follow:false}};
export default async function GuestInquiriesPage(){const role=await publicPageRole('/guest/inquiries');return <CustomerInquiries role={role} guest/>;}
