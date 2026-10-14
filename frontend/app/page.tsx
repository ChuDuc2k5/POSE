import { SystemHome } from "@/components/system-home";
import { redirectSignedInUser } from '@/lib/page-session';

export default async function Home() {
  await redirectSignedInUser('/');
  return <SystemHome/>;
}
