'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Archive, ArrowRight, ArrowUpRight, Building2, Check, CheckCheck, CircleAlert, History, LockKeyhole, Mail, MapPin, MessageSquare, Pencil, Phone, RefreshCw, ShieldCheck, UserCheck, UserRound } from 'lucide-react';
import { catalogRequest, CatalogRequestError } from '@/lib/catalog-client';
import { priceLabel, propertyTypeLabels } from '@/lib/catalog';
import { fieldLabels, leadBudget, leadDate, leadSourceLabels, leadStatusLabels, need, routingLabels, timelineLabels, type Extraction, type Lead, type LeadDetail, type LeadStatus, type ManagementCriteria, type SalesOption } from '@/lib/leads';
import { Empty, Modal, PropertyPicker, StatusBadge, TemperatureBadge } from './ui';
import s from './leads.module.css';

type Action = { kind: string; extraction?: Extraction; accept?: boolean; salesId?: string; propertyId?: string };
type Mutate = (action: string, data: Record<string, unknown>, reason: string) => Promise<void>;
const eventLabels: Record<string, string> = {
  lead_accepted: 'Sales đã tiếp nhận Lead', lead_auto_assigned: 'Hệ thống cập nhật phân công',
  lead_assigned: 'Cập nhật người phụ trách', lead_route_evaluated: 'Đánh giá BĐS và phân công',
  lead_profile: 'Xác nhận và cập nhật nhu cầu',
  lead_archive: 'Cập nhật lưu trữ', lead_status: 'Thay đổi trạng thái',
  lead_resolve_extraction: 'Kiểm tra thông tin trích xuất', handoff_requested: 'Khách yêu cầu tư vấn',
  score_applied: 'Cập nhật điểm tiềm năng', score_overridden: 'Điều chỉnh đánh giá trước đây',
  needs_extracted: 'Ghi nhận nhu cầu từ hội thoại', call_ended: 'Ghi nhận kết quả cuộc gọi',
};
// Preserve the meaning of audit records written before the SQL rename.
function eventAction(action: string) {
  return action === 'm04_lead_accepted' ? 'lead_accepted' : action.replace(/^m04_/, 'lead_');
}
function displayValue(field: string, value: unknown): string {
  if (value == null) return 'Chưa xác định';
  if (Array.isArray(value)) return value.map(v => displayValue(field, v)).join(', ');
  if (field.includes('budget') && typeof value === 'number') return priceLabel(value);
  if (field === 'property_types') return propertyTypeLabels[value as keyof typeof propertyTypeLabels] || String(value);
  if (field === 'timeline') return timelineLabels[String(value)] || String(value);
  if (typeof value === 'boolean') return value ? 'Có' : 'Chưa';
  return String(value);
}
function parsed(value: string | null) { try { return JSON.parse(value || 'null') as unknown; } catch { return value; } }

