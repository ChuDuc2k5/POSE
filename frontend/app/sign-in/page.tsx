import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { redirectSignedInUser } from '@/lib/page-session';
export const metadata: Metadata = { title: 'Đăng nhập | TERAVA' };
const oauthErrors: Record<string, string> = {
  cancelled: 'Bạn đã hủy hoặc chưa cho phép đăng nhập Google. Bạn có thể thử lại.',
  expired: 'Phiên đăng nhập Google đã hết hạn hoặc không hợp lệ. Vui lòng bắt đầu lại.',
  unavailable: 'Tài khoản chưa có quyền truy cập hoặc đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.',
  failed: 'Đăng nhập Google chưa thành công. Vui lòng thử lại hoặc dùng email và mật khẩu.',
};
export default async function SignIn({ searchParams }: { searchParams: Promise<{ verification?: string; oauth?: string }> }) {
  await redirectSignedInUser('/sign-in');
  const params = await searchParams;
  return <AuthForm mode="signin" verificationFailed={params.verification === 'failed'} oauthError={oauthErrors[params.oauth || ''] || ''}/>;
}
