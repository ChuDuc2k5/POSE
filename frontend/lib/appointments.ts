import type { Lead } from './leads';
export const appointmentStatusLabels = { SCHEDULED: 'Đã lên lịch', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' };
// Legacy enum values are display-only; M09 forms still offer only the three agreed states.
export const appointmentDisplayStatusLabels = { ...appointmentStatusLabels, CONFIRMED: 'Đã xác nhận (lịch cũ)', NO_SHOW: 'Không tham gia (lịch cũ)' };
export const appointmentChannelLabels = { Phone: 'Điện thoại', Online: 'Trực tuyến', InPerson: 'Gặp trực tiếp' };
export const appointmentActionLabels: Record<string, string> = { create: 'Tạo lịch hẹn', edit: 'Chỉnh thông tin', reschedule: 'Đổi lịch', complete: 'Hoàn thành', cancel: 'Hủy lịch', correct: 'Admin sửa sai' };
export type AppointmentStatus = keyof typeof appointmentStatusLabels;
export type AppointmentChannel = keyof typeof appointmentChannelLabels;
export type Appointment = {
  id: string; lead_id: string; sales_id: string; property_id: string | null;
  title: string; starts_at: string; ends_at: string | null; channel: AppointmentChannel | null; location: string; notes: string;
  status: keyof typeof appointmentDisplayStatusLabels; result: string; cancel_reason: string; version: number; created_at: string; updated_at: string; needs_details: boolean;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  sales_name: string; lead_status: Lead['status']; lead_archived: boolean;
  property: { id: string; name: string; code: string; location: string } | null; can_manage: boolean;
};
export type AppointmentHistory = { id: string; action: string; actor_name: string; actor_role: string; reason: string; created_at: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> };
export type AppointmentDetail = { item: Appointment; lead: Lead; history: AppointmentHistory[]; role: 'Admin' | 'Sales' };
export type AppointmentList = { items: Appointment[]; total: number; page: number; pageSize: number; role: 'Admin' | 'Sales' };
export type AppointmentChoice = { id: string; name: string; phone?: string | null; sales_id?: string; sales_name?: string; code?: string; location?: string; status?: string; archived?: boolean };
export type AppointmentChoices = { items: AppointmentChoice[]; total?: number; page?: number; pageSize?: number };
export type AppointmentFilters = { q: string; date_from: string; date_to: string; status: string; sales_id: string; page: number };
export const initialAppointmentFilters = (today: string): AppointmentFilters => ({ q: '', date_from: today, date_to: '', status: '', sales_id: '', page: 1 });
export function appointmentParams(filters: AppointmentFilters, role: 'Admin' | 'Sales') {
  return new URLSearchParams({ page: String(filters.page), pageSize: '12', ...(filters.q ? { q: filters.q } : {}), ...(filters.date_from ? { date_from: filters.date_from } : {}), ...(filters.date_to ? { date_to: filters.date_to } : {}), ...(filters.status ? { status: filters.status } : {}), ...(role === 'Admin' && filters.sales_id ? { sales_id: filters.sales_id } : {}) });
}
export function appointmentDate(instant: string | null) {
  if (!instant) return 'Chưa có giờ kết thúc';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}
export function appointmentLocal(instant: string | null) {
  if (!instant) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(instant));
  const value = (key: string) => parts.find(p => p.type === key)!.value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}
export function appointmentInstant(local: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) || !Number.isFinite(Date.parse(local + ':00+07:00')) || appointmentLocal(local + ':00+07:00') !== local) throw new Error('Chọn ngày giờ hợp lệ theo giờ Việt Nam.');
  return new Date(local + ':00+07:00').toISOString();
}
export function appointmentChannelName(channel: AppointmentChannel | null) { return channel ? appointmentChannelLabels[channel] : 'Chưa xác định hình thức'; }
export function appointmentOverdue(ap: Appointment, now = Date.now()) { return ['SCHEDULED','CONFIRMED'].includes(ap.status) && !!ap.ends_at && Date.parse(ap.ends_at) < now; }
