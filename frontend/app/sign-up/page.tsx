import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { redirectSignedInUser } from '@/lib/auth-server';
export const metadata: Metadata = { title: 'Đăng ký | NexCall' };
export default async function SignUp() {
  await redirectSignedInUser('/sign-up');
  return <AuthForm mode="signup"/>;
}
