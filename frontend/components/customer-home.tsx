'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Building2, UserRound, Search } from 'lucide-react';
import { SiteHeader } from './site-header';
import type { Role } from '@/lib/roles';
import { CustomerNav } from './customer-nav';
import { PropertyCard, useFavoriteStatus } from './property-card';
import type { PublicProperty } from '@/lib/discovery';

export function CustomerHome({ name, role }: { name: string; role: Role }) {
  const [items, setItems] = useState<PublicProperty[] | null>(null);
  const favorites=useFavoriteStatus(items?.map(item=>item.id) || []);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/catalog/search?availability=Available&pageSize=3', { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(); const data = await response.json(); setItems(data.items); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);

  return <><SiteHeader role={role}/><main className="customer-main container">
    <CustomerNav/><section className="customer-welcome">
      <div><span className="eyebrow">KHÔNG GIAN KHÁCH HÀNG</span><h1>Xin chào, {name}.</h1><p>Khám phá bất động sản phù hợp, lưu sản phẩm yêu thích và gửi nhu cầu tới đội ngũ tư vấn.</p><Link href="/properties" className="button primary"><Search size={17}/> Khám phá bất động sản</Link></div>
      <Link href="/account" className="customer-profile-card"><span className="customer-icon"><UserRound size={24}/></span><h2>Hồ sơ của bạn <ArrowUpRight size={20}/></h2><p>Cập nhật tên, số điện thoại và tùy chọn nhận thông báo.</p><span className="text-link">Quản lý hồ sơ</span></Link>
    </section>
    <section id="customer-properties" className="customer-properties"><div className="customer-section-heading"><div><span className="eyebrow">KHÁM PHÁ</span><h2>Bất động sản đang mở bán</h2></div><Link href="/properties?availability=Available" className="text-link">Xem tất cả <ArrowUpRight size={17}/></Link></div>
      {favorites.error && <p className="discovery-field-error" role="alert">{favorites.error}</p>}<div aria-live="polite">{error ? <div className="customer-empty"><p>Chưa thể tải danh sách bất động sản.</p><button className="button secondary" onClick={() => { setError(false); setItems(null); setAttempt(attempt + 1); }}>Thử lại</button></div> : items === null ? <p className="customer-empty">Đang tải bất động sản…</p> : items.length === 0 ? <div className="customer-empty"><Building2 size={32}/><h3>Chưa có sản phẩm đang mở bán</h3><p>Bất động sản mới sẽ xuất hiện tại đây khi được công bố.</p></div> : <div className="customer-product-grid">{items.map(item => <PropertyCard key={item.id} item={item} saved={favorites.has(item.id)} customer={favorites.customer} ready={favorites.ready && !favorites.error}/>)}</div>}</div>
    </section>
    <footer className="customer-footer">NexCall · Kết nối bất động sản và khách hàng</footer>
  </main></>;
}
