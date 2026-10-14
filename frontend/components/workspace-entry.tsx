import Link from 'next/link';
import { Brand } from './brand';
import { LogoutButton } from './logout-button';
import { roleHome, roleLabels, type Role } from '@/lib/roles';

export function WorkspaceEntry({ role, name }: { role: Role; name: string }) {
  return <main className="account-page">
    <header className="account-header container"><Brand href={roleHome(role)}/><Link href="/account" className="text-link">Tài khoản của tôi</Link></header>
    <section className="account-card">
      <span className="eyebrow">{roleLabels[role]}</span>
      <h1>{role === 'Admin' ? 'Không gian quản trị' : 'Trang chủ tư vấn'}</h1>
      <p>Xin chào, {name}. Bạn đã đăng nhập với vai trò {roleLabels[role].toLowerCase()}.</p>
      <p>{role === 'Admin' ? 'Quản lý danh mục bất động sản và theo dõi thông tin sản phẩm trong không gian quản trị.' : 'Chưa có công việc tư vấn được giao. Khi có phân công, thông tin khách hàng và công việc sẽ xuất hiện tại đây.'}</p>
      <Link href={roleHome(role)} className="button secondary">Về trang chủ</Link>
      <LogoutButton/>
    </section>
  </main>;
}
