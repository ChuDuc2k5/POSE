import { PasswordRecovery } from '@/components/password-recovery';
export const metadata = { title: 'Đặt lại mật khẩu | NexCall', robots: { index: false, follow: false } };
export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ verification?: string }> }) {
  return <PasswordRecovery reset verificationFailed={(await searchParams).verification === 'failed'}/>;
}
