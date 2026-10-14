import { SystemHome } from "@/components/system-home";
import { redirectSignedInUser } from '@/lib/auth-server';

export default async function Home() {
  await redirectSignedInUser('/');
  return <SystemHome/>;
}
