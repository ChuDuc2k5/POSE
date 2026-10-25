import { publicPageRole } from '@/lib/page-session';
import { SiteHeader } from '@/components/site-header';
import { InquiryForm } from '@/components/inquiry-form';
export const metadata={title:'Gửi yêu cầu tư vấn | TERAVA',robots:{index:false,follow:false}};
export default async function ConsultationPage(){const role=await publicPageRole('/consultation');return <><SiteHeader role={role}/><main className="discovery-main container"><InquiryForm guest={role===null}/></main></>;}
