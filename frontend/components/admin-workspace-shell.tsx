import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from './brand';
import { LogoutButton } from './logout-button';
const sections={campaigns:{title:'Chiến dịch gọi',href:'/admin/campaigns'},calls:{title:'Cuộc gọi',href:'/admin/calls'},ai:{title:'AI Platform',href:'/admin/ai-dashboard'}} as const;
export function AdminWorkspaceShell({section,detail,children}:{section:keyof typeof sections;detail?:string;children:ReactNode}) {
 const {title,href}=sections[section];
 return <main className="catalog-workspace campaigns-workspace admin-workspace">
  <aside className="catalog-sidebar"><Brand light={false} href="/admin"/><div className="catalog-sidebar-label">KHÔNG GIAN QUẢN TRỊ</div>
   <nav aria-label="Quản trị"><Link href="/admin">Danh mục bất động sản</Link><Link href="/admin/campaigns" aria-current={section==='campaigns'?'page':undefined}>Chiến dịch gọi</Link><Link href="/admin/calls" aria-current={section==='calls'?'page':undefined}>Cuộc gọi</Link><Link href="/admin/ai-dashboard" aria-current={section==='ai'?'page':undefined}>AI Platform</Link></nav>
   <div className="catalog-sidebar-note">{section==='ai'?<><h3>Chi phí theo token</h3><p>Chi phí của mỗi lần gọi được chốt theo bảng giá mô hình tại thời điểm gọi; mô hình chạy cục bộ tính 0 USD.</p></>:<><h3>Liên hệ có sự đồng ý</h3><p>Kiểm tra điều kiện trước mỗi lần gọi. Chi phí luôn được ghi nhận bằng VND.</p></>}</div>
   <div className="catalog-sidebar-bottom"><Link href="/account">Hồ sơ cá nhân</Link><LogoutButton/></div>
  </aside>
  <div className="catalog-workspace-main"><header className="catalog-topbar"><div aria-label="Đường dẫn"><Link href="/admin">Quản trị</Link><span>›</span><Link href={href}>{title}</Link>{detail&&<><span>›</span><span>{detail}</span></>}</div></header><div className="catalog-content">{children}</div></div>
 </main>;
}
