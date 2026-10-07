import Link from 'next/link';

export default function ForbiddenPage() {
  return <main className="account-page"><section className="account-card"><span className="eyebrow">QUYỀN TRUY CẬP</span><h1>Bạn không có quyền truy cập</h1><p>Tài khoản hiện tại không được phép mở trang này. Hãy liên hệ quản trị viên nếu bạn cần được cấp quyền.</p><Link href="/account" className="button primary">Về tài khoản của tôi</Link></section></main>;
}
