'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { BedDouble, Building2, CalendarClock, Heart, MapPin, Ruler } from 'lucide-react';
import { availabilityLabel, availabilityLabels as catalogAvailabilityLabels } from '@/lib/catalog';
import { catalogRequest } from '@/lib/catalog-client';

export type RecommendationSource = {
  id: string;
  code: string;
  name: string;
  updated_at: string;
  price: number | null;
  availability: keyof typeof catalogAvailabilityLabels;
  transaction_type: 'Sale' | 'Rent';
  price_period: 'Total' | 'Month';
  number?: number;
  cover_id?: string | null;
  area?: number | null;
  bedrooms?: number | null;
  location?: string;
  reason?: string;
  relaxed_reason?: string;
};

export function RecommendationCard({
  source,
  related,
  onAsk,
  onBook,
  signedIn,
  saved = false,
  customer = false,
  ready = true,
}: {
  source: RecommendationSource;
  related: boolean;
  onAsk: (message: string) => void;
  onBook?: (source: RecommendationSource) => void;
  signedIn: boolean;
  saved?: boolean;
  customer?: boolean;
  ready?: boolean;
}) {
  const [failed, setFailed] = useState(false),
    [value, setValue] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pathname = usePathname();
  const signInHref = `/sign-in?next=${encodeURIComponent(pathname)}`;
  const availabilityLabels = { ...catalogAvailabilityLabels, [source.availability]: availabilityLabel(source) };
  const unavailable = source.availability !== 'Available';
  const current = value ?? saved;
  const price =
    source.price === null
      ? 'Giá chưa công bố'
      : `${new Intl.NumberFormat('vi-VN').format(source.price)} ₫${source.price_period === 'Month' ? '/tháng' : ''}`;
  async function toggleFavorite() {
    const next = !current;
    setValue(next);
    setError('');
    setBusy(true);
    try {
      await catalogRequest(`/api/customer/favorites/${source.id}`, { method: next ? 'PUT' : 'DELETE' });
    } catch (e) {
      setValue(current);
      setError(e instanceof Error ? e.message : 'Chưa thể cập nhật yêu thích.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`ai-property-card${related ? ' is-related' : ''}`}>
      <div className="ai-property-cover">
        <Link href={`/properties/${source.id}`} aria-label={`Xem ${source.name}`}>
          {source.cover_id && !failed ? (
            <img
              src={`/api/catalog/media/${source.cover_id}?public=true`}
              alt={source.name}
              onError={() => setFailed(true)}
            />
          ) : (
            <span className="ai-property-placeholder">
              <Building2 size={28} />
            </span>
          )}
        </Link>
        {source.number !== undefined && <span className="ai-property-number">[{source.number}]</span>}
        <span className={`availability-pill ${source.availability}`}>
          {source.transaction_type === 'Rent' && source.availability === 'Available'
            ? 'Còn cho thuê'
            : availabilityLabels[source.availability]}
        </span>
      </div>
      <div className="ai-property-body">
        <h3>
          <Link href={`/properties/${source.id}`}>{source.name}</Link>
        </h3>
        <strong className="ai-property-price">{price}</strong>
        <div className="ai-property-specs">
          {source.area != null && (
            <span>
              <Ruler size={13} />
              {source.area.toLocaleString('vi-VN')} m²
            </span>
          )}
          {source.bedrooms != null && (
            <span>
              <BedDouble size={13} />
              {source.bedrooms} phòng ngủ
            </span>
          )}
        </div>
        {source.location && (
          <p className="ai-property-location">
            <MapPin size={13} />
            {source.location}
          </p>
        )}
        {(source.relaxed_reason || source.reason) && (
          <small className="ai-property-reason">{source.relaxed_reason || source.reason}</small>
        )}
        <div className="ai-property-actions">
          <Link className="ai-property-view" href={`/properties/${source.id}`}>
            Xem
          </Link>
          {signedIn ? (
            <div className="ai-favorite-control">
              {!ready ? (
                <button type="button" disabled aria-label="Đang tải yêu thích">
                  <Heart size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={current ? 'Bỏ lưu' : 'Lưu'}
                  aria-pressed={current}
                  className={current ? 'is-saved' : ''}
                  onClick={() => void toggleFavorite()}
                >
                  <Heart size={14} fill={current ? 'currentColor' : 'none'} /> {current ? 'Đã lưu' : 'Lưu'}
                </button>
              )}
              {error && (
                <span className="favorite-error" role="alert">
                  {error}
                </span>
              )}
            </div>
          ) : (
            <Link href={signInHref} aria-label={`Đăng nhập để lưu ${source.name}`}>
              <Heart size={14} /> Đăng nhập để lưu
            </Link>
          )}
          {!unavailable &&
            (signedIn ? (
              <button
                type="button"
                aria-label={`Đặt lịch xem ${source.name}`}
                onClick={() => onBook?.(source) ?? onAsk(`Đặt lịch xem căn ${source.code}`)}
              >
                <CalendarClock size={14} /> Đặt lịch xem
              </button>
            ) : (
              <Link href={signInHref} aria-label={`Đăng nhập để đặt lịch ${source.name}`}>
                <CalendarClock size={14} /> Đăng nhập để đặt lịch
              </Link>
            ))}
        </div>
      </div>
    </article>
  );
}
