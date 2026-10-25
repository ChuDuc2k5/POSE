'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CatalogRequestError } from '@/lib/catalog-client';
import { propertyTypeLabels } from '@/lib/catalog';
import { leadStatusLabels, need, timelineLabels, type Lead, type LeadStatus, type ManagementCriteria } from '@/lib/leads';
import { channelLabels, type Activity, type PropertyRef, type SalesMutate } from '@/lib/sales';
import { PropertyPicker } from './sales-properties';
import s from './sales.module.css';

function SaveForm({ children, onSave, onSaved, onReload, label = 'Lưu thông tin' }: { children: ReactNode; onSave: () => Promise<void>; onSaved: () => void; onReload: () => void; label?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); setConflict(false); try { await onSave(); onSaved(); } catch (e) { setError(e instanceof CatalogRequestError ? [e.message, ...Object.values(e.fields).slice(0, 3)].join(' ') : e instanceof Error ? e.message : 'Chưa thể lưu thông tin.'); setConflict(e instanceof CatalogRequestError && ['VERSION_CONFLICT', 'LEAD_LOCKED'].includes(e.code)); } finally { setBusy(false); } }
  return <form className={s.form} onSubmit={submit}><fieldset disabled={busy}>{children}</fieldset>{error && <div className={s.error} role="alert">{error}{conflict && <button type="button" onClick={onReload}>Tải lại hồ sơ</button>}</div>}<div className={s.footer}><button className={s.primary} disabled={busy}>{busy ? 'Đang lưu…' : label}</button></div></form>;
}
export function ActivityForm({ activity, mutate, onSaved, onReload }: { activity?: Activity; mutate: SalesMutate; onSaved: () => void; onReload: () => void }) {
  const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [time, setTime] = useState(() => local(new Date(activity?.occurred_at || Date.now()))), [channel, setChannel] = useState<string>(activity?.channel || 'Phone');
  const [content, setContent] = useState(activity?.content || ''), [feedback, setFeedback] = useState(activity?.feedback || ''), [properties, setProperties] = useState<PropertyRef[]>(activity?.properties || []), [reason, setReason] = useState('');
  const [requestKey] = useState(() => crypto.randomUUID());
  return <SaveForm onSaved={onSaved} onReload={onReload} label={activity ? 'Lưu chỉnh sửa' : 'Ghi nhận tư vấn'} onSave={() => mutate(activity ? 'activity_edit' : 'activity_create', { ...(activity ? { activity_id: activity.id, activity_version: activity.version } : { request_key: requestKey }), occurred_at: new Date(time).toISOString(), channel, content, feedback, property_ids: properties.map(p => p.property_id) }, reason)}>
    <div className={s.grid2}><label>Thời gian tư vấn<input type="datetime-local" required value={time} max={local(new Date())} onChange={e => setTime(e.target.value)}/></label><label>Kênh tư vấn<select value={channel} onChange={e => setChannel(e.target.value)}>{Object.entries(channelLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
    <label>Nội dung tư vấn<textarea aria-label="Nội dung tư vấn" required minLength={3} maxLength={5000} rows={4} value={content} onChange={e => setContent(e.target.value)} placeholder="Nhu cầu đã trao đổi, thông tin đã giới thiệu…"/></label><label>Phản hồi của khách<textarea aria-label="Phản hồi của khách" rows={3} maxLength={3000} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Khách đang cân nhắc, quan tâm chi tiết nào…"/></label>
    <div><label>BĐS đã giới thiệu (không bắt buộc)</label><PropertyPicker multiple values={properties} onChange={setProperties}/></div>
    {activity && <label>Lý do chỉnh sửa<textarea aria-label="Lý do chỉnh sửa" required minLength={3} maxLength={1000} rows={2} value={reason} onChange={e => setReason(e.target.value)}/></label>}
    {!activity && <p className={s.hint}>Lần ghi nhận đầu tiên sẽ đánh dấu bạn đã tiếp nhận Lead. Trạng thái và điểm tiềm năng được giữ nguyên.</p>}
  </SaveForm>;
}
export function CancelForm({ activity, mutate, onSaved, onReload }: { activity: Activity; mutate: SalesMutate; onSaved: () => void; onReload: () => void }) {
  const [reason, setReason] = useState('');
  return <SaveForm label="Xác nhận hủy hoạt động" onSaved={onSaved} onReload={onReload} onSave={() => mutate('activity_cancel', { activity_id: activity.id, activity_version: activity.version }, reason)}><p>Hoạt động đã hủy vẫn được giữ trong lịch sử tư vấn.</p><label>Lý do hủy<textarea aria-label="Lý do hủy" required minLength={3} maxLength={1000} rows={3} value={reason} onChange={e => setReason(e.target.value)}/></label></SaveForm>;
}
export function NeedsForm({ lead, mutate, onSaved, onReload }: { lead: Lead; mutate: SalesMutate; onSaved: () => void; onReload: () => void }) {
  const [locations, setLocations] = useState(need<string[]>(lead, 'locations', lead.preferred_location ? [lead.preferred_location] : []).join('\n'));
  const [types, setTypes] = useState(need<string[]>(lead, 'property_types', lead.preferred_property_type ? [lead.preferred_property_type] : []));
  const [min, setMin] = useState(lead.budget_min?.toString() || ''), [max, setMax] = useState(lead.budget_max?.toString() || '');
  const [purpose, setPurpose] = useState(lead.buying_purpose || ''), [timeline, setTimeline] = useState(lead.expected_timeline || '');
  const original = lead.needs.management || {};
  const [management, setManagement] = useState<ManagementCriteria>({ transaction_type: original.transaction_type || 'Sale', bedrooms: original.bedrooms ?? null, bedrooms_required: original.bedrooms_required || false, area_min: original.area_min ?? null, area_max: original.area_max ?? null, area_required: original.area_required || false, selected_property_id: original.selected_property_id || null });
  const [selected, setSelected] = useState<PropertyRef[]>(original.selected_property_id ? [{ property_id: original.selected_property_id, snapshot: { code: 'Đã chọn', name: 'BĐS khách đã xác nhận trong hồ sơ' } }] : []);
  const [reason, setReason] = useState('');
  const updateNumber = (k: 'bedrooms' | 'area_min' | 'area_max', value: string) => setManagement(v => ({ ...v, [k]: value === '' ? null : Number(value) }));
  return <SaveForm label="Xác nhận nhu cầu" onSaved={onSaved} onReload={onReload} onSave={() => mutate('confirm_needs', { locations: locations.split('\n').map(v => v.trim()).filter(Boolean), property_types: types, budget_min: min === '' ? null : Number(min), budget_max: max === '' ? null : Number(max), buying_purpose: purpose, expected_timeline: timeline || null, notes: lead.notes || '', management: { ...management, selected_property_id: selected[0]?.property_id || null } }, reason)}>
    <p className={s.hint}>Xác nhận các thông tin đã trao đổi với khách, kể cả khi nội dung AI ghi nhận đã đúng. Có thể để trống thông tin chưa biết.</p>
    <label>Khu vực (mỗi dòng một khu vực)<textarea aria-label="Khu vực (mỗi dòng một khu vực)" rows={2} maxLength={2000} value={locations} onChange={e => setLocations(e.target.value)}/></label>
    <div><label>Loại bất động sản</label><div className={s.checks}>{Object.entries(propertyTypeLabels).map(([k, v]) => <label key={k}><input type="checkbox" checked={types.includes(k)} onChange={e => setTypes(values => e.target.checked ? [...values, k] : values.filter(x => x !== k))}/>{v}</label>)}</div></div>
    <div className={s.grid2}><label>Ngân sách tối thiểu (VNĐ)<input type="number" min="1" max="1000000000000000" step="1" value={min} onChange={e => setMin(e.target.value)}/></label><label>Ngân sách tối đa (VNĐ)<input type="number" min="1" max="1000000000000000" step="1" value={max} onChange={e => setMax(e.target.value)}/></label></div>
    <div className={s.grid2}><label>Nhu cầu giao dịch<select value={management.transaction_type} onChange={e => setManagement(v => ({ ...v, transaction_type: e.target.value as 'Sale' | 'Rent' }))}><option value="Sale">Mua</option><option value="Rent">Thuê</option></select></label><label>Thời gian dự kiến<select value={timeline} onChange={e => setTimeline(e.target.value)}><option value="">Chưa xác định</option>{Object.entries(timelineLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
    <label>Mục đích<input maxLength={100} value={purpose} onChange={e => setPurpose(e.target.value)}/></label>
    <div className={s.grid2}><label>Số phòng ngủ<input type="number" min="0" max="100" step="1" value={management.bedrooms ?? ''} onChange={e => updateNumber('bedrooms', e.target.value)}/></label><label className={s.checkbox}><input type="checkbox" checked={management.bedrooms_required} onChange={e => setManagement(v => ({ ...v, bedrooms_required: e.target.checked }))}/>Số phòng là điều kiện bắt buộc</label></div>
    <div className={s.grid2}>{(['area_min', 'area_max'] as const).map(k => <label key={k}>{k === 'area_min' ? 'Diện tích tối thiểu (m²)' : 'Diện tích tối đa (m²)'}<input type="number" min="0" max="1000000000" step="0.01" value={management[k] ?? ''} onChange={e => updateNumber(k, e.target.value)}/></label>)}</div><label className={s.checkbox}><input type="checkbox" checked={management.area_required} onChange={e => setManagement(v => ({ ...v, area_required: e.target.checked }))}/>Diện tích là điều kiện bắt buộc</label>
    <div><label>BĐS khách đã xác nhận chọn</label><PropertyPicker values={selected} onChange={setSelected}/></div><label>Căn cứ xác nhận<textarea aria-label="Căn cứ xác nhận" required minLength={3} maxLength={1000} rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Thông tin khách đã xác nhận qua cuộc tư vấn…"/></label>
  </SaveForm>;
}
export function ResultForm({ lead, mutate, onSaved, onReload }: { lead: Lead; mutate: SalesMutate; onSaved: () => void; onReload: () => void }) {
  const [status, setStatus] = useState<LeadStatus>(lead.status), [reason, setReason] = useState(''), [properties, setProperties] = useState<PropertyRef[]>([]), [date, setDate] = useState('');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  return <SaveForm label="Lưu kết quả" onSaved={onSaved} onReload={onReload} onSave={() => mutate('result', { status, ...(status === 'CONVERTED' ? { property_id: properties[0]?.property_id || null, purchased_at: date } : {}) }, reason)}>
    <label>Trạng thái sau tư vấn<select value={status} onChange={e => setStatus(e.target.value as LeadStatus)}>{Object.entries(leadStatusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    {status === 'CONVERTED' && <><div><label>BĐS đã mua</label><PropertyPicker values={properties} onChange={setProperties}/></div><label>Ngày mua<input required type="date" max={today} value={date} onChange={e => setDate(e.target.value)}/></label></>}
    <label>{status === 'LOST' ? 'Lý do không thành công' : 'Căn cứ / kết quả xác nhận'}<textarea aria-label={status === 'LOST' ? 'Lý do không thành công' : 'Căn cứ / kết quả xác nhận'} required minLength={3} maxLength={1000} rows={4} value={reason} onChange={e => setReason(e.target.value)}/></label>
    {['CONVERTED', 'LOST'].includes(status) && <p className={s.warning}>Sau khi lưu, hồ sơ sẽ khóa cập nhật trong không gian Sales. Admin có thể mở lại tại Quản lý Lead nếu cần điều chỉnh.</p>}
  </SaveForm>;
}
