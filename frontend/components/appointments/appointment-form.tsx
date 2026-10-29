'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { CatalogRequestError } from '@/lib/catalog-client';
import {
  appointmentChannelLabels,
  appointmentInstant,
  appointmentLocal,
  appointmentStatusLabels,
  type Appointment,
  type AppointmentChannel,
  type AppointmentChoice,
  type AppointmentStatus,
} from '@/lib/appointments';
import { AppointmentPicker } from './appointment-picker';
import { useAppointmentResource } from './use-appointment-resource';
import s from './appointments.module.css';

type Suggestion = {
  sales_id: string;
  name: string;
  score: number;
  recommended: boolean;
  reasons: string[];
  is_current_owner: boolean;
  upcoming_appointments: number;
  open_leads: number;
};
type SuggestionResponse = {
  area: string | null;
  area_source: 'property' | 'history' | 'preference' | null;
  suggestions: Suggestion[];
};
export type AppointmentAction = 'create' | 'edit' | 'reschedule' | 'complete' | 'cancel' | 'correct';

export function AppointmentForm({
  action,
  item,
  role,
  onSave,
  onReload,
  onCancel,
  onBusy,
}: {
  action: AppointmentAction;
  item?: Appointment;
  role: 'Admin' | 'Sales';
  onSave: (data: Record<string, unknown>, reason: string) => Promise<void>;
  onReload: () => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [lead, setLead] = useState<AppointmentChoice | null>(
      item
        ? {
            id: item.lead_id,
            name: item.customer.name,
            sales_name: item.sales_name,
            status: item.lead_status,
            archived: item.lead_archived,
          }
        : null,
    ),
    [property, setProperty] = useState<AppointmentChoice | null>(item?.property || null);
  const [title, setTitle] = useState(item?.title || ''),
    [channel, setChannel] = useState<AppointmentChannel | ''>(item ? item.channel || '' : 'Phone'),
    [start, setStart] = useState(item ? appointmentLocal(item.starts_at) : ''),
    [end, setEnd] = useState(item ? appointmentLocal(item.ends_at) : '');
  const [location, setLocation] = useState(item?.location || ''),
    [notes, setNotes] = useState(item?.notes || ''),
    [result, setResult] = useState(item?.result || ''),
    [cancelReason, setCancelReason] = useState(item?.cancel_reason || ''),
    [status, setStatus] = useState<AppointmentStatus | ''>(
      item && item.status in appointmentStatusLabels ? (item.status as AppointmentStatus) : '',
    );
  const [salesId, setSalesId] = useState(''),
    [reason, setReason] = useState(''),
    [requestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false);
  const full = ['create', 'edit', 'correct'].includes(action),
    time = ['create', 'reschedule', 'correct'].includes(action);
  const suggestionUrl =
    role === 'Admin' && action === 'create' && lead
      ? `/api/appointments/sales-suggestions?${new URLSearchParams({ lead_id: lead.id, ...(property?.id ? { property_id: property.id } : {}) })}`
      : null;
  const {
    data: suggestions,
    loading: suggestionsLoading,
    error: suggestionsError,
  } = useAppointmentResource<SuggestionResponse>(suggestionUrl);
  useEffect(() => {
    if (
      suggestions?.suggestions.length &&
      (!salesId || !suggestions.suggestions.some((item) => item.sales_id === salesId))
    )
      setSalesId(suggestions.suggestions[0].sales_id);
  }, [suggestions, salesId]);
  const currentOwner = lead?.sales_id || null,
    changesOwner = role === 'Admin' && action === 'create' && !!salesId && salesId !== currentOwner;
  const reasonRequired =
    ['reschedule', 'cancel', 'correct'].includes(action) ||
    changesOwner ||
    (role === 'Admin' &&
      (action !== 'create' || (!!lead && (!!lead.archived || ['CONVERTED', 'LOST'].includes(lead.status || '')))));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError('');
    setConflict(false);
    try {
      if (action === 'create' && !lead) throw new Error('Chọn Lead / khách hàng trước khi tạo lịch.');
      if (changesOwner && reason.trim().length < 3) throw new Error('Nhập lý do chuyển Lead trước khi tạo lịch.');
      const data: Record<string, unknown> = {};
      if (full) Object.assign(data, { title, channel, location, notes, property_id: property?.id || null });
      if (time) {
        const starts_at = appointmentInstant(start),
          ends_at = appointmentInstant(end);
        if (ends_at <= starts_at) throw new Error('Giờ kết thúc phải sau giờ bắt đầu.');
        if (
          (action === 'create' || (action === 'reschedule' && role === 'Sales')) &&
          Date.parse(starts_at) <= Date.now()
        )
          throw new Error('Giờ bắt đầu phải ở tương lai.');
        Object.assign(data, { starts_at, ends_at });
      }
      if (action === 'create') {
        Object.assign(data, { lead_id: lead!.id, request_key: requestKey });
        if (role === 'Admin' && salesId) data.sales_id = salesId;
      }
      if (action === 'complete') data.result = result;
      if (action === 'correct')
        Object.assign(data, {
          status,
          result: status === 'COMPLETED' ? result : '',
          cancel_reason: status === 'CANCELLED' ? cancelReason : '',
        });
      await onSave(data, reason);
    } catch (cause) {
      setError(
        cause instanceof CatalogRequestError
          ? [cause.message, ...Object.values(cause.fields)].join(' ')
          : cause instanceof Error
            ? cause.message
            : 'Chưa thể lưu lịch hẹn.',
      );
      setConflict(
        cause instanceof CatalogRequestError &&
          [
            'VERSION_CONFLICT',
            'LEAD_LOCKED',
            'APPOINTMENT_LOCKED',
            'APPOINTMENT_INCOMPLETE',
            'FORBIDDEN',
            'REQUEST_CONFLICT',
          ].includes(cause.code),
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  const sourceLabel =
    suggestions?.area_source === 'property'
      ? 'theo BĐS đã chọn'
      : suggestions?.area_source === 'history'
        ? 'theo lịch sử'
        : suggestions?.area_source === 'preference'
          ? 'theo nhu cầu'
          : '';
  return (
    <form className={s.form} onSubmit={submit}>
      <fieldset disabled={busy}>
        {action === 'create' ? (
          <AppointmentPicker
            kind="leads"
            value={lead}
            onChange={(value) => {
              setLead(value);
              setProperty(null);
              setSalesId('');
            }}
          />
        ) : (
          <div className={s.readonly}>
            <strong>{item?.customer.name}</strong>
            <span>Sales: {item?.sales_name}</span>
          </div>
        )}
        {action === 'create' && role === 'Sales' && (
          <p className={s.readonly}>
            <strong>Sales phụ trách: {lead?.sales_name || 'bạn'}</strong>
          </p>
        )}
        {action === 'create' && role === 'Admin' && (
          <div className={s.salesSuggestion}>
            <label>
              Sales phụ trách *
              <select
                aria-label="Sales phụ trách"
                required
                value={salesId}
                onChange={(event) => setSalesId(event.target.value)}
              >
                <option value="" disabled>
                  Chọn Sales
                </option>
                {suggestions?.suggestions.map((sales) => (
                  <option key={sales.sales_id} value={sales.sales_id}>
                    {sales.name}
                    {sales.recommended ? ' · Gợi ý' : ''}
                  </option>
                ))}
              </select>
            </label>
            {suggestionsLoading && <p className={s.hint}>Đang tải gợi ý Sales…</p>}
            {suggestionsError && (
              <p className={s.error} role="alert">
                {suggestionsError}
              </p>
            )}
            {suggestions && !suggestions.suggestions.length && (
              <p className={s.hint}>Chưa có Sales đang hoạt động phù hợp.</p>
            )}
            {suggestions?.area && (
              <p className={s.hint}>
                Khu vực: {suggestions.area} {sourceLabel && `(${sourceLabel})`}
              </p>
            )}
            {suggestions?.suggestions
              .find((value) => value.sales_id === salesId)
              ?.reasons.map((value, index) => (
                <small className={s.suggestionReason} key={`${value}-${index}`}>
                  {value}
                </small>
              ))}
            {changesOwner && (
              <p className={s.notice}>
                Lead sẽ được chuyển cho{' '}
                {suggestions?.suggestions.find((value) => value.sales_id === salesId)?.name || 'Sales đã chọn'} và ghi
                vào lịch sử phân công.
              </p>
            )}
          </div>
        )}
        {full && (
          <>
            <label>
              Tiêu đề / nội dung hẹn *
              <input
                aria-label="Tiêu đề / nội dung hẹn"
                required
                minLength={3}
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ví dụ: Tư vấn căn hộ theo ngân sách"
              />
            </label>
            <label>
              Hình thức *
              <select
                aria-label="Hình thức"
                required
                value={channel}
                onChange={(e) => setChannel(e.target.value as AppointmentChannel)}
              >
                <option value="" disabled>
                  Chọn hình thức
                </option>
                {Object.entries(appointmentChannelLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {channel && channel !== 'Phone' && (
              <label>
                {channel === 'Online' ? 'Link cuộc họp *' : 'Địa điểm *'}
                <input
                  aria-label={channel === 'Online' ? 'Link cuộc họp' : 'Địa điểm'}
                  type={channel === 'Online' ? 'url' : 'text'}
                  required
                  minLength={3}
                  maxLength={1000}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </label>
            )}
            {channel === 'Phone' && <p className={s.hint}>Liên hệ theo số điện thoại trong hồ sơ khách hàng.</p>}
            <AppointmentPicker
              key={lead?.id || 'none'}
              kind="properties"
              value={property}
              leadId={lead?.id}
              onChange={setProperty}
            />
            <label>
              Ghi chú
              <textarea
                aria-label="Ghi chú"
                maxLength={3000}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </>
        )}
        {time && (
          <>
            <div className={s.twoColumns}>
              <label>
                Bắt đầu *
                <input
                  aria-label="Bắt đầu"
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Kết thúc *
                <input
                  aria-label="Kết thúc"
                  type="datetime-local"
                  required
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
            <p className={s.hint}>Ngày giờ Việt Nam (UTC+7). Hai lịch nối tiếp nhau được phép.</p>
          </>
        )}
        {action === 'correct' && (
          <label>
            Trạng thái sau khi sửa *
            <select
              aria-label="Trạng thái sau khi sửa"
              required
              value={status}
              onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
            >
              <option value="" disabled>
                Chọn trạng thái sau khi sửa
              </option>
              {Object.entries(appointmentStatusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {(action === 'complete' || (action === 'correct' && status === 'COMPLETED')) && (
          <label>
            Kết quả cuộc hẹn *
            <textarea
              aria-label="Kết quả cuộc hẹn"
              required
              minLength={3}
              maxLength={3000}
              rows={4}
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="Nội dung đã trao đổi, phản hồi và kết quả…"
            />
          </label>
        )}
        {action === 'correct' && status === 'CANCELLED' && (
          <label>
            Lý do hủy lịch *
            <textarea
              aria-label="Lý do hủy lịch"
              required
              minLength={3}
              maxLength={1000}
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </label>
        )}
        {action === 'cancel' && <p>Lịch đã hủy vẫn được giữ trong hồ sơ. Nếu khách muốn hẹn lại, hãy tạo lịch mới.</p>}
        {(reasonRequired || role === 'Admin') && (
          <label>
            {action === 'cancel'
              ? 'Lý do hủy'
              : changesOwner
                ? 'Lý do chuyển Lead'
                : action === 'reschedule'
                  ? 'Lý do đổi lịch'
                  : 'Lý do thao tác'}
            {reasonRequired ? ' *' : ' (bắt buộc nếu Lead đã đóng/lưu trữ)'}
            <textarea
              aria-label="Lý do thao tác"
              required={reasonRequired}
              minLength={reasonRequired ? 3 : undefined}
              maxLength={1000}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
      </fieldset>
      {error && (
        <div className={s.error} role="alert">
          {error}
          {conflict && (
            <button type="button" onClick={onReload}>
              Tải lại lịch
            </button>
          )}
        </div>
      )}
      <div className={s.formFooter}>
        <button type="button" className={s.secondary} disabled={busy} onClick={onCancel}>
          Quay lại
        </button>
        <button className={action === 'cancel' ? s.danger : s.primary} disabled={busy}>
          {busy
            ? 'Đang lưu…'
            : action === 'create'
              ? 'Tạo lịch hẹn'
              : action === 'complete'
                ? 'Xác nhận hoàn thành'
                : action === 'cancel'
                  ? 'Xác nhận hủy'
                  : 'Lưu thay đổi'}
        </button>
      </div>
    </form>
  );
}
