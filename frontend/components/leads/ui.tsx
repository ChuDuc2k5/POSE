'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Building2, Check, Search, X } from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import { leadStatusLabels, temperatureLabels, type LeadStatus, type Temperature } from '@/lib/leads';
import { priceLabel } from '@/lib/catalog';
import s from './leads.module.css';

export function TemperatureBadge({ value }: { value: Temperature | null }) {
  return (
    <span
      className={[
        s.badge,
        value === 'HOT' ? s.hot : value === 'WARM' ? s.warm : value === 'COLD' ? s.cold : s.unrated,
      ].join(' ')}
    >
      <span className={s.dot} />
      {value || 'Chưa đánh giá'}
    </span>
  );
}
export function StatusBadge({ value }: { value: LeadStatus }) {
  return (
    <span className={[s.status, value === 'CONVERTED' ? s.success : value === 'LOST' ? s.muted : ''].join(' ')}>
      {leadStatusLabels[value]}
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={[s.dialog, wide ? s.wideDialog : ''].join(' ')}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={s.dialogHeader}>
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button type="button" className={s.iconButton} onClick={onClose} aria-label="Đóng hộp thoại">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
type Choice = { id: string; code: string; name: string; location: string; price: number | null };
export function PropertyPicker({
  value,
  onChange,
  initialLabel = '',
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  initialLabel?: string;
}) {
  const [query, setQuery] = useState(initialLabel);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const listId = useId();
  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      catalogRequest<{ items: Choice[] }>(
        '/api/catalog/search?' + new URLSearchParams({ q: query.trim(), pageSize: '8' }),
        { signal: controller.signal },
      )
        .then((data) => {
          setItems(data.items);
          setError(data.items.length ? '' : 'Chưa tìm thấy sản phẩm theo từ khóa.');
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message || 'Chưa thể tìm sản phẩm.');
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);
  return (
    <div className={s.picker}>
      <div className={s.searchInput}>
        <Search size={17} />
        <input
          aria-label="Tìm BĐS theo mã hoặc tên"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setItems([]);
            setError('');
            onChange(null);
          }}
          placeholder="Tìm bằng mã hoặc tên BĐS…"
          aria-controls={listId}
        />
        {value && <Check size={17} />}
      </div>
      {value && (
        <button
          type="button"
          className={s.textButton}
          onClick={() => {
            onChange(null);
            setQuery('');
            setOpen(false);
          }}
        >
          Bỏ lựa chọn
        </button>
      )}
      {open && query.trim().length >= 2 && (
        <div id={listId} className={s.pickerResults}>
          {items.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onChange(p.id);
                setQuery(p.code + ' · ' + p.name);
                setOpen(false);
              }}
            >
              <Building2 size={18} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.code} · {p.location} · {priceLabel(p.price)}
                </small>
              </span>
            </button>
          ))}
          {!items.length && <p>{error || 'Đang tìm kiếm…'}</p>}
        </div>
      )}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>
        <Building2 size={28} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Score({ score, temperature }: { score: number | null; temperature: Temperature | null }) {
  return (
    <div className={s.scoreInline}>
      <div>
        <strong>{score ?? '—'}</strong>
        <span>/100</span>
      </div>
      <div className={s.scoreTrack} aria-hidden="true">
        <span style={{ width: Math.max(0, Math.min(score || 0, 100)) + '%' }} />
      </div>
      <small>{temperatureLabels[temperature || 'UNRATED']}</small>
    </div>
  );
}
