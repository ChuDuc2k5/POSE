import { requirePageSession } from '@/lib/page-session';
import Link from 'next/link';
import { Brand } from '@/components/brand';
import { LogoutButton } from '@/components/logout-button';
import { readProfile } from '@/lib/page-profile';
import { CallsWorkspace } from '@/components/calls-workspace';
import { AiWorkspace } from '@/components/ai-workspace';

export default async function SalesPage() {
  const session = await requirePageSession('/sales', ['Sales', 'Admin']);
  const profile=await readProfile();
  return <main className="calls-sales-workspace"><header className="calls-sales-header"><Brand href="/sales"/><div><Link href="/account">{profile.name} · Hồ sơ cá nhân</Link><LogoutButton/></div></header><div className="calls-sales-intro"><span className="eyebrow">KHÔNG GIAN TƯ VẤN</span><h1>Trang chủ tư vấn</h1><p>Xin chào, {profile.name}. Theo dõi khách hàng được giao và các đề nghị tư vấn.</p></div><CallsWorkspace sales/><AiWorkspace/></main>;
}
