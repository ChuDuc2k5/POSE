export type SalesAccount = {
  id: string; name: string; email: string; phone: string; status: 'active' | 'suspended';
  version: number; profile_version: number; requires_activation: boolean; email_verified: boolean;
  last_sign_in_at: string | null; created_at: string | null; updated_at: string | null;
};
export type SalesList = { items: SalesAccount[]; total: number; page: number; pageSize: number; stats: { total: number; active: number; suspended: number } };
export type SalesHistory = { id: string; actor_id: string; actor_name: string; action: 'Created' | 'Updated' | 'Activated' | 'Suspended'; before_data: SalesAccount | null; after_data: SalesAccount; reason: string; created_at: string };
export const salesActionLabels = { Created: 'Tạo tài khoản', Updated: 'Cập nhật thông tin', Activated: 'Kích hoạt tài khoản', Suspended: 'Tạm khóa tài khoản' };
export function salesDate(value: string | null) { return value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa có'; }
