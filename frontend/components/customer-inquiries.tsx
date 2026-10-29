'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MessagesSquare, Plus } from 'lucide-react';
import { SiteHeader } from './site-header';
import type { Role } from '@/lib/roles';
import { CustomerNav } from './customer-nav';
import { inquiryLabels, type Inquiry } from '@/lib/discovery';
import { catalogRequest } from '@/lib/catalog-client';

export function CustomerInquiries({ role, guest = false }: { role: Role | null; guest?: boolean }) {
  const [data, setData] = useState<{ items: Inquiry[]; total: number } | null>(null),
    [error, setError] = useState(''),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    catalogRequest<{ items: Inquiry[]; total: number }>(
      `${guest ? '/api/guest/inquiries' : '/api/customer/inquiries'}?page=${page}&pageSize=12`,
      { signal: controller.signal },
    )
      .then((result) => {
        setData(result);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Chưa thể tải yêu cầu.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [page, attempt, guest]);
  return (
    <>
      <SiteHeader role={role} />
      <main className="discovery-main container">
        <CustomerNav active="inquiries" guest={guest} />
        <div className="customer-section-heading discovery-heading">
          <div>
            <span className="eyebrow">THEO DÕI NHU CẦU CỦA BẠN</span>
            <h1>{guest ? 'Yêu cầu trên trình duyệt này' : 'Yêu cầu tư vấn'}</h1>
            <p>
              {guest
                ? 'Chỉ trình duyệt đã gửi yêu cầu mới xem được danh sách này. Phiên được giữ trong 30 ngày.'
                : 'Xem thông tin đã gửi và trạng thái tiếp nhận.'}
            </p>
          </div>
          <Link href="/consultation" className="button primary">
            <Plus size={17} /> Yêu cầu mới
          </Link>
        </div>
        {busy ? (
          <p className="customer-empty" role="status">
            Đang tải yêu cầu…
          </p>
        ) : error ? (
          <div className="customer-empty" role="alert">
            <p>{error}</p>
            <button
              className="button secondary"
              onClick={() => {
                setBusy(true);
                setAttempt(attempt + 1);
              }}
            >
              Thử lại
            </button>
          </div>
        ) : data?.items.length ? (
          <>
            <div className="customer-inquiry-list">
              {data.items.map((inquiry) => (
                <article key={inquiry.id} className="customer-inquiry-card">
                  <div className="customer-section-heading">
                    <h2>{inquiry.property_name || 'Tư vấn theo nhu cầu'}</h2>
                    <span className={`inquiry-status ${inquiry.status}`}>{inquiryLabels[inquiry.status]}</span>
                  </div>
                  <p className="inquiry-date">
                    Gửi lúc {new Date(inquiry.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} ·
                    Mã {inquiry.id.slice(0, 8)}
                  </p>
                  {inquiry.message && <p className="property-description">{inquiry.message}</p>}
                  <dl className="property-detail-facts">
                    <div>
                      <dt>Kênh liên hệ</dt>
                      <dd>{inquiry.channel === 'Email' ? 'Email' : 'Điện thoại'}</dd>
                    </div>
                    <div>
                      <dt>Số điện thoại</dt>
                      <dd>{inquiry.phone}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{inquiry.email}</dd>
                    </div>
                    {inquiry.preferred_time && (
                      <div>
                        <dt>Thời gian phù hợp</dt>
                        <dd>{inquiry.preferred_time}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="inquiry-permissions">
                    Gọi tư vấn: {inquiry.consent.call ? 'Đồng ý' : 'Không đồng ý'} · AI giọng nói:{' '}
                    {inquiry.consent.ai ? 'Đồng ý' : 'Không đồng ý'} · Bản chép lời:{' '}
                    {inquiry.consent.transcript ? 'Đồng ý' : 'Không đồng ý'} · Ghi âm:{' '}
                    {inquiry.consent.recording ? 'Đồng ý' : 'Không đồng ý'}
                  </p>
                </article>
              ))}
            </div>
            <div className="discovery-pagination">
              <button
                className="button secondary"
                disabled={page === 1}
                onClick={() => {
                  setBusy(true);
                  setPage(page - 1);
                }}
              >
                Trang trước
              </button>
              <span>
                Trang {page} / {Math.ceil(data.total / 12)}
              </span>
              <button
                className="button secondary"
                disabled={page * 12 >= data.total}
                onClick={() => {
                  setBusy(true);
                  setPage(page + 1);
                }}
              >
                Trang sau
              </button>
            </div>
          </>
        ) : (
          <div className="customer-empty">
            <MessagesSquare size={32} />
            <h2>Chưa có yêu cầu tư vấn</h2>
            <p>Chọn một bất động sản hoặc chia sẻ nhu cầu của bạn để bắt đầu.</p>
            <Link href="/properties" className="button primary">
              Khám phá bất động sản
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
