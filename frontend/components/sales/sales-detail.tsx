'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCheck, History, LockKeyhole, Mail, Pencil, Phone, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import {
  leadBudget,
  leadDate,
  leadSourceLabels,
  leadStatusLabels,
  need,
  timelineLabels,
  type Lead,
  type LeadStatus,
} from '@/lib/leads';
import { propertyTypeLabels } from '@/lib/catalog';
import {
  channelLabels,
  salesEventLabels,
  type Activity,
  type Page,
  type SalesDetailWithAppointments,
} from '@/lib/sales';
import { Empty, Modal, Score, StatusBadge } from '../leads/ui';
import { ActivityForm, CancelForm, NeedsForm, ResultForm } from './sales-forms';
import s from './sales.module.css';

export function Pagination({
  page,
  total,
  size = 12,
  onChange,
}: {
  page: number;
  total: number;
  size?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className={s.pagination}>
      <small>
        {total.toLocaleString('vi-VN')} kết quả · Trang {page}/{Math.max(1, Math.ceil(total / size))}
      </small>
      <div>
        <button disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Trước
        </button>
        <button disabled={page * size >= total} onClick={() => onChange(page + 1)}>
          Sau
        </button>
      </div>
    </div>
  );
}
export function ActivityCards({
  items,
  onOpen,
  onEdit,
  onCancel,
}: {
  items: Activity[];
  onOpen?: (lead: string) => void;
  onEdit?: (activity: Activity) => void;
  onCancel?: (activity: Activity) => void;
}) {
  return items.length ? (
    <div className={s.activityList}>
      {items.map((a) => (
        <article key={a.id} className={[s.activity, a.cancelled_at ? s.cancelled : ''].join(' ')}>
          <div className={s.activityTop}>
            <span className={s.channel}>{channelLabels[a.channel]}</span>
            <time dateTime={a.occurred_at}>{leadDate(a.occurred_at)}</time>
            {a.cancelled_at && <span className={s.cancelBadge}>Đã hủy</span>}
          </div>
          {onOpen && (
            <button className={s.linkButton} onClick={() => onOpen(a.lead_id)}>
              {a.customer_name} ↗
            </button>
          )}
          <p className={s.pre}>{a.content}</p>
          {a.feedback && (
            <div className={s.feedback}>
              <small>PHẢN HỒI CỦA KHÁCH</small>
              <p className={s.pre}>{a.feedback}</p>
            </div>
          )}
          {a.properties.length > 0 && (
            <div className={s.chips}>
              {a.properties.map((p) => (
                <span key={p.property_id}>
                  {p.snapshot.code} · {p.snapshot.name}
                </span>
              ))}
            </div>
          )}
          {a.cancelled_at && (
            <p className={s.warning}>
              Hủy lúc {leadDate(a.cancelled_at)} · {a.cancel_reason}
            </p>
          )}
          <div className={s.activityBottom}>
            <small>
              {a.sales_name} · Ghi nhận {leadDate(a.created_at)}
              {a.version > 0 && ' · Đã cập nhật'}
            </small>
            {a.can_edit && onEdit && onCancel && (
              <div>
                <button onClick={() => onEdit(a)}>
                  <Pencil size={14} />
                  Sửa
                </button>
                <button onClick={() => onCancel(a)}>
                  <Trash2 size={14} />
                  Hủy ghi nhận
                </button>
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  ) : (
    <Empty title="Chưa có hoạt động tư vấn">Mỗi lần trao đổi với khách sẽ được lưu thành một ghi nhận riêng.</Empty>
  );
}
export function SalesDetailDialog({
  id,
  role,
  initialTab = 'activities',
  onClose,
  onChanged,
}: {
  id: string;
  role: 'Sales' | 'Admin';
  initialTab?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<SalesDetailWithAppointments | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [tab, setTab] = useState(initialTab),
    [editing, setEditing] = useState<{ kind: 'create' | 'edit' | 'cancel'; activity?: Activity } | null>(null),
    [editingNeeds, setEditingNeeds] = useState(false);
  const [activities, setActivities] = useState<Page<Activity> | null>(null),
    [activityError, setActivityError] = useState(''),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [activitiesLoading, setActivitiesLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    catalogRequest<SalesDetailWithAppointments>('/api/sales/leads/' + id, { signal: c.signal })
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [id, revision]);
  useEffect(() => {
    const c = new AbortController();
    catalogRequest<Page<Activity>>(
      '/api/sales/activities?' + new URLSearchParams({ lead_id: id, page: String(page), pageSize: '8' }),
      { signal: c.signal },
    )
      .then((d) => {
        setActivities(d);
        setActivityError('');
      })
      .catch((e) => {
        if (!c.signal.aborted) setActivityError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setActivitiesLoading(false);
      });
    return () => c.abort();
  }, [id, page, revision]);
  function reload() {
    setLoading(true);
    setActivitiesLoading(true);
    setEditing(null);
    setEditingNeeds(false);
    setRevision((v) => v + 1);
  }
  async function mutate(action: string, values: Record<string, unknown>, reason = '') {
    if (!data) return;
    await catalogRequest('/api/sales/leads/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: data.item.version, action, data: values, reason }),
    });
    onChanged();
  }
  const lead = data?.item,
    writable = !!data?.can_write && role === 'Sales';
  const lastResult = data?.history.find((e) => e.action === 'sales_result_confirmed');
  const saved = () => {
    setPage(1);
    reload();
  };
  return (
    <Modal
      title={lead?.customer.full_name || 'Hồ sơ tư vấn'}
      subtitle="Không gian Sales · Hồ sơ được phân công"
      onClose={onClose}
      wide
    >
      <div className={s.modalBody}>
        {error ? (
          <div className={s.error} role="alert">
            {error}
            <button onClick={reload}>Thử lại</button>
          </div>
        ) : loading ? (
          <p role="status">Đang tải hồ sơ…</p>
        ) : (
          lead &&
          data && (
            <>
              <div className={s.detailOverview}>
                <div>
                  <div className={s.pills}>
                    <StatusBadge value={lead.status} />
                    {lead.archived && <span>Đã lưu trữ</span>}
                    <span>{lead.assignment?.accepted ? 'Đã tiếp nhận' : 'Chưa ghi nhận tiếp nhận'}</span>
                  </div>
                  <h3>{leadBudget(lead)}</h3>
                  <div className={s.contact}>
                    <a href={'tel:' + lead.customer.phone}>
                      <Phone size={14} />
                      {lead.customer.phone}
                    </a>
                    {lead.customer.email && (
                      <a href={'mailto:' + lead.customer.email}>
                        <Mail size={14} />
                        {lead.customer.email}
                      </a>
                    )}
                  </div>
                  <small>
                    Nguồn: {leadSourceLabels[lead.source] || lead.source} · Sales: {lead.assignment?.sales_name || '—'}
                  </small>
                </div>
                <Score score={lead.lead_score} temperature={lead.temperature} />
              </div>
              {!writable && (
                <div className={s.warning}>
                  <LockKeyhole size={17} />
                  {role === 'Admin'
                    ? 'Admin chỉ xem trong không gian Sales.'
                    : 'Lead đã kết thúc hoặc lưu trữ. Không thể bổ sung hoặc chỉnh sửa tư vấn.'}
                  {role === 'Admin' && ['CONVERTED', 'LOST'].includes(lead.status) && (
                    <Link href={role === 'Admin' ? '/admin/leads' : '/sales/leads'}>Mở Quản lý Lead để điều chỉnh</Link>
                  )}
                </div>
              )}
              <section className={s.note}>
                <h4>Lịch hẹn</h4>
                {data.appointments?.length ? (
                  data.appointments.map((a) => (
                    <p key={a.id}>
                      <strong>
                        {new Date(a.appointment_time).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                      </strong>{' '}
                      · {a.property_name || 'Bất động sản'} {a.property_code && `(${a.property_code})`} · {a.status}
                      <br />
                      {a.customer_name} · {a.phone}
                      {a.note && (
                        <>
                          <br />
                          {a.note}
                        </>
                      )}
                    </p>
                  ))
                ) : (
                  <small>Chưa có lịch hẹn.</small>
                )}
              </section>
              <nav className={s.tabs} aria-label="Thông tin hồ sơ">
                {[
                  ['activities', 'Hoạt động tư vấn'],
                  ['needs', 'Nhu cầu khách hàng'],
                  ['result', 'Xác nhận kết quả'],
                  ['history', 'Lịch sử'],
                ].map(([k, v]) => (
                  <button
                    key={k}
                    aria-current={tab === k ? 'page' : undefined}
                    className={tab === k ? s.activeTab : ''}
                    onClick={() => {
                      setTab(k);
                      setEditing(null);
                      setEditingNeeds(false);
                    }}
                  >
                    {v}
                  </button>
                ))}
              </nav>
              {tab === 'activities' && (
                <>
                  <div className={s.sectionTitle}>
                    <div>
                      <h3>Nhật ký tư vấn</h3>
                      <small>Ghi nhận nội dung và phản hồi qua từng lần trao đổi.</small>
                    </div>
                    {writable && !editing && (
                      <button className={s.primary} onClick={() => setEditing({ kind: 'create' })}>
                        <Plus size={16} />
                        Ghi nhận tư vấn
                      </button>
                    )}
                  </div>
                  {editing && writable ? (
                    <section className={s.editor}>
                      <div className={s.sectionTitle}>
                        <h3>
                          {editing.kind === 'create'
                            ? 'Ghi nhận tư vấn mới'
                            : editing.kind === 'edit'
                              ? 'Chỉnh sửa ghi nhận'
                              : 'Hủy ghi nhận'}
                        </h3>
                        <button className={s.secondary} onClick={() => setEditing(null)}>
                          Đóng
                        </button>
                      </div>
                      {editing.kind === 'cancel' && editing.activity ? (
                        <CancelForm
                          key={editing.activity.id}
                          activity={editing.activity}
                          mutate={mutate}
                          onSaved={saved}
                          onReload={reload}
                        />
                      ) : (
                        <ActivityForm
                          key={editing.activity?.id || 'new'}
                          activity={editing.activity}
                          mutate={mutate}
                          onSaved={saved}
                          onReload={reload}
                        />
                      )}
                    </section>
                  ) : activitiesLoading ? (
                    <p role="status">Đang tải nhật ký…</p>
                  ) : activityError ? (
                    <p className={s.error} role="alert">
                      {activityError}
                    </p>
                  ) : (
                    activities && (
                      <>
                        <ActivityCards
                          items={activities.items}
                          onEdit={(a) => setEditing({ kind: 'edit', activity: a })}
                          onCancel={(a) => setEditing({ kind: 'cancel', activity: a })}
                        />
                        <Pagination
                          page={page}
                          size={8}
                          total={activities.total}
                          onChange={(p) => {
                            setPage(p);
                            setActivitiesLoading(true);
                          }}
                        />
                      </>
                    )
                  )}
                </>
              )}
              {tab === 'needs' && (
                <>
                  <div className={s.sectionTitle}>
                    <div>
                      <h3>Nhu cầu được ghi nhận</h3>
                      {data.confirmation && (
                        <small>
                          <CheckCheck size={14} /> {data.confirmation.by || 'Sales'} xác nhận lúc{' '}
                          {leadDate(data.confirmation.at)}
                        </small>
                      )}
                    </div>
                    {writable && (
                      <button className={s.primary} onClick={() => setEditingNeeds((v) => !v)}>
                        {editingNeeds ? 'Đóng' : 'Xác nhận / cập nhật'}
                      </button>
                    )}
                  </div>
                  {editingNeeds && writable ? (
                    <NeedsForm key={lead.version} lead={lead} mutate={mutate} onSaved={saved} onReload={reload} />
                  ) : (
                    <NeedsRead lead={lead} />
                  )}
                  {data.summary && (
                    <section className={s.note}>
                      <h4>Tóm tắt trao đổi với AI</h4>
                      <p className={s.pre}>{data.summary}</p>
                    </section>
                  )}
                  {data.extractions.length > 0 && (
                    <div className={s.warning}>
                      Có {data.extractions.length} thông tin AI cần kiểm tra. Xác nhận giá trị chính xác ở các trường
                      nhu cầu bên trên.
                    </div>
                  )}
                </>
              )}
              {tab === 'result' && (
                <>
                  <h3>Kết quả tư vấn</h3>
                  <p className={s.hint}>
                    Lưu kết quả sẽ cập nhật trạng thái Lead. Nhật ký tư vấn và xác nhận nhu cầu được lưu riêng.
                  </p>
                  {lastResult && (
                    <section className={s.note}>
                      <h4>Lần xác nhận Sales gần nhất</h4>
                      <ResultRecord value={lastResult.after_data} />
                      <p>{lastResult.reason}</p>
                      <small>
                        {lastResult.actor_name || 'Sales'} · {leadDate(lastResult.created_at)}
                      </small>
                    </section>
                  )}
                  {writable ? (
                    <ResultForm key={lead.version} lead={lead} mutate={mutate} onSaved={saved} onReload={reload} />
                  ) : (
                    <StatusBadge value={lead.status} />
                  )}
                </>
              )}
              {tab === 'history' && (
                <>
                  <h3>
                    <History size={18} /> Lịch sử hồ sơ
                  </h3>
                  {data.history.length === 0 ? (
                    <p>Chưa có thay đổi được ghi nhận.</p>
                  ) : (
                    <div className={s.history}>
                      {data.history.map((e) => (
                        <article key={e.id}>
                          <strong>{salesEventLabels[e.action.replace(/^m04_/, '')] || 'Cập nhật hồ sơ'}</strong>
                          <small>
                            {e.actor_name || e.actor_kind} · {leadDate(e.created_at)}
                          </small>
                          {e.reason && <p>{e.reason}</p>}
                          {e.action === 'sales_result_confirmed' && <ResultRecord value={e.after_data} />}
                          {e.action.startsWith('sales_activity_') && e.before_data && (
                            <details>
                              <summary>Xem nội dung trước và sau</summary>
                              {[
                                ['Trước thay đổi', e.before_data],
                                ['Sau thay đổi', e.after_data],
                              ].map(([label, v]) => {
                                const a = v as unknown as Partial<Activity> | null;
                                return (
                                  <div key={String(label)} className={s.note}>
                                    <strong>{String(label)}</strong>
                                    <p className={s.pre}>{a?.content}</p>
                                    {a?.feedback && <p className={s.pre}>Phản hồi: {a.feedback}</p>}
                                    {a?.occurred_at && (
                                      <small>
                                        {leadDate(a.occurred_at)} · {a.channel && channelLabels[a.channel]}
                                      </small>
                                    )}
                                    {a?.properties?.map((p) => (
                                      <p key={p.property_id}>
                                        {p.snapshot.code} · {p.snapshot.name}
                                      </p>
                                    ))}
                                  </div>
                                );
                              })}
                            </details>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                  <p className={s.hint}>Hiển thị tối đa 100 thay đổi gần nhất.</p>
                </>
              )}
              <div className={s.footer}>
                <button className={s.secondary} onClick={reload}>
                  <RefreshCw size={15} />
                  Tải lại hồ sơ
                </button>
              </div>
            </>
          )
        )}
      </div>
    </Modal>
  );
}
function ResultRecord({ value }: { value: Record<string, unknown> | null }) {
  const p = value?.property as { code?: string; name?: string } | null;
  return (
    <div>
      <p>{leadStatusLabels[value?.status as LeadStatus] || 'Đã ghi nhận kết quả'}</p>
      {p && (
        <p>
          {p.code} · {p.name}
        </p>
      )}
      {typeof value?.purchased_at === 'string' && (
        <p>Ngày mua: {new Date(value.purchased_at + 'T00:00:00+07:00').toLocaleDateString('vi-VN')}</p>
      )}
    </div>
  );
}
function NeedsRead({ lead }: { lead: Lead }) {
  const m = lead.needs.management;
  const locations = need<string[]>(lead, 'locations', lead.preferred_location ? [lead.preferred_location] : []);
  const types = need<string[]>(
    lead,
    'property_types',
    lead.preferred_property_type ? [lead.preferred_property_type] : [],
  );
  return (
    <>
      <dl className={s.facts}>
        <div>
          <dt>Khu vực</dt>
          <dd>{locations.join(', ') || 'Chưa xác định'}</dd>
        </div>
        <div>
          <dt>Loại BĐS</dt>
          <dd>
            {types.map((t) => propertyTypeLabels[t as keyof typeof propertyTypeLabels] || t).join(', ') ||
              'Chưa xác định'}
          </dd>
        </div>
        <div>
          <dt>Ngân sách</dt>
          <dd>{leadBudget(lead)}</dd>
        </div>
        <div>
          <dt>Thời gian dự kiến</dt>
          <dd>{timelineLabels[lead.expected_timeline || ''] || 'Chưa xác định'}</dd>
        </div>
        <div>
          <dt>Mục đích</dt>
          <dd>{lead.buying_purpose || 'Chưa xác định'}</dd>
        </div>
        <div>
          <dt>Giao dịch</dt>
          <dd>{m?.transaction_type === 'Rent' ? 'Thuê' : m?.transaction_type === 'Sale' ? 'Mua' : 'Chưa xác định'}</dd>
        </div>
        <div>
          <dt>Số phòng ngủ</dt>
          <dd>
            {m?.bedrooms ?? 'Chưa xác định'}
            {m?.bedrooms_required ? ' · Bắt buộc' : ''}
          </dd>
        </div>
        <div>
          <dt>Diện tích (m²)</dt>
          <dd>
            {m?.area_min ?? '—'} – {m?.area_max ?? '—'}
            {m?.area_required ? ' · Bắt buộc' : ''}
          </dd>
        </div>
      </dl>
      {lead.notes && (
        <section className={s.note}>
          <h4>Ghi chú hồ sơ</h4>
          <p className={s.pre}>{lead.notes}</p>
        </section>
      )}
      <p className={s.hint}>
        Điểm: {lead.lead_score ?? 'Chưa chấm'} · Bộ quy tắc: {lead.score_rule_version || 'Chưa có'}. Điểm tiềm năng được
        giữ theo bộ quy tắc của hệ thống.
      </p>
    </>
  );
}
