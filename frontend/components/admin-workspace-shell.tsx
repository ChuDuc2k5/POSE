import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from './brand';
import { LogoutButton } from './logout-button';
export function AdminWorkspaceShell({section,detail,children}:{section:'campaigns'|'calls';detail?:string;children:ReactNode}) {
 const title=section==='calls'?'Cuộc gọi':'Chiến dịch gọi';
 return <main className="catalog-workspace campaigns-workspace admin-workspace">
  <aside className="catalog-sidebar"><Brand light={false} href="/admin"/><div className="catalog-sidebar-label">KHÔNG GIAN QUẢN TRỊ</div>
   <nav aria-label="Quản trị"><Link href="/admin">Danh mục bất động sản</Link><Link href="/admin/campaigns" aria-current={section==='campaigns'?'page':undefined}>Chiến dịch gọi</Link><Link href="/admin/calls" aria-current={section==='calls'?'page':undefined}>Cuộc gọi</Link></nav>
   <div className="catalog-sidebar-note"><h3>Liên hệ có sự đồng ý</h3><p>Kiểm tra điều kiện trước mỗi lần gọi. Chi phí luôn được ghi nhận bằng VND.</p></div>
   <div className="catalog-sidebar-bottom"><Link href="/account">Hồ sơ cá nhân</Link><LogoutButton/></div>
  </aside>
  <div className="catalog-workspace-main"><header className="catalog-topbar"><div aria-label="Đường dẫn"><Link href="/admin">Quản trị</Link><span>›</span><Link href={`/admin/${section}`}>{title}</Link>{detail&&<><span>›</span><span>{detail}</span></>}</div></header><div className="catalog-content">{children}</div></div>
 </main>;
}
