'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import type { Profile } from '@/lib/profile';
import { CatalogRequestError, catalogRequest } from '@/lib/catalog-client';
import { inquiryLabels } from '@/lib/discovery';
import { readInquiryDraft, clearInquiryDraft } from '@/lib/inquiry-draft';

type Draft = {
  name: string;
  phone: string;
  country: string;
  email: string;
  channel: string;
  preferredTime: string;
  message: string;
  createdAt: number;
};
export function InquiryForm({
  propertyId = null,
  propertyName,
  guest = false,
}: {
  propertyId?: string | null;
  propertyName?: string;
  guest?: boolean;
}) {
  const [identity, setIdentity] = useState<'loading' | 'customer' | 'guest' | 'staff' | 'error'>('loading');
  const [name, setName] = useState(''),
    [phone, setPhone] = useState(''),
    [country, setCountry] = useState(''),
    [email, setEmail] = useState('');
  const [channel, setChannel] = useState('Email'),
    [preferredTime, setPreferredTime] = useState(''),
    [message, setMessage] = useState('');
  const [consent, setConsent] = useState({
    contact: false,
    call: false,
    ai: false,
    transcript: false,
    recording: false,
  });
  const [fields, setFields] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ id: string; status: keyof typeof inquiryLabels } | null>(null);
  const key = useRef<string | null>(null),
    draftKey = `terava-inquiry-form:${propertyId || 'general'}`;
  useEffect(() => {
    const controller = new AbortController();
    let draft: Partial<Draft> | null = null;
    try {
      const value = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
      if (
        value &&
        typeof value.createdAt === 'number' &&
        value.createdAt <= Date.now() &&
        Date.now() - value.createdAt < 30 * 60 * 1000
      )
        draft = value;
    } catch {
      /* Draft storage is optional. */
    }
    const homeDraft = propertyId ? null : readInquiryDraft();
    const apply = (profile?: Profile, accountEmail?: string) => {
      const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
      setName(text(draft?.name, homeDraft?.name || profile?.name || ''));
      setPhone(text(draft?.phone, homeDraft?.phone || profile?.phone || ''));
      setCountry(text(draft?.country, homeDraft ? 'VN' : ''));
      setEmail(accountEmail || text(draft?.email));
      setChannel(draft?.channel === 'Phone' ? 'Phone' : 'Email');
      setPreferredTime(text(draft?.preferredTime));
      setMessage(text(draft?.message, homeDraft?.message || ''));
    };
    // The server already knows a visitor is signed out; skip the identity call that would only answer 401.
    if (guest) {
      apply();
      setIdentity('guest');
      return () => controller.abort();
    }
    fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          apply();
          setIdentity('guest');
          return;
        }
        if (!response.ok) throw new Error();
        const me = await response.json();
        if (me.user.role !== 'User') {
          setIdentity('staff');
          return;
        }
        const data = await catalogRequest<{ profile: Profile }>('/api/account/profile', { signal: controller.signal });
        apply(data.profile, me.user.email);
        setIdentity('customer');
      })
      .catch(() => {
        if (!controller.signal.aborted) setIdentity('error');
      });
    return () => controller.abort();
  }, [propertyId, draftKey, attempt, guest]);
  useEffect(() => {
    if (!['guest', 'customer'].includes(identity) || result) return;
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ name, phone, country, email, channel, preferredTime, message, createdAt: Date.now() }),
      );
    } catch {
      /* The form works without draft storage. */
    }
  }, [name, phone, country, email, channel, preferredTime, message, identity, result, draftKey]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    key.current ||= crypto.randomUUID();
    try {
      const data = await catalogRequest<{ id: string; status: keyof typeof inquiryLabels }>(
        identity === 'guest' ? '/api/guest/inquiries' : '/api/customer/inquiries',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            property_id: propertyId,
            name,
            phone,
            country,
            channel,
            preferred_time: preferredTime,
            message,
            consent,
            request_key: key.current,
            ...(identity === 'guest' ? { email } : {}),
          }),
        },
      );
      setResult(data);
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Optional draft. */
      }
      if (!propertyId) clearInquiryDraft();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa thể gửi yêu cầu.');
      if (e instanceof CatalogRequestError) setFields(e.fields);
    } finally {
      setBusy(false);
    }
  }
  const fieldError = (field: string) => fields[field] && <span className="discovery-field-error">{fields[field]}</span>;
  return (
    <section className="inquiry-panel" id="tu-van">
      <span className="eyebrow">ĐỂ TERAVA ĐỒNG HÀNH CÙNG BẠN</span>
      <h2>Gửi yêu cầu tư vấn</h2>
      <p>{propertyName ? `Bạn đang quan tâm: ${propertyName}.` : 'Chia sẻ nhu cầu để đội ngũ tư vấn tiếp nhận.'}</p>
      {identity === 'loading' ? (
        <p role="status">Đang tải biểu mẫu…</p>
      ) : identity === 'staff' ? (
        <p>Vui lòng sử dụng tài khoản khách hàng để gửi yêu cầu tư vấn.</p>
      ) : identity === 'error' ? (
        <div role="alert">
          <p>Chưa thể tải biểu mẫu.</p>
          <button
            className="button secondary"
            onClick={() => {
              setIdentity('loading');
              setAttempt((value) => value + 1);
            }}
          >
            Thử lại
          </button>
        </div>
      ) : result ? (
        <div className="inquiry-success" role="status">
          <CheckCircle2 size={30} />
          <h3>Đã ghi nhận yêu cầu của bạn</h3>
          <p>{inquiryLabels[result.status]}. Đội ngũ sẽ phản hồi theo kênh liên hệ bạn đã chọn.</p>
          <Link href={identity === 'guest' ? '/guest/inquiries' : '/customer/inquiries'} className="button primary">
            Xem yêu cầu của tôi
          </Link>
          {identity === 'guest' && <p>Bạn có thể xem lại yêu cầu trên trình duyệt này trong 30 ngày.</p>}
        </div>
      ) : (
        <form
          onSubmit={submit}
          onChange={() => {
            key.current = null;
          }}
        >
          <fieldset disabled={busy}>
            <div className="inquiry-form-grid">
              <label>
                Họ tên
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {fieldError('name')}
              </label>
              <label>
                {identity === 'guest' ? 'Email liên hệ' : 'Email tài khoản'}
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  required={channel === 'Email'}
                  readOnly={identity !== 'guest'}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {fieldError('email')}
              </label>
              <label>
                Quốc gia của số liên hệ
                <select name="country" required value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="">Chọn quốc gia / định dạng</option>
                  <option value="VN">Việt Nam (+84)</option>
                  <option value="International">Quốc tế — nhập mã quốc gia</option>
                </select>
                {fieldError('country')}
              </label>
              <label>
                Số điện thoại
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  maxLength={32}
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={country === 'VN' ? '0912345678' : '+12025550123'}
                />
                {fieldError('phone')}
              </label>
              <label>
                Kênh liên hệ mong muốn
                <select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="Email">Email</option>
                  <option value="Phone">Điện thoại</option>
                </select>
                {fieldError('channel')}
              </label>
              <label>
                Thời gian liên hệ phù hợp
                <input
                  name="preferred_time"
                  maxLength={200}
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  placeholder="Ví dụ: 14:00–16:00 các ngày trong tuần"
                />
              </label>
            </div>
            <label>
              Nhu cầu của bạn
              <textarea
                name="message"
                rows={4}
                required={!propertyId}
                minLength={propertyId ? undefined : 10}
                maxLength={3000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ngân sách, khu vực mong muốn và thông tin cần tư vấn…"
              />
              {fieldError('message')}
            </label>
            <div className="inquiry-consent">
              <p>
                Thông tin dùng để tiếp nhận và phản hồi yêu cầu. Không cần OTP điện thoại để gửi. Bạn có thể chọn email
                khi không muốn nhận cuộc gọi.
              </p>
              {(
                [
                  ['contact', 'Đồng ý sử dụng tên và thông tin liên hệ để xử lý yêu cầu tư vấn.'],
                  ['call', 'Đồng ý nhận cuộc gọi tư vấn.'],
                  ['ai', 'Đồng ý xử lý giọng nói bằng AI khi có cuộc gọi.'],
                  ['transcript', 'Đồng ý lưu bản chép lời cuộc gọi.'],
                  ['recording', 'Đồng ý ghi âm và lưu cuộc gọi.'],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={consent[value]}
                    required={value === 'contact'}
                    onChange={(e) => setConsent({ ...consent, [value]: e.target.checked })}
                  />
                  <span>
                    {label}
                    {value === 'contact' && <small> Bắt buộc để gửi yêu cầu</small>}
                  </span>
                </label>
              ))}
              {fieldError('consent')}
              <Link href="/terms" className="text-link">
                Điều khoản & quyền riêng tư
              </Link>
            </div>
            {error && (
              <p className="discovery-field-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" type="submit" disabled={busy}>
              <Send size={17} />
              {busy ? 'Đang gửi…' : 'Gửi yêu cầu tư vấn'}
            </button>
            {identity === 'guest' && (
              <p>
                <Link href="/guest/inquiries" className="text-link">
                  Xem yêu cầu đã gửi trên trình duyệt này
                </Link>
              </p>
            )}
          </fieldset>
        </form>
      )}
    </section>
  );
}
