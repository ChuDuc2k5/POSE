import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { redirectSignedInUser } from '@/lib/page-session';
export const metadata: Metadata = { title: 'Đăng nhập | TERAVA' };
export default async function SignIn({ searchParams }: { searchParams: Promise<{ verification?: string; next?: string }> }) {
  await redirectSignedInUser('/sign-in');
  const params=await searchParams;
  return <AuthForm mode="signin" verificationFailed={params.verification === 'failed'} next={params.next}/>;
}
