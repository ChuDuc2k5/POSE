'use client';
import { useEffect, useState } from 'react';
import { catalogRequest } from '@/lib/catalog-client';
import { defaultScript, scriptErrors, type ScriptContent } from '@/lib/campaign-script';
import type { Campaign, Script, ScriptVersion } from '@/lib/campaign-types';
const names: Record<string, string> = {
  greeting: 'Lời mở đầu',
  ai_disclosure: 'Giới thiệu trợ lý AI',
  purpose: 'Mục đích liên hệ',
  closing: 'Lời kết',
  ai_voice: 'Đồng ý xử lý thoại AI',
  recording: 'Đồng ý lưu ghi âm',
  transcript: 'Đồng ý lưu bản chép lời',
  prompt: 'Hướng dẫn từ chối',
  confirmation: 'Xác nhận từ chối',
};
export function CampaignScripts({ campaign, onSelected }: { campaign: Campaign; onSelected: () => void }) {
  const [scripts, setScripts] = useState<Script[]>([]),
    [versions, setVersions] = useState<ScriptVersion[]>([]),
    [script, setScript] = useState(''),
    [version, setVersion] = useState<ScriptVersion | null>(null),
    [content, setContent] = useState<ScriptContent>(structuredClone(defaultScript)),
    [name, setName] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [rev, setRev] = useState(0),
    [turns, setTurns] = useState<{ turn: number; text: string }[]>([]),
    [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    catalogRequest<{ scripts: Script[]; versions: ScriptVersion[] }>('/api/admin/campaigns/scripts', {
      signal: controller.signal,
    })
      .then((r) => {
        setScripts(r.scripts);
        setVersions(r.versions);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [rev]);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const all: { id: string; name: string }[] = [];
      for (let page = 1; page <= 200; page++) {
        const r = await catalogRequest<{ items: { id: string; name: string }[]; total: number }>(
          `/api/admin/catalog/properties?status=Published&pageSize=50&page=${page}`,
          { signal: controller.signal },
        );
        all.push(...r.items);
        if (all.length >= r.total || !r.items.length) break;
      }
      setProducts(all);
    })().catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
    return () => controller.abort();
  }, []);
  const errors = scriptErrors(content),
    locked = version !== null && version.status !== 'Draft';
  function select(v: ScriptVersion | null) {
    setVersion(v);
    setContent(structuredClone(v?.content || defaultScript));
    setTurns([]);
    setError('');
  }
  async function request(path: string, body: unknown, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      const r = await catalogRequest<{ item: ScriptVersion & Script; turns?: { turn: number; text: string }[] }>(
        `/api/admin/campaigns/${path}`,
        { method, body: JSON.stringify(body) },
      );
      setRev((x) => x + 1);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể cập nhật kịch bản.');
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>Kịch bản hội thoại</h2>
      <p>Phiên bản đã công bố giữ nguyên nội dung và được lưu cùng cuộc gọi.</p>
      {error && (
        <p role="alert" className="form-alert error">
          {error}
        </p>
      )}
      <form
        className="campaigns-row"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await request('scripts', { name });
          if (r) {
            setScript(r.item.id);
            select(null);
            setName('');
          }
        }}
      >
        <label className="catalog-field">
          Tên kịch bản mới
          <input required minLength={2} maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="button secondary" disabled={busy}>
          Tạo kịch bản
        </button>
      </form>
      <div className="catalog-form-grid">
        <label className="catalog-field">
          Kịch bản
          <select
            value={script}
            onChange={(e) => {
              setScript(e.target.value);
              select(null);
            }}
          >
            <option value="">Chọn kịch bản</option>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="catalog-field">
          Phiên bản
          <select
            value={version?.id || ''}
            onChange={(e) => select(versions.find((v) => v.id === e.target.value) || null)}
          >
            <option value="">Phiên bản nháp mới</option>
            {versions
              .filter((v) => v.script_id === script)
              .map((v) => (
                <option value={v.id} key={v.id}>
                  v{v.version_no} ·{' '}
                  {v.status === 'Published' ? 'Đã công bố' : v.status === 'Draft' ? 'Bản nháp' : 'Ngừng sử dụng'}
                </option>
              ))}
          </select>
        </label>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await request(`scripts/${script}/versions`, { version_id: version?.id || null, content });
          if (r) select(r.item);
        }}
      >
        <fieldset disabled={busy || locked || !script}>
          <div className="catalog-form-grid">
            {['greeting', 'ai_disclosure', 'purpose', 'closing'].map((k) => (
              <label key={k} className="catalog-field">
                {names[k]}
                <textarea
                  value={content[k as 'greeting']}
                  maxLength={4000}
                  onChange={(e) => setContent((c) => ({ ...c, [k]: e.target.value }))}
                />
              </label>
            ))}
            {(['ai_voice', 'recording', 'transcript'] as const).map((k) => (
              <label className="catalog-field" key={k}>
                {names[k]}
                <textarea
                  value={content.consent_prompt[k]}
                  maxLength={4000}
                  onChange={(e) =>
                    setContent((c) => ({ ...c, consent_prompt: { ...c.consent_prompt, [k]: e.target.value } }))
                  }
                />
              </label>
            ))}
            {(['prompt', 'confirmation'] as const).map((k) => (
              <label className="catalog-field" key={k}>
                {names[k]}
                <textarea
                  value={content.opt_out[k]}
                  maxLength={4000}
                  onChange={(e) => setContent((c) => ({ ...c, opt_out: { ...c.opt_out, [k]: e.target.value } }))}
                />
              </label>
            ))}
            <label className="catalog-field">
              Câu hỏi nhu cầu (mỗi dòng một câu)
              <textarea
                rows={4}
                value={content.needs_questions.join('\n')}
                onChange={(e) => setContent((c) => ({ ...c, needs_questions: e.target.value.split('\n') }))}
              />
            </label>
            <label className="catalog-field">
              Nguồn sản phẩm đã công bố
              <select
                multiple
                value={content.product_source.property_ids}
                onChange={(e) =>
                  setContent((c) => ({
                    ...c,
                    product_source: { property_ids: Array.from(e.target.selectedOptions).map((o) => o.value) },
                  }))
                }
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <h3>Xử lý từ chối</h3>
          {content.objections.map((o, i) => (
            <div className="catalog-form-grid" key={i}>
              <label className="catalog-field">
                Khách nói
                <input
                  value={o.trigger}
                  maxLength={4000}
                  onChange={(e) =>
                    setContent((c) => ({
                      ...c,
                      objections: c.objections.map((x, n) => (n === i ? { ...x, trigger: e.target.value } : x)),
                    }))
                  }
                />
              </label>
              <label className="catalog-field">
                Câu trả lời
                <input
                  value={o.response}
                  maxLength={4000}
                  onChange={(e) =>
                    setContent((c) => ({
                      ...c,
                      objections: c.objections.map((x, n) => (n === i ? { ...x, response: e.target.value } : x)),
                    }))
                  }
                />
              </label>
              <button
                type="button"
                onClick={() => setContent((c) => ({ ...c, objections: c.objections.filter((_, n) => n !== i) }))}
              >
                Xóa câu từ chối
              </button>
            </div>
          ))}
          <div className="campaigns-row">
            <button
              type="button"
              disabled={content.objections.length >= 30}
              onClick={() =>
                setContent((c) => ({ ...c, objections: [...c.objections, { trigger: '', response: '' }] }))
              }
            >
              Thêm câu từ chối
            </button>
            <button className="button primary" disabled={!script || !!Object.keys(errors).length}>
              Lưu phiên bản nháp
            </button>
          </div>
        </fieldset>
      </form>
      <h3>Kiểm tra phần bắt buộc</h3>
      <ul className="campaigns-checklist">
        {[
          'greeting',
          'ai_disclosure',
          'purpose',
          'consent_prompt.ai_voice',
          'consent_prompt.recording',
          'consent_prompt.transcript',
          'needs_questions',
          'product_source',
          'opt_out.prompt',
          'opt_out.confirmation',
          'closing',
        ].map((k) => (
          <li key={k}>
            {errors[k] ? '○' : '✓'}{' '}
            {names[k.split('.').at(-1)!] || (k === 'needs_questions' ? 'Câu hỏi nhu cầu' : 'Nguồn sản phẩm')}
            {errors[k] && `: ${errors[k]}`}
          </li>
        ))}
      </ul>
      {version && (
        <>
          <p>
            Phiên bản {version.version_no} · {version.status === 'Published' ? 'Đã công bố' : 'Bản nháp'}
          </p>
          <div className="campaigns-row">
            <button
              className="button secondary"
              disabled={busy || locked || !!Object.keys(errors).length}
              onClick={async () => {
                const r = await request(`versions/${version.id}/publish`, {});
                if (r) select(r.item);
              }}
            >
              Công bố phiên bản đã lưu
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                const r = await request(`versions/${version.id}/clone`, {});
                if (r) select(r.item);
              }}
            >
              Sao chép thành bản nháp
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                const r = await request(`versions/${version.id}/preview`, {});
                if (r) setTurns(r.turns || []);
              }}
            >
              Xem hội thoại đã lưu
            </button>
          </div>
          {version.status === 'Published' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await request(
                  campaign.id,
                  { script_version_id: version.id, version: campaign.version, reason },
                  'PATCH',
                );
                if (r) onSelected();
              }}
            >
              <label className="catalog-field">
                Lý do gắn phiên bản
                <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
              </label>
              <button
                className="button primary"
                disabled={busy || !['DRAFT', 'PAUSED', 'RUNNING', 'SCHEDULED'].includes(campaign.status)}
              >
                Gắn vào chiến dịch
              </button>
            </form>
          )}
        </>
      )}
      {turns.length > 0 && (
        <>
          <h3>Xem trước hội thoại</h3>
          <ol className="campaigns-conversation">
            {turns.map((t) => (
              <li key={t.turn}>{t.text}</li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
