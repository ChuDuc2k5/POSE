'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Check, ExternalLink, History, Pencil, X } from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import { propertyTypeLabels } from '@/lib/catalog';
import {
  appointmentActionLabels,
  appointmentChannelLabels,
  appointmentChannelName,
  appointmentDate,
  appointmentFromChat,
  appointmentOverdue,
  appointmentDisplayStatusLabels,
  type AppointmentDetail,
} from '@/lib/appointments';
import { leadBudget, leadStatusLabels } from '@/lib/leads';
import { AppointmentDialog } from './appointment-dialog';
import { AppointmentForm, type AppointmentAction } from './appointment-form';
import { useAppointmentResource } from './use-appointment-resource';
import s from './appointments.module.css';
export function AppointmentBadge({ status }: { status: keyof typeof appointmentDisplayStatusLabels }) {
  return (
    <span className={`${s.badge} ${status === 'COMPLETED' ? s.completed : status === 'CANCELLED' ? s.cancelled : ''}`}>
      {appointmentDisplayStatusLabels[status]}
    </span>
  );
}
const fields: Record<string, string> = {
  title: 'Nội dung',
  starts_at: 'Bắt đầu',
  ends_at: 'Kết thúc',
  channel: 'Hình thức',
  location: 'Địa điểm / đường dẫn',
  notes: 'Ghi chú',
  status: 'Trạng thái',
  result: 'Kết quả',
  cancel_reason: 'Lý do hủy',
  property_id: 'BĐS liên quan',
};
function changedValue(key: string, value: unknown) {
  if (value === null || value === '') return 'Không có';
  if (key === 'starts_at' || key === 'ends_at') return appointmentDate(String(value));
  if (key === 'status')
    return appointmentDisplayStatusLabels[value as keyof typeof appointmentDisplayStatusLabels] || String(value);
  if (key === 'channel')
    return appointmentChannelLabels[value as keyof typeof appointmentChannelLabels] || String(value);
  if (key === 'property_id') return 'Có chọn BĐS';
  return String(value);
}
export function AppointmentDetailDialog({
  id,
  role,
  onClose,
  onChanged,
}: {
  id: string;
  role: 'Admin' | 'Sales';
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter(),
    [revision, setRevision] = useState(0),
    [action, setAction] = useState<AppointmentAction | null>(null),
    [showLead, setShowLead] = useState(false),
    [clock, setClock] = useState(() => Date.now()),
    [saving, setSaving] = useState(false);
  const { data, loading, error } = useAppointmentResource<AppointmentDetail>('/api/appointments/' + id, revision);
  const item = data?.role === role ? data.item : undefined;
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (data && data.role !== role) router.refresh();
  }, [data, role, router]);
  const reload = () => {
    setAction(null);
    setRevision((v) => v + 1);
    onChanged();
  };
  async function save(payload: Record<string, unknown>, reason: string) {
    await catalogRequest('/api/appointments/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: item!.version, data: payload, reason }),
    });
    reload();
  }
  const titles: Record<string, string> = {
    edit: item?.needs_details ? 'Bổ sung thông tin lịch hẹn' : 'Chỉnh thông tin lịch hẹn',
    reschedule: 'Đổi thời gian hẹn',
    complete: 'Ghi kết quả cuộc hẹn',
    cancel: 'Hủy lịch hẹn',
    correct: 'Sửa sai lịch hẹn (Admin)',
  };
  return (
    <AppointmentDialog
      title={action ? titles[action] : 'Chi tiết lịch hẹn'}
      subtitle="Thời gian theo giờ Việt Nam · UTC+7"
      onClose={onClose}
      busy={saving}
    >
      {loading ? (
        <div className={s.loading} role="status">
          Đang tải lịch hẹn…
        </div>
      ) : error || !item ? (
        <div className={s.error} role="alert">
          {error || 'Đang xác minh quyền truy cập…'}
          <button onClick={reload}>Tải lại</button>
        </div>
      ) : action ? (
        <AppointmentForm
          key={item.id + ':' + item.version + ':' + action}
          action={action}
          item={item}
          role={role}
          onSave={save}
          onCancel={() => setAction(null)}
          onReload={reload}
          onBusy={setSaving}
        />
      ) : (
        <div className={s.detail}>
          <div className={s.detailTitle}>
            <div>
              <AppointmentBadge status={item.status} />
              {appointmentFromChat(item) && <span className={`${s.badge} ${s.chat}`}>Từ AI chat</span>}
              {appointmentOverdue(item, clock) && <span className={s.overdue}>Đã qua giờ hẹn</span>}
              <h3>{item.title}</h3>
            </div>
            <small>Sales: {item.sales_name}</small>
          </div>
          <dl className={s.info}>
            <div>
              <dt>Khách hàng</dt>
              <dd>
                {item.customer.name}
                <small>
                  {item.customer.phone || 'Chưa có số điện thoại'}
                  {item.customer.email ? ' · ' + item.customer.email : ''}
                </small>
              </dd>
            </div>
            <div>
              <dt>Thời gian</dt>
              <dd>
                {appointmentDate(item.starts_at)}
                <small>Đến {appointmentDate(item.ends_at)}</small>
              </dd>
            </div>
            <div>
              <dt>Hình thức</dt>
              <dd>{appointmentChannelName(item.channel)}</dd>
            </div>
            <div>
              <dt>Địa điểm / liên hệ</dt>
              <dd>
                {item.channel === 'Phone' ? (
                  item.customer.phone || 'Chưa có số điện thoại'
                ) : item.channel === 'Online' && /^https?:\/\//i.test(item.location) ? (
                  <a href={item.location} target="_blank" rel="noopener noreferrer">
                    Mở cuộc họp <ExternalLink size={13} />
                  </a>
                ) : (
                  item.location
                )}
              </dd>
            </div>
          </dl>
          {item.property && (
            <section className={s.note}>
              <strong>BĐS liên quan</strong>
              <p>
                {item.property.code} · {item.property.name}
              </p>
              <small>{item.property.location}</small>
              <Link href={'/properties/' + item.property.id}>
                Xem thông tin BĐS <ExternalLink size={13} />
              </Link>
            </section>
          )}
          {item.notes && (
            <section className={s.note}>
              <strong>Ghi chú</strong>
              <p className={s.pre}>{item.notes}</p>
            </section>
          )}
          {item.status === 'COMPLETED' && (
            <section className={`${s.note} ${s.result}`}>
              <strong>Kết quả cuộc hẹn</strong>
              <p className={s.pre}>{item.result}</p>
              <small>Kết quả này không tự thay đổi trạng thái Lead.</small>
            </section>
          )}
          {item.status === 'CANCELLED' && (
            <section className={s.note}>
              <strong>Lý do hủy</strong>
              <p className={s.pre}>{item.cancel_reason}</p>
            </section>
          )}
          <button type="button" className={s.textButton} onClick={() => setShowLead((v) => !v)}>
            {showLead ? 'Thu gọn hồ sơ Lead' : 'Xem hồ sơ Lead'}
          </button>
          {showLead && (
            <section className={s.note}>
              <strong>{item.customer.name}</strong>
              <p>
                {leadStatusLabels[item.lead_status]}
                {item.lead_archived ? ' · Đã lưu trữ' : ''}
              </p>
              <dl className={s.info}>
                <div>
                  <dt>Ngân sách</dt>
                  <dd>{leadBudget(data!.lead)}</dd>
                </div>
                <div>
                  <dt>Khu vực mong muốn</dt>
                  <dd>{data!.lead.preferred_location || 'Chưa xác định'}</dd>
                </div>
                <div>
                  <dt>Loại BĐS</dt>
                  <dd>
                    {propertyTypeLabels[data!.lead.preferred_property_type as keyof typeof propertyTypeLabels] ||
                      data!.lead.preferred_property_type ||
                      'Chưa xác định'}
                  </dd>
                </div>
              </dl>
              <Link href={role === 'Admin' ? '/admin/leads' : '/sales/leads'}>
                Mở Quản lý Lead <ExternalLink size={13} />
              </Link>
            </section>
          )}
          {item.needs_details && (
            <p className={s.hint}>
              {appointmentFromChat(item)
                ? 'Khách đặt lịch qua AI chat nên còn thiếu tiêu đề, hình thức hoặc địa điểm. Bấm “Bổ sung thông tin” để hoàn tất trước khi đổi lịch hoặc ghi kết quả.'
                : 'Lịch cũ còn thiếu thông tin. Bấm “Bổ sung thông tin” để hoàn tất, hoặc hủy lịch nếu không còn cần thiết.'}
            </p>
          )}
          {!item.can_manage && (
            <p className={s.hint}>
              {item.lead_archived || ['CONVERTED', 'LOST'].includes(item.lead_status)
                ? 'Lead đã kết thúc hoặc lưu trữ. Chỉ Admin được xử lý lịch còn lại.'
                : 'Lịch đã kết thúc. Sales chỉ được xem; Admin có thể sửa sai có lý do.'}
            </p>
          )}
          {item.can_manage && (
            <div className={s.actions}>
              {['SCHEDULED', 'CONFIRMED'].includes(item.status) && (
                <>
                  <button className={item.needs_details ? s.primary : s.secondary} onClick={() => setAction('edit')}>
                    <Pencil size={15} />
                    {item.needs_details ? 'Bổ sung thông tin' : 'Chỉnh thông tin'}
                  </button>
                  <button className={s.secondary} disabled={item.needs_details} onClick={() => setAction('reschedule')}>
                    <CalendarClock size={15} />
                    Đổi lịch
                  </button>
                  <button
                    className={s.primary}
                    disabled={item.needs_details || (role !== 'Admin' && Date.parse(item.starts_at) > clock)}
                    title={
                      role !== 'Admin' && Date.parse(item.starts_at) > clock
                        ? 'Chưa đến giờ bắt đầu cuộc hẹn'
                        : undefined
                    }
                    onClick={() => setAction('complete')}
                  >
                    <Check size={15} />
                    Hoàn thành
                  </button>
                  <button className={s.danger} onClick={() => setAction('cancel')}>
                    <X size={15} />
                    Hủy lịch
                  </button>
                </>
              )}
              {role === 'Admin' && (
                <button className={s.secondary} onClick={() => setAction('correct')}>
                  <Pencil size={15} />
                  Sửa sai (Admin)
                </button>
              )}
            </div>
          )}
          <section className={s.history}>
            <h3>
              <History size={17} />
              Lịch sử thay đổi
            </h3>
            {data!.history.map((event) => (
              <article key={event.id}>
                <div>
                  <strong>{appointmentActionLabels[event.action] || 'Cập nhật lịch hẹn'}</strong>
                  <time>{appointmentDate(event.created_at)}</time>
                </div>
                <small>
                  {event.actor_name} · {event.actor_role}
                </small>
                {event.reason && <p className={s.pre}>Lý do: {event.reason}</p>}
                {event.before_data && (
                  <ul>
                    {Object.entries(fields)
                      .filter(([key]) => event.before_data![key] !== event.after_data[key])
                      .map(([key, label]) => (
                        <li key={key}>
                          <strong>{label}: </strong>
                          {key === 'property_id'
                            ? 'Đã thay đổi lựa chọn BĐS'
                            : `${changedValue(key, event.before_data![key])} → ${changedValue(key, event.after_data[key])}`}
                        </li>
                      ))}
                  </ul>
                )}
              </article>
            ))}
          </section>
        </div>
      )}
    </AppointmentDialog>
  );
}
