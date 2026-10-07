import Link from 'next/link';
export const metadata = { title: 'Khôi phục tài khoản | NexCall', referrer: 'no-referrer' as const };
export default function RecoveryCallback() {
  return <main className="account-page"><section className="account-card"><h1>Đang xác minh liên kết</h1><p>Vui lòng đợi trong khi hệ thống kiểm tra liên kết khôi phục tài khoản.</p><Link href="/forgot-password" className="button secondary">Yêu cầu liên kết mới</Link></section></main>;
}
