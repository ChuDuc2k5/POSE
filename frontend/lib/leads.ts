export const leadStatusLabels = {
  NEW: 'Mới tiếp nhận', CONTACTED: 'Đã liên hệ', QUALIFIED: 'Đủ điều kiện',
  FOLLOW_UP: 'Đang chăm sóc', CONVERTED: 'Đã mua thành công', LOST: 'Không thành công',
};
export type LeadStatus = keyof typeof leadStatusLabels;
export type Temperature = 'HOT' | 'WARM' | 'COLD';
export const temperatureLabels = { HOT: 'Tiềm năng cao', WARM: 'Đang cân nhắc', COLD: 'Tiềm năng thấp', UNRATED: 'Chưa đánh giá' };
export const leadSourceLabels: Record<string, string> = { WebChat: 'Chat tư vấn', Inquiry: 'Yêu cầu tư vấn', Call: 'Cuộc gọi', Manual: 'Nhập thủ công', Import: 'Nhập từ file' };
export const timelineLabels: Record<string, string> = { lt3m: 'Trong 3 tháng', '3to6m': 'Từ 3 đến 6 tháng', gt6m: 'Trên 6 tháng', none: 'Chưa có kế hoạch' };
export const routingLabels: Record<string, string> = {
  missing_information: 'Cần bổ sung loại BĐS, khu vực hoặc ngân sách',
  no_matching_property: 'Chưa có bất động sản phù hợp với nhu cầu',
  no_valid_owner: 'BĐS phù hợp chưa có Sales phụ trách hợp lệ',
  needs_review: 'Có thông tin mâu thuẫn cần xác nhận',
  matched: 'Đã tìm được bất động sản phù hợp',
  closed: 'Hồ sơ đã kết thúc',
};
export const fieldLabels: Record<string, string> = {
  budget_min_vnd: 'Ngân sách tối thiểu', budget_max_vnd: 'Ngân sách tối đa',
  locations: 'Khu vực', property_types: 'Loại bất động sản', timeline: 'Thời gian dự kiến',
  purchase_intent: 'Ý định mua', contact_ready: 'Sẵn sàng liên hệ', next_step: 'Bước tiếp theo',
};
export type ManagementCriteria = {
  transaction_type?: 'Sale' | 'Rent'; bedrooms?: number | null; bedrooms_required?: boolean;
  area_min?: number | null; area_max?: number | null; area_required?: boolean;
  selected_property_id?: string | null; confirmed_by?: string; confirmed_at?: string;
};
export type NeedEvidence = { value: unknown; evidence?: string; confidence?: number; confirmed_by?: string; confirmed_at?: string };
export type Assignment = { id: string; sales_id: string; sales_name: string; assigned_at: string; accepted: boolean; sales_valid: boolean };
export type Lead = {
  id: string; customer_id: string; status: LeadStatus; temperature: Temperature | null; lead_score: number | null;
  budget_min: number | null; budget_max: number | null; preferred_location: string | null;
  preferred_property_type: string | null; buying_purpose: string | null; expected_timeline: string | null;
  notes: string | null; needs: Record<string, unknown> & { management?: ManagementCriteria };
  score_rule_version: string | null;
  score_evidence: { breakdown?: Record<string, { value: unknown; points: number; evidence?: string }>; unknown?: string[]; classification?: string } | null;
  archived: boolean; source: string; version: number; created_at: string; updated_at: string;
  customer: { id: string; full_name: string; phone: string; email: string | null; phone_verified_at: string | null };
  assignment: Assignment | null;
  routing: { reason: string; property_id: string | null; sales_id: string | null; evaluated_at: string } | null;
};
export type LeadList = { items: Lead[]; total: number; page: number; pageSize: number; stats: { total: number; hot: number; warm: number; cold: number; unrated: number; unassigned: number } };
export type PropertyMatch = {
  property_id: string; code: string; name: string; location: string; price: number | null;
  property_type: string; area: number | null; bedrooms: number | null; property_version: number;
  sales_id: string | null; sales_name: string | null; owner_valid: boolean; selected: boolean | null; preference_score: number;
};
export type LeadEvent = {
  id: string; actor_name: string | null; actor_kind: string; action: string; reason: string; created_at: string;
  before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null;
};
export type Extraction = { id: string; field_name: string; field_value: string | null; evidence: string | null; source_kind: string | null; created_at: string };
export type LeadDetail = { item: Lead; history: LeadEvent[]; extractions: Extraction[]; matches: PropertyMatch[]; summary: string | null };
export type SalesOption = { id: string; name: string };
export type OwnerProperty = { id: string; code: string; name: string; location: string; property_type: string; project_name: string; publication: string; availability: string; sales_id: string | null; sales_name: string | null; owner_valid: boolean; owner_version: number };
export type OwnerList = { items: OwnerProperty[]; total: number; page: number; pageSize: number };
export function need<T>(lead: Lead, key: string, fallback: T): T {
  const entry = lead.needs[key];
  if (entry && typeof entry === 'object' && 'value' in entry && entry.value != null) return entry.value as T;
  return fallback;
}
export function leadBudget(lead: Lead) {
  const format = (n: number) => new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  if (lead.budget_min != null && lead.budget_max != null) return format(lead.budget_min) + ' – ' + format(lead.budget_max) + ' ₫';
  if (lead.budget_max != null) return 'Tối đa ' + format(lead.budget_max) + ' ₫';
  if (lead.budget_min != null) return 'Từ ' + format(lead.budget_min) + ' ₫';
  return 'Chưa xác định ngân sách';
}
export function leadDate(date: string) {
  return new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
