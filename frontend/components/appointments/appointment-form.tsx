'use client';
import { useState, type FormEvent } from 'react';
import { CatalogRequestError } from '@/lib/catalog-client';
import { appointmentChannelLabels, appointmentInstant, appointmentLocal, appointmentStatusLabels, type Appointment, type AppointmentChannel, type AppointmentChoice, type AppointmentStatus } from '@/lib/appointments';
import { AppointmentPicker } from './appointment-picker';
import s from './appointments.module.css';
export type AppointmentAction = 'create' | 'edit' | 'reschedule' | 'complete' | 'cancel' | 'correct';
export function AppointmentForm({ action, item, role, onSave, onReload, onCancel, onBusy }: { action: AppointmentAction; item?: Appointment; role: 'Admin' | 'Sales'; onSave: (data: Record<string, unknown>, reason: string) => Promise<void>; onReload: () => void; onCancel: () => void; onBusy: (busy: boolean) => void }) {
  const [lead, setLead] = useState<AppointmentChoice | null>(item ? { id: item.lead_id, name: item.customer.name, sales_name: item.sales_name, status: item.lead_status, archived: item.lead_archived } : null);
  const [property, setProperty] = useState<AppointmentChoice | null>(item?.property || null);
  const [title, setTitle] = useState(item?.title || ''), [channel, setChannel] = useState<AppointmentChannel | ''>(item ? item.channel || '' : 'Phone');
  const [start, setStart] = useState(item ? appointmentLocal(item.starts_at) : ''), [end, setEnd] = useState(item ? appointmentLocal(item.ends_at) : '');
  const [location, setLocation] = useState(item?.location || ''), [notes, setNotes] = useState(item?.notes || '');
  const [result, setResult] = useState(item?.result || ''), [cancelReason, setCancelReason] = useState(item?.cancel_reason || ''), [status, setStatus] = useState<AppointmentStatus | ''>(item && item.status in appointmentStatusLabels ? item.status as AppointmentStatus : '');
  const [reason, setReason] = useState(''), [requestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const full = ['create', 'edit', 'correct'].includes(action), time = ['create', 'reschedule', 'correct'].includes(action);
  const reasonRequired = ['reschedule', 'cancel', 'correct'].includes(action) || role === 'Admin' && (action !== 'create' || !!lead && (!!lead.archived || ['CONVERTED', 'LOST'].includes(lead.status || '')));
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); onBusy(true); setError(''); setConflict(false);
    try {
      if (action === 'create' && !lead) throw new Error('Chọn Lead / khách hàng trước khi tạo lịch.');
      const data: Record<string, unknown> = {};
      if (full) Object.assign(data, { title, channel, location, notes, property_id: property?.id || null });
      if (time) {
        const starts_at = appointmentInstant(start), ends_at = appointmentInstant(end);
        if (ends_at <= starts_at) throw new Error('Giờ kết thúc phải sau giờ bắt đầu.');
        if ((action === 'create' || action === 'reschedule' && role === 'Sales') && Date.parse(starts_at) <= Date.now()) throw new Error('Giờ bắt đầu phải ở tương lai.');
        Object.assign(data, { starts_at, ends_at });
      }
      if (action === 'create') Object.assign(data, { lead_id: lead!.id, request_key: requestKey });
      if (action === 'complete') data.result = result;
      if (action === 'correct') Object.assign(data, { status, result: status === 'COMPLETED' ? result : '', cancel_reason: status === 'CANCELLED' ? cancelReason : '' });
      await onSave(data, reason);
    } catch (e) {
      setError(e instanceof CatalogRequestError ? [e.message, ...Object.values(e.fields)].join(' ') : e instanceof Error ? e.message : 'Chưa thể lưu lịch hẹn.');
      setConflict(e instanceof CatalogRequestError && ['VERSION_CONFLICT', 'LEAD_LOCKED', 'APPOINTMENT_LOCKED', 'APPOINTMENT_INCOMPLETE', 'FORBIDDEN', 'REQUEST_CONFLICT'].includes(e.code));
    } finally { setBusy(false); onBusy(false); }
  }
  return <form className={s.form} onSubmit={submit}><fieldset disabled={busy}>
    {action === 'create' ? <AppointmentPicker kind="leads" value={lead} onChange={v => { setLead(v); setProperty(null); }}/> : <div className={s.readonly}><strong>{item?.customer.name}</strong><span>Sales: {item?.sales_name}</span></div>}
    {full && <><label>Tiêu đề / nội dung hẹn *<input aria-label="Tiêu đề / nội dung hẹn" required minLength={3} maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ví dụ: Tư vấn căn hộ theo ngân sách"/></label>
      <label>Hình thức *<select aria-label="Hình thức" required value={channel} onChange={e => setChannel(e.target.value as AppointmentChannel)}><option value="" disabled>Chọn hình thức</option>{Object.entries(appointmentChannelLabels).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
      {channel && channel !== 'Phone' && <label>{channel === 'Online' ? 'Link cuộc họp *' : 'Địa điểm *'}<input aria-label={channel === 'Online' ? 'Link cuộc họp' : 'Địa điểm'} type={channel === 'Online' ? 'url' : 'text'} required minLength={3} maxLength={1000} value={location} onChange={e => setLocation(e.target.value)}/></label>}
      {channel === 'Phone' && <p className={s.hint}>Liên hệ theo số điện thoại trong hồ sơ khách hàng.</p>}
      <AppointmentPicker key={lead?.id || 'none'} kind="properties" value={property} leadId={lead?.id} onChange={setProperty}/>
      <label>Ghi chú<textarea aria-label="Ghi chú" maxLength={3000} rows={3} value={notes} onChange={e => setNotes(e.target.value)}/></label></>}
    {time && <><div className={s.twoColumns}><label>Bắt đầu *<input aria-label="Bắt đầu" type="datetime-local" required value={start} onChange={e => setStart(e.target.value)}/></label><label>Kết thúc *<input aria-label="Kết thúc" type="datetime-local" required value={end} onChange={e => setEnd(e.target.value)}/></label></div><p className={s.hint}>Ngày giờ Việt Nam (UTC+7). Hai lịch nối tiếp nhau được phép.</p></>}
    {action === 'correct' && <label>Trạng thái sau khi sửa *<select aria-label="Trạng thái sau khi sửa" required value={status} onChange={e => setStatus(e.target.value as AppointmentStatus)}><option value="" disabled>Chọn trạng thái sau khi sửa</option>{Object.entries(appointmentStatusLabels).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>}
    {(action === 'complete' || action === 'correct' && status === 'COMPLETED') && <label>Kết quả cuộc hẹn *<textarea aria-label="Kết quả cuộc hẹn" required minLength={3} maxLength={3000} rows={4} value={result} onChange={e => setResult(e.target.value)} placeholder="Nội dung đã trao đổi, phản hồi và kết quả…"/></label>}
    {action === 'correct' && status === 'CANCELLED' && <label>Lý do hủy lịch *<textarea aria-label="Lý do hủy lịch" required minLength={3} maxLength={1000} rows={2} value={cancelReason} onChange={e => setCancelReason(e.target.value)}/></label>}
    {action === 'cancel' && <p>Lịch đã hủy vẫn được giữ trong hồ sơ. Nếu khách muốn hẹn lại, hãy tạo lịch mới.</p>}
    {(reasonRequired || role === 'Admin') && <label>{action === 'cancel' ? 'Lý do hủy' : action === 'reschedule' ? 'Lý do đổi lịch' : 'Lý do thao tác'}{reasonRequired ? ' *' : ' (bắt buộc nếu Lead đã đóng/lưu trữ)'}<textarea aria-label="Lý do thao tác" required={reasonRequired} minLength={reasonRequired ? 3 : undefined} maxLength={1000} rows={2} value={reason} onChange={e => setReason(e.target.value)}/></label>}
  </fieldset>{error && <div className={s.error} role="alert">{error}{conflict && <button type="button" onClick={onReload}>Tải lại lịch</button>}</div>}
    <div className={s.formFooter}><button type="button" className={s.secondary} disabled={busy} onClick={onCancel}>Quay lại</button><button className={action === 'cancel' ? s.danger : s.primary} disabled={busy}>{busy ? 'Đang lưu…' : action === 'create' ? 'Tạo lịch hẹn' : action === 'complete' ? 'Xác nhận hoàn thành' : action === 'cancel' ? 'Xác nhận hủy' : 'Lưu thay đổi'}</button></div>
  </form>;
}
