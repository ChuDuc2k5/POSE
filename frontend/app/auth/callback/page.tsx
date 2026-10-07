import Link from 'next/link';
import { Brand } from '@/components/brand';
export default function Callback() {
  return <main className="account-page"><div className="account-header container"><Brand/></div><section className="account-card"><h1>Xác minh email</h1><p>Đang kiểm tra liên kết xác minh của bạn. Nếu liên kết đã hết hạn hoặc không có thông tin xác minh, hãy gửi lại liên kết từ trang đăng nhập.</p><Link href="/sign-in" className="button secondary">Về trang đăng nhập</Link></section></main>;
}
