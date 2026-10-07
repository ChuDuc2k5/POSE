import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { redirectSignedInUser } from '@/lib/auth-server';
export const metadata: Metadata = { title: 'Đăng nhập | NexCall' };
export default async function SignIn({ searchParams }: { searchParams: Promise<{ verification?: string }> }) {
  await redirectSignedInUser('/sign-in');
  return <AuthForm mode="signin" verificationFailed={(await searchParams).verification === 'failed'}/>;
}
