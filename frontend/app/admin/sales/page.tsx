import { requirePageSession } from '@/lib/page-session';
import { AdminSales } from '@/components/admin-sales';
export const metadata = { title: 'Quản lý Sales | TERAVA', robots: { index: false, follow: false } };
export default async function AdminSalesPage() {
  await requirePageSession('/admin/sales', ['Admin']);
  return <AdminSales />;
}