export function LeadDetailDialog({ lead, role, sales, onClose, onSaved }: { lead: Lead; role: 'Admin' | 'Sales'; sales: SalesOption[]; onClose: () => void; onSaved: () => void }) {
  const [detail, setDetail] = useState<LeadDetail | null>(null), [error, setError] = useState('');
  const [tab, setTab] = useState<'profile' | 'matches' | 'history'>('profile');
  const [action, setAction] = useState<Action | null>(null), [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(''), [routing, setRouting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    catalogRequest<LeadDetail>('/api/leads/' + lead.id, { signal: controller.signal }).then(setDetail)
      .catch(e => { if (!controller.signal.aborted) setError(e.message || 'Chưa thể tải hồ sơ.'); });
    return () => controller.abort();
  }, [lead.id]);
  async function reload() {
    try { setDetail(await catalogRequest<LeadDetail>('/api/leads/' + lead.id)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Chưa thể tải lại hồ sơ.'); }
  }
  const mutate: Mutate = async (kind, data, reason) => {
    if (!detail) throw new Error('Chờ hồ sơ tải xong.');
    await catalogRequest('/api/leads/' + lead.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: kind, version: detail.item.version, data, reason }) });
    onSaved();
    setDetail(await catalogRequest<LeadDetail>('/api/leads/' + lead.id));
    setNotice('Đã cập nhật hồ sơ và lưu lịch sử thay đổi.');
  };
  async function recheck() {
    setRouting(true); setError('');
    try {
      await catalogRequest('/api/leads/recheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: lead.id }) });
      await reload(); onSaved(); setNotice('Đã xét lại BĐS và phân công theo nhu cầu hiện tại.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa thể xét lại phân công.'); }
    finally { setRouting(false); }
  }
  const l = detail?.item;
  const closed = l && ['CONVERTED', 'LOST'].includes(l.status);
  const history = detail?.history.map(e => ({ ...e, action: eventAction(e.action) })) || [];
  return <Modal title={l?.customer.full_name || lead.customer.full_name} subtitle={'Hồ sơ Lead · ' + (leadSourceLabels[l?.source || lead.source] || 'Yêu cầu tư vấn')} onClose={onClose} wide>
    {!detail ? <div className={s.dialogBody}>{error ? <div className={s.error} role="alert">{error}<button className={s.textButton} onClick={reload}>Thử lại</button></div> : <div className={s.loading}><RefreshCw className={s.spin} size={22}/> Đang tải hồ sơ…</div>}</div> : l && <>
      <div className={s.detailTop}><div><TemperatureBadge value={l.temperature}/><StatusBadge value={l.status}/>{l.archived && <span className={s.status}>Đã lưu trữ</span>}</div><small>Cập nhật {leadDate(l.updated_at)}</small></div>
      <div className={s.detailToolbar}>{!l.archived && <><button className={s.secondary} onClick={() => setEditing(true)}><Pencil size={15}/> Sửa hồ sơ</button><button className={s.secondary} onClick={() => setAction({ kind: 'status' })}>Đổi trạng thái</button>{!closed && role === 'Sales' && l.assignment && !l.assignment.accepted && <button className={s.primary} onClick={() => setAction({ kind: 'accept' })}><UserCheck size={16}/> Tiếp nhận Lead</button>}{!closed && role === 'Admin' && !l.assignment && <button className={s.secondary} onClick={() => setAction({ kind: 'assign' })}><UserCheck size={15}/>Phân công Sales</button>}</>}{role === 'Admin' && closed && <button className={s.secondary} onClick={() => setAction({ kind: 'archive' })}><Archive size={15}/>{l.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'}</button>}</div>
      <nav className={s.tabs} aria-label="Nội dung hồ sơ"><button className={tab === 'profile' ? s.tabActive : ''} onClick={() => setTab('profile')}>Hồ sơ & nhu cầu</button><button className={tab === 'matches' ? s.tabActive : ''} onClick={() => setTab('matches')}>BĐS phù hợp <span>{detail.matches.length}</span></button><button className={tab === 'history' ? s.tabActive : ''} onClick={() => setTab('history')}><History size={15}/> Lịch sử</button></nav>
      <div className={s.dialogBody}>
        {notice && <p className={s.inlineNotice} role="status"><CheckCheck size={17}/>{notice}</p>}
        {error && <div className={s.error} role="alert">{error}</div>}
        {tab === 'profile' && <>
          <section className={s.detailCard}><div className={s.sectionTitle}><h3><UserRound size={18}/> Thông tin khách hàng</h3>{l.customer.phone_verified_at && <span className={s.verified}><ShieldCheck size={14}/> Đã xác minh điện thoại</span>}</div><div className={s.contactGrid}><a href={'tel:' + l.customer.phone}><Phone size={17}/>{l.customer.phone}</a><span><Mail size={17}/>{l.customer.email || 'Chưa có email'}</span></div></section>
          {detail.summary && <section className={s.summaryCard}><h3><MessageSquare size={18}/> Nhu cầu được bàn giao</h3><p>{detail.summary}</p></section>}
          <section className={s.detailCard}><div className={s.sectionTitle}><h3><Building2 size={18}/> Nhu cầu bất động sản</h3></div><dl className={s.facts}>
            <div><dt>Loại bất động sản</dt><dd>{need<string[]>(l, 'property_types', l.preferred_property_type ? [l.preferred_property_type] : []).map(t => propertyTypeLabels[t as keyof typeof propertyTypeLabels] || t).join(', ') || 'Chưa xác định'}</dd></div>
            <div><dt>Khu vực</dt><dd>{need<string[]>(l, 'locations', l.preferred_location ? [l.preferred_location] : []).join(', ') || 'Chưa xác định'}</dd></div>
            <div><dt>Ngân sách</dt><dd>{leadBudget(l)}</dd></div><div><dt>Thời gian dự kiến</dt><dd>{timelineLabels[l.expected_timeline || ''] || 'Chưa xác định'}</dd></div>
            <div><dt>Mục đích</dt><dd>{l.buying_purpose || 'Chưa xác định'}</dd></div><div><dt>Hình thức</dt><dd>{l.needs.management?.transaction_type === 'Rent' ? 'Thuê' : 'Mua'}</dd></div>
            <div><dt>Số phòng ngủ</dt><dd>{l.needs.management?.bedrooms ?? 'Chưa xác định'}{l.needs.management?.bedrooms != null && (l.needs.management.bedrooms_required ? ' · Bắt buộc' : ' · Ưu tiên')}</dd></div>
            <div><dt>Diện tích mong muốn</dt><dd>{l.needs.management?.area_min != null || l.needs.management?.area_max != null ? (l.needs.management.area_min ?? '—') + ' – ' + (l.needs.management.area_max ?? '—') + ' m²' + (l.needs.management.area_required ? ' · Bắt buộc' : ' · Ưu tiên') : 'Chưa xác định'}</dd></div>
          </dl>{l.notes && <div className={s.note}><strong>Ghi chú hồ sơ</strong><p>{l.notes}</p></div>}
          {Object.entries(l.needs).some(([, v]) => v && typeof v === 'object' && 'evidence' in v) && <details className={s.evidence}><summary>Xem dẫn chứng và thông tin đã xác nhận</summary>{Object.entries(l.needs).map(([k, v]) => v !== null && typeof v === 'object' && 'evidence' in v ? <div key={k}><strong>{fieldLabels[k] || 'Nhu cầu bổ sung'}{'confirmed_by' in v && <span className={s.verified}> · Đã xác nhận</span>}</strong><blockquote>{String(v.evidence || '')}</blockquote></div> : null)}</details>}
          </section>
          <section className={s.scoreCard}><div className={s.sectionTitle}><h3><LockKeyhole size={18}/> Đánh giá tiềm năng</h3><span className={s.readOnly}>Chỉ đọc</span></div><div className={s.scoreSummary}><strong>{l.lead_score ?? '—'}<small>/100</small></strong><div><TemperatureBadge value={l.temperature}/><p>{l.temperature ? 'Kết quả từ bộ điểm ' + (l.score_rule_version || 'hiện tại') : 'Chưa đủ điều kiện xếp mức tiềm năng'}</p></div></div>
            {l.score_evidence?.breakdown && <div className={s.breakdown}>{Object.entries(l.score_evidence.breakdown).map(([key, entry]) => <div key={key}><span>{({ budget: 'Ngân sách', area_type: 'Khu vực & loại BĐS', timeline: 'Thời gian mua', contact: 'Thông tin liên hệ', next_step: 'Bước tiếp theo' } as Record<string, string>)[key] || 'Tiêu chí bổ sung'}<small>{entry.evidence || 'Chưa có thông tin xác nhận'}</small></span><strong>{entry.value == null ? '—' : '+' + entry.points}</strong></div>)}</div>}
          </section>
          <section className={s.detailCard}><div className={s.sectionTitle}><h3><UserCheck size={18}/> Người phụ trách</h3>{role === 'Admin' && !l.assignment && !closed && !l.archived && <button className={s.textButton} onClick={recheck} disabled={routing}><RefreshCw size={14} className={routing ? s.spin : ''}/> Xét lại phân công</button>}</div><div className={s.assignmentBlock}><span className={s.avatar}>{l.assignment ? l.assignment.sales_name.slice(0, 1) : '—'}</span><div><strong>{l.assignment?.sales_name || 'Chưa được phân công'}</strong><p>{l.assignment ? !l.assignment.sales_valid ? 'Sales hiện chưa đủ điều kiện nhận Lead' : l.assignment.accepted ? 'Đã tiếp nhận Lead' : 'Chờ Sales tiếp nhận Lead' : routingLabels[l.routing?.reason || ''] || 'Chờ xét nhu cầu và bất động sản phù hợp'}</p></div></div></section>
          {detail.extractions.length > 0 && <section className={s.conflictSection}><h3><CircleAlert size={18}/> Thông tin cần kiểm tra</h3><p>Giữ thông tin đã xác nhận cho đến khi bạn quyết định cập nhật.</p>{detail.extractions.map(e => <article key={e.id}><h4>{fieldLabels[e.field_name] || 'Nhu cầu bổ sung'}</h4><div className={s.comparison}><div><small>Thông tin trong hồ sơ</small><strong>{displayValue(e.field_name, need(l, e.field_name, null))}</strong></div><ArrowRight size={17}/><div><small>Thông tin mới từ hội thoại</small><strong>{displayValue(e.field_name, parsed(e.field_value))}</strong></div></div><blockquote>{e.evidence}</blockquote>{!l.archived && <div className={s.buttonRow}><button className={s.secondary} onClick={() => setAction({ kind: 'resolve_extraction', extraction: e, accept: false })}>Giữ thông tin đã xác nhận</button><button className={s.primary} onClick={() => setAction({ kind: 'resolve_extraction', extraction: e, accept: true })}>Chấp nhận thông tin mới</button></div>}</article>)}</section>}
        </>}
        {tab === 'matches' && <><div className={s.sectionTitle}><div><h3>Bất động sản đáp ứng nhu cầu</h3><p className={s.hint}>Điều kiện bắt buộc được kiểm tra trước; tiêu chí ưu tiên dùng để xếp hạng.</p></div></div>{detail.matches.length ? <div className={s.matchList}>{detail.matches.map(p => <article key={p.property_id} className={s.matchCard}><div className={s.matchHeading}><span className={s.propertyIcon}><Building2 size={23}/></span><div><small>{p.code} · {propertyTypeLabels[p.property_type as keyof typeof propertyTypeLabels] || p.property_type}</small><h3>{p.name}</h3></div>{p.selected && <span className={s.verified}><Check size={14}/> Khách đã chọn</span>}</div><p className={s.location}><MapPin size={15}/>{p.location}</p><div className={s.matchFacts}><strong>{priceLabel(p.price)}</strong><span>{p.area ?? '—'} m² · {p.bedrooms ?? '—'} phòng ngủ</span><span>{p.preference_score} tiêu chí ưu tiên đáp ứng</span></div><div className={s.matchFooter}><span><UserRound size={15}/>{p.owner_valid ? p.sales_name : 'Chưa có Sales hợp lệ phụ trách'}</span>{role === 'Admin' && p.owner_valid && !l.assignment && !l.archived && !closed && <button className={s.textButton} onClick={() => setAction({ kind: 'assign', salesId: p.sales_id || undefined, propertyId: p.property_id })}>Phân công Sales này<ArrowUpRight size={15}/></button>}</div></article>)}</div> : <Empty title={l.routing?.reason === 'missing_information' ? 'Cần bổ sung thông tin nhu cầu' : 'Chưa có bất động sản phù hợp'}>{routingLabels[l.routing?.reason || ''] || 'Bổ sung loại BĐS, khu vực và ngân sách hoặc xác nhận một sản phẩm cụ thể để xét phân công.'}</Empty>}<p className={s.hint}>Hiển thị tối đa 30 sản phẩm phù hợp hiện tại.</p></>}
        {tab === 'history' && <><p className={s.hint}>100 hoạt động gần nhất, từ mới đến cũ.</p>{history.length ? <ol className={s.timeline}>{history.filter(e => !['lead_accept', 'lead_assign'].includes(e.action)).map(e => <li key={e.id}><span className={s.timelineDot}/><div><h4>{eventLabels[e.action] || 'Cập nhật hồ sơ Lead'}</h4><small>{e.actor_name || (e.actor_kind === 'AI' ? 'Trợ lý tư vấn' : 'Hệ thống')} · {leadDate(e.created_at)}</small>{e.reason && <p>{e.reason}</p>}{e.action === 'lead_route_evaluated' && <p>{routingLabels[String(e.after_data?.reason)] || 'Đã xét lại nhu cầu'}</p>}{e.action === 'lead_status' && <p>{leadStatusLabels[(e.after_data?.request as { status?: LeadStatus } | undefined)?.status || l.status]}</p>}</div></li>)}</ol> : <Empty title="Chưa có hoạt động được ghi nhận"/>}</>}
      </div>
      {editing && <ProfileEditor lead={l} matches={detail.matches.map(p => ({ id: p.property_id, label: p.code + ' · ' + p.name }))} onClose={() => setEditing(false)} onSubmit={mutate} onReload={() => { setEditing(false); void reload(); }}/>}
      {action && <ActionDialog action={action} lead={l} role={role} sales={sales} propertyLabel={detail.matches.find(p => p.property_id === (action.propertyId || l.routing?.property_id))?.name} onClose={() => setAction(null)} onSubmit={mutate} onReload={() => { setAction(null); void reload(); }}/>}
    </>}
  </Modal>;
}

function ProfileEditor({ lead, matches, onClose, onSubmit, onReload }: { lead: Lead; matches: { id: string; label: string }[]; onClose: () => void; onSubmit: Mutate; onReload: () => void }) {
  const m = lead.needs.management || {};
  const [locations, setLocations] = useState(need<string[]>(lead, 'locations', lead.preferred_location ? [lead.preferred_location] : []).join('; '));
  const [types, setTypes] = useState(need<string[]>(lead, 'property_types', lead.preferred_property_type ? [lead.preferred_property_type] : []));
  const [min, setMin] = useState(lead.budget_min?.toString() || ''), [max, setMax] = useState(lead.budget_max?.toString() || '');
  const [purpose, setPurpose] = useState(lead.buying_purpose || ''), [timeline, setTimeline] = useState(lead.expected_timeline || '');
  const [notes, setNotes] = useState(lead.notes || ''), [reason, setReason] = useState('');
  const [management, setManagement] = useState<ManagementCriteria>({ transaction_type: m.transaction_type || 'Sale', bedrooms: m.bedrooms ?? null, bedrooms_required: m.bedrooms_required || false, area_min: m.area_min ?? null, area_max: m.area_max ?? null, area_required: m.area_required || false, selected_property_id: m.selected_property_id || null });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await onSubmit('profile', { locations: locations.split(';').map(v => v.trim()).filter(Boolean), property_types: types,
        budget_min: min ? Number(min) : null, budget_max: max ? Number(max) : null, buying_purpose: purpose,
        expected_timeline: timeline || null, notes, management }, reason);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa thể lưu hồ sơ.'); setConflict(e instanceof CatalogRequestError && e.code === 'VERSION_CONFLICT'); }
    finally { setBusy(false); }
  }
  return <Modal title="Xác nhận & cập nhật nhu cầu" subtitle="Thông tin liên hệ được giữ theo hồ sơ khách hàng đã bàn giao." onClose={onClose}>
    <form onSubmit={submit}><fieldset disabled={busy} className={s.formBody}>
      <div className={s.field}><span>Loại bất động sản</span><div className={s.typeChoices} role="group" aria-label="Loại bất động sản">{Object.entries(propertyTypeLabels).map(([k, v]) => <label key={k}><input type="checkbox" checked={types.includes(k)} onChange={e => setTypes(prev => e.target.checked ? [...prev, k] : prev.filter(t => t !== k))}/>{v}</label>)}</div></div>
      <label>Khu vực<input value={locations} maxLength={2000} onChange={e => setLocations(e.target.value)} placeholder="Ví dụ: Thủ Đức; Quận 7"/><small>Ngăn cách các khu vực có thể lựa chọn bằng dấu chấm phẩy.</small></label>
      <div className={s.formGrid}><label>Ngân sách tối thiểu (₫)<input type="number" min="1" max="1000000000000000" step="0.01" value={min} onChange={e => setMin(e.target.value)} placeholder="Chưa xác định"/></label><label>Ngân sách tối đa (₫)<input type="number" min="1" max="1000000000000000" step="0.01" value={max} onChange={e => setMax(e.target.value)} placeholder="Chưa xác định"/></label></div>
      <div className={s.formGrid}><label>Hình thức<select value={management.transaction_type} onChange={e => setManagement(v => ({ ...v, transaction_type: e.target.value as 'Sale' | 'Rent' }))}><option value="Sale">Mua</option><option value="Rent">Thuê</option></select></label><label>Thời gian dự kiến<select value={timeline} onChange={e => setTimeline(e.target.value)}><option value="">Chưa xác định</option>{Object.entries(timelineLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
      <label>Mục đích<input value={purpose} maxLength={100} onChange={e => setPurpose(e.target.value)} placeholder="Để ở, đầu tư…"/></label>
      <div className={s.formGrid}><label>Số phòng ngủ<input type="number" min="0" max="100" step="1" value={management.bedrooms ?? ''} onChange={e => setManagement(v => ({ ...v, bedrooms: e.target.value === '' ? null : Number(e.target.value) }))}/></label><label className={s.checkboxLabel}><input type="checkbox" checked={management.bedrooms_required} onChange={e => setManagement(v => ({ ...v, bedrooms_required: e.target.checked }))}/> Số phòng là điều kiện bắt buộc</label></div>
      <div className={s.formGrid}><label>Diện tích tối thiểu (m²)<input type="number" min="0" max="1000000000" step="0.01" value={management.area_min ?? ''} onChange={e => setManagement(v => ({ ...v, area_min: e.target.value === '' ? null : Number(e.target.value) }))}/></label><label>Diện tích tối đa (m²)<input type="number" min="0" max="1000000000" step="0.01" value={management.area_max ?? ''} onChange={e => setManagement(v => ({ ...v, area_max: e.target.value === '' ? null : Number(e.target.value) }))}/></label></div>
      <label className={s.checkboxLabel}><input type="checkbox" checked={management.area_required} onChange={e => setManagement(v => ({ ...v, area_required: e.target.checked }))}/> Diện tích là điều kiện bắt buộc</label>
      <div className={s.field}><label>BĐS khách đã xác nhận chọn</label><PropertyPicker value={management.selected_property_id || null} initialLabel={matches.find(p => p.id === management.selected_property_id)?.label || (management.selected_property_id ? 'BĐS khách đã xác nhận' : '')} onChange={value => setManagement(v => ({ ...v, selected_property_id: value }))}/><small>Chỉ chọn khi khách xác nhận; sản phẩm bot giới thiệu chưa được coi là lựa chọn.</small></div>
      <label>Ghi chú hồ sơ<textarea aria-label="Ghi chú hồ sơ" rows={3} maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)}/></label>
      <label>Lý do / căn cứ xác nhận<textarea aria-label="Lý do / căn cứ xác nhận" required minLength={3} maxLength={1000} rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Thông tin vừa được xác nhận với khách…"/></label>
      <p className={s.hint}>Các trường bạn thay đổi sẽ được đánh dấu đã xác nhận. Điểm và nhãn tiềm năng được giữ nguyên.</p>
      {error && <div className={s.error} role="alert">{error}{conflict && <button type="button" className={s.textButton} onClick={onReload}>Tải lại hồ sơ</button>}</div>}
      <div className={s.formFooter}><button type="button" className={s.secondary} onClick={onClose}>Hủy</button><button className={s.primary} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu nhu cầu'}</button></div>
    </fieldset></form>
  </Modal>;
}

function ActionDialog({ action, lead, role, sales, propertyLabel, onClose, onSubmit, onReload }: { action: Action; lead: Lead; role: 'Admin' | 'Sales'; sales: SalesOption[]; propertyLabel?: string; onClose: () => void; onSubmit: Mutate; onReload: () => void }) {
  const [status, setStatus] = useState<LeadStatus>(lead.status), [salesId, setSalesId] = useState(action.salesId || '');
  const [propertyId, setPropertyId] = useState<string | null>(action.propertyId || lead.routing?.property_id || null);
  const [purchasedAt, setPurchasedAt] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const titles: Record<string, string> = { status: 'Cập nhật trạng thái', accept: 'Tiếp nhận Lead', archive: lead.archived ? 'Bỏ lưu trữ Lead' : 'Lưu trữ Lead', assign: 'Phân công Sales', resolve_extraction: action.accept ? 'Xác nhận thông tin mới' : 'Giữ thông tin đã xác nhận' };
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    let data: Record<string, unknown> = {};
    if (action.kind === 'status') data = { status, ...(status === 'CONVERTED' ? { property_id: propertyId, purchased_at: purchasedAt } : {}) };
    if (action.kind === 'assign') data = { sales_id: salesId, property_id: action.propertyId || null };
    if (action.kind === 'archive') data = { archived: !lead.archived };
    if (action.extraction) data = { extraction_id: action.extraction.id, accept: action.accept };
    try { await onSubmit(action.kind, data, reason); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Chưa thể lưu thay đổi.'); setConflict(e instanceof CatalogRequestError && e.code === 'VERSION_CONFLICT'); }
    finally { setBusy(false); }
  }
  return <Modal title={titles[action.kind] || 'Xác nhận thay đổi'} onClose={onClose}><form onSubmit={submit}><fieldset disabled={busy} className={s.formBody}>
    {action.kind === 'accept' && <p>Bạn xác nhận bắt đầu xử lý Lead của <strong>{lead.customer.full_name}</strong>.</p>}
    {action.kind === 'archive' && <p>{lead.archived ? 'Hồ sơ sẽ xuất hiện lại trong danh sách; trạng thái kết thúc được giữ nguyên.' : 'Hồ sơ được giữ đầy đủ lịch sử và ẩn khỏi danh sách làm việc mặc định.'}</p>}
    {action.kind === 'status' && <><label>Trạng thái<select aria-label="Trạng thái" value={status} onChange={e => setStatus(e.target.value as LeadStatus)}>{Object.entries(leadStatusLabels).filter(([k]) => role === 'Admin' || !['CONVERTED', 'LOST'].includes(lead.status) || ['CONVERTED', 'LOST'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>{status === 'CONVERTED' && <><div className={s.field}><label>Bất động sản khách đã mua</label><PropertyPicker value={propertyId} initialLabel={propertyLabel || (propertyId ? 'BĐS được dùng khi phân công' : '')} onChange={setPropertyId}/></div><label>Ngày mua<input type="date" required value={purchasedAt} onChange={e => setPurchasedAt(e.target.value)}/></label></>}</>}
    {action.kind === 'assign' && <label>Sales nhận Lead<select aria-label="Sales nhận Lead" required value={salesId} onChange={e => setSalesId(e.target.value)}><option value="">Chọn Sales</option>{sales.filter(x => x.id !== lead.assignment?.sales_id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
    {action.kind !== 'accept' && <label>{action.kind === 'status' && status === 'LOST' ? 'Lý do không thành công' : 'Lý do / ghi nhận kết quả'}<textarea aria-label="Lý do / ghi nhận kết quả" rows={3} minLength={3} maxLength={1000} required value={reason} onChange={e => setReason(e.target.value)} placeholder="Nhập lý do để lưu cùng lịch sử…"/></label>}
    {error && <div className={s.error} role="alert">{error}{conflict && <button type="button" className={s.textButton} onClick={onReload}>Tải lại hồ sơ</button>}</div>}
    <div className={s.formFooter}><button type="button" className={s.secondary} onClick={onClose}>Hủy</button><button className={s.primary} disabled={busy}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</button></div>
  </fieldset></form></Modal>;
}
