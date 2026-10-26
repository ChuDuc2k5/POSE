import type { CatalogItem } from './catalog';
import type { Lead, LeadDetail, SalesOption } from './leads';
export type SalesAccount = {
  id: string; name: string; email: string; phone: string; status: 'active' | 'suspended';
  version: number; profile_version: number; requires_activation: boolean; email_verified: boolean;
  last_sign_in_at: string | null; created_at: string | null; updated_at: string | null;
  territories?: string[];
};
export type SalesList = { items: SalesAccount[]; total: number; page: number; pageSize: number; stats: { total: number; active: number; suspended: number } };
export type SalesHistory = { id: string; actor_id: string; actor_name: string; action: 'Created' | 'Updated' | 'Activated' | 'Suspended'; before_data: SalesAccount | null; after_data: SalesAccount; reason: string; created_at: string };
export const salesActionLabels = { Created: 'Tạo tài khoản', Updated: 'Cập nhật thông tin', Activated: 'Kích hoạt tài khoản', Suspended: 'Tạm khóa tài khoản' };
export function salesDate(value: string | null) { return value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa có'; }
export const channelLabels = { Phone: 'Điện thoại', Message: 'Tin nhắn', InPerson: 'Gặp trực tiếp', Online: 'Trực tuyến' };
export type SalesLead = Lead & { activity_count: number; last_activity_at: string | null };
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type SalesLeadList = Page<SalesLead> & { stats: { total: number; open: number; closed: number; unaccepted: number } };
export type SalesOptions = { directory_id: string | null; sales: (SalesOption & { active: boolean })[] };
export type SalesProperty = CatalogItem & { project_name: string; subdivision_name: string | null; sales_id: string; sales_name: string; cover_id?: string | null; transaction_type: 'Sale' | 'Rent'; price_period: 'Total' | 'Month' };
export type PropertyDetail = { item: SalesProperty; media: { id: string; name: string; media_type: 'Image' | 'Document' }[] };
export type PropertyRef = { property_id: string; snapshot: { code: string; name: string; location?: string; price?: number | null } };
export type Activity = { id: string; lead_id: string; assignment_id: string; sales_id: string; sales_name: string; created_by: string; customer_name: string; occurred_at: string; channel: keyof typeof channelLabels; content: string; feedback: string; cancelled_at: string | null; cancel_reason: string | null; created_at: string; updated_at: string; version: number; can_edit: boolean; properties: PropertyRef[] };
export type SalesDetail = Omit<LeadDetail, 'matches'> & { can_write: boolean; confirmation: { at: string; by: string | null; reason: string } | null };
export type SalesAppointment = { id: string; appointment_time: string; ends_at: string; property_name: string | null; property_code: string | null; customer_name: string; phone: string; note: string | null; status: string; sales_name?: string | null };
export type SalesDetailWithAppointments = SalesDetail & { appointments: SalesAppointment[] };
export type SalesMutate = (action: string, data: Record<string, unknown>, reason?: string) => Promise<void>;
export const salesEventLabels: Record<string, string> = { sales_activity_create: 'Ghi nhận tư vấn', sales_activity_edit: 'Sửa hoạt động tư vấn', sales_activity_cancel: 'Hủy hoạt động tư vấn', sales_result_confirmed: 'Kết quả Sales đã xác nhận', sales_needs_confirmed: 'Xác nhận nhu cầu', lead_accepted: 'Tiếp nhận Lead', lead_status: 'Xác nhận kết quả', lead_profile: 'Cập nhật hồ sơ nhu cầu', lead_archive: 'Cập nhật lưu trữ', needs_extracted: 'Ghi nhận nhu cầu từ AI', score_applied: 'Chấm điểm tiềm năng', lead_assigned: 'Phân công Sales', lead_auto_assigned: 'Tự động phân công' };
