'use client';
import { useEffect, useState } from 'react';
import { Check, PhoneCall, ShieldCheck } from 'lucide-react';
type Purpose = 'Call' | 'AIVoice' | 'Transcript' | 'Recording';
type ConsentState = {
  phone_verified: boolean;
  purposes: { purpose: Purpose; granted: boolean }[];
  history: { purpose: Purpose; status: string; recorded_at: string }[];
};
const labels: Record<Purpose, string> = {
  Call: 'Gọi điện tư vấn',
  AIVoice: 'Trò chuyện với trợ lý AI qua điện thoại',
  Transcript: 'Lưu bản chép lời',
  Recording: 'Lưu ghi âm',
};
export function ContactSettings() {
  const [state, setState] = useState<ConsentState | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<Purpose | null>(null),
    [offNotice, setOffNotice] = useState(false);
  useEffect(() => {
    fetch('/api/account/contact-consents', { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.message);
        setState(d);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function change(purpose: Purpose, granted: boolean) {
    setBusy(purpose);
    setError('');
    try {
      const r = await fetch('/api/account/contact-consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose, granted, text: labels[purpose] }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.message);
      setState(d);
      if (purpose === 'Call' && !granted) setOffNotice(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể cập nhật.');
    } finally {
      setBusy(null);
    }
  }
  const values = new Map((state?.purposes || []).map((x) => [x.purpose, x.granted]));
  return (
    <section className="profile-panel contact-settings" id="lien-he">
      <div className="profile-panel-heading">
        <span className="profile-panel-icon">
          <PhoneCall size={20} />
        </span>
        <div>
          <h2>Cài đặt liên hệ</h2>
          <p>Chọn riêng từng cách TERAVA có thể liên hệ và lưu nội dung cuộc gọi.</p>
        </div>
      </div>
      {error && (
        <p className="form-alert error" role="alert">
          {error}
        </p>
      )}
      {!state ? (
        <p>Đang tải cài đặt liên hệ…</p>
      ) : (
        <>
          <p className="contact-settings-help">
            <ShieldCheck size={18} />{' '}
            {!state.phone_verified ? (
              <>
                <a href="#security">Hãy xác minh số điện thoại</a> để bật các lựa chọn liên hệ.
              </>
            ) : (
              <>Bạn có thể thay đổi từng lựa chọn bất cứ lúc nào.</>
            )}
          </p>
          <div className="contact-settings-list">
            {(Object.keys(labels) as Purpose[]).map((purpose) => (
              <label className="contact-setting" key={purpose}>
                <span>
                  <strong>{labels[purpose]}</strong>
                  <small>
                    {purpose === 'Call'
                      ? 'Cuộc gọi tư vấn từ đội ngũ TERAVA.'
                      : purpose === 'AIVoice'
                        ? 'Cuộc trò chuyện với trợ lý AI qua điện thoại.'
                        : 'Chỉ lưu khi bạn đã bật lựa chọn này.'}
                  </small>
                  {purpose === 'Call' && (values.get(purpose) || offNotice) && (
                    <em>Các cuộc gọi đang chờ sẽ bị huỷ khi tắt.</em>
                  )}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!values.get(purpose)}
                  aria-label={labels[purpose]}
                  className={`contact-switch ${values.get(purpose) ? 'is-on' : ''}`}
                  disabled={busy !== null || !state.phone_verified}
                  onClick={() => void change(purpose, !values.get(purpose))}
                >
                  <span>{values.get(purpose) ? <Check size={13} /> : null}</span>
                </button>
              </label>
            ))}
          </div>
          <div className="contact-settings-history">
            <strong>Lịch sử gần đây</strong>
            {state.history.length ? (
              state.history.map((x, i) => (
                <span key={`${x.recorded_at}-${i}`}>
                  {labels[x.purpose]} · {x.status === 'Granted' ? 'Đã bật' : 'Đã tắt'} ·{' '}
                  {new Date(x.recorded_at).toLocaleString('vi-VN')}
                </span>
              ))
            ) : (
              <small>Chưa có thay đổi.</small>
            )}
          </div>
        </>
      )}
    </section>
  );
}
