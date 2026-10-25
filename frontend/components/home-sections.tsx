'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Building2, ChevronDown, Headphones, MapPin, Menu, Search, Wallet, X } from 'lucide-react';
import { priceLabel, propertyTypeLabels } from '@/lib/catalog';
import type { SearchResult } from '@/lib/discovery';
import { saveInquiryDraft } from '@/lib/inquiry-draft';
import { Brand } from './brand';
import styles from './system-home.module.css';

export function HomeNavigation() {
  const [open, setOpen] = useState(false);
  return <header className={styles.navigation}>
    <div className={`${styles.container} ${styles.navigationInner}`}>
      <Brand light={false} compactOnMobile/>
      <button type="button" className={styles.menuToggle} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="home-navigation" aria-label={open ? 'Đóng menu' : 'Mở menu'}>{open ? <X size={23}/> : <Menu size={23}/>}</button>
      <nav id="home-navigation" aria-label="Điều hướng chính" className={`${styles.navLinks} ${open ? styles.navOpen : ''}`} onClick={() => setOpen(false)}>
        <a href="#trang-chu" aria-current="page">Trang chủ</a><a href="#du-an">Dự án</a><a href="#ve-nexcall">Về TERAVA</a><a href="#tu-van">Liên hệ</a>
        <a href="#tu-van" className={styles.supportLink}><Headphones size={16}/> Tư vấn cùng TERAVA</a>
      </nav>
      <div className={styles.navAccount}><Link href="/sign-in" className={styles.smallButton}>Đăng nhập</Link><Link href="/sign-up" className={styles.primaryButton}>Đăng ký</Link></div>
    </div>
  </header>;
}

const typeChips = [['Apartment', 'Căn hộ'], ['Villa', 'Biệt thự'], ['Land', 'Đất nền'], ['Office', 'Văn phòng']];
const budgets = [
  { value: 'under5', label: 'Dưới 5 tỷ', min: '', max: '5000000000' },
  { value: '5to10', label: '5–10 tỷ', min: '5000000000', max: '10000000000' },
  { value: 'over10', label: 'Trên 10 tỷ', min: '10000000000', max: '' },
];

export function HomePropertySearch() {
  const router = useRouter();
  const [type, setType] = useState(''), [budget, setBudget] = useState(''), [location, setLocation] = useState('');
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (location) params.set('location', location);
    if (type) params.set('type', type);
    const range = budgets.find(item => item.value === budget);
    if (range?.min) params.set('minPrice', range.min);
    if (range?.max) params.set('maxPrice', range.max);
    router.push(`/properties${params.size ? `?${params}` : ''}`);
  }
  return <section className={styles.searchPanel} id="tim-kiem" aria-labelledby="search-heading">
    <div className={styles.searchHeading}><div><h2 id="search-heading">Tìm kiếm bất động sản</h2><p>Lọc nhanh theo khu vực, loại hình và ngân sách phù hợp.</p></div><span className={styles.supportBadge}>Khám phá 24/7</span></div>
    <form onSubmit={search}>
      <div className={styles.searchFields}>
        <label className={styles.selectField}><MapPin size={19}/><select name="location" aria-label="Khu vực" value={location} onChange={event => setLocation(event.target.value)}><option value="">Hồ Chí Minh, Hà Nội, Đà Nẵng…</option><option value="Hồ Chí Minh">Hồ Chí Minh</option><option value="Hà Nội">Hà Nội</option><option value="Đà Nẵng">Đà Nẵng</option></select><ChevronDown size={15}/></label>
        <label className={styles.selectField}><Building2 size={19}/><select name="type" aria-label="Loại hình" value={type} onChange={event => setType(event.target.value)}><option value="">Loại hình</option>{Object.entries(propertyTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={15}/></label>
        <label className={styles.selectField}><Wallet size={19}/><select name="budget" aria-label="Ngân sách" value={budget} onChange={event => setBudget(event.target.value)}><option value="">Ngân sách</option>{budgets.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select><ChevronDown size={15}/></label>
        <button type="submit" className={styles.primaryButton}><Search size={16}/> Tìm ngay</button>
      </div>
      <div className={styles.filterChips}>
        {typeChips.map(([value, label]) => <button type="button" key={value} aria-pressed={type === value} onClick={() => setType(type === value ? '' : value)}>{label}</button>)}
        <span className={styles.chipDivider}/>
        {budgets.map(item => <button type="button" key={item.value} aria-pressed={budget === item.value} onClick={() => setBudget(budget === item.value ? '' : item.value)}>{item.label}</button>)}
      </div>
    </form>
  </section>;
}

const examples = [
  { name: 'TERAVA Sky City', image: 'hero', type: 'Apartment', description: 'Không gian sống hiện đại, tầm nhìn rộng mở và những tiện ích cho mỗi ngày.', location: 'Không gian sống giữa lòng thành phố', price: 'Căn hộ cao cấp' },
  { name: 'TERAVA Riverside', image: 'villa', type: 'Villa', description: 'Biệt thự với sân vườn riêng, thiết kế tinh tế và không gian gần gũi thiên nhiên.', location: 'Không gian xanh, cuộc sống an yên', price: 'Biệt thự sân vườn' },
  { name: 'TERAVA Central Plaza', image: 'office', type: 'Office', description: 'Văn phòng hiện đại với mặt bằng thông thoáng, kết nối thuận tiện cho doanh nghiệp.', location: 'Kết nối trung tâm, đón đầu cơ hội', price: 'Văn phòng hiện đại' },
];

type HomeProperty = { id: string; name: string; type: string; image: string; description: string; location: string; price: string; href: string };

function PropertyPhoto({ item }: { item: HomeProperty }) {
  const [failed, setFailed] = useState(false);
  return <Link href={item.href} className={styles.propertyPhoto} aria-label={`Khám phá ${item.name}`}>
    {failed ? <div className={styles.photoPlaceholder}><Building2 size={38}/><span>{item.name}</span></div> : <Image src={item.image} alt={item.name} width={1536} height={1024} sizes="(max-width: 600px) 100vw, (max-width: 900px) 48vw, 33vw" quality={90} unoptimized={item.image.startsWith('/api/')} onError={() => setFailed(true)}/>}
  </Link>;
}

export function FeaturedProperties() {
  const [items, setItems] = useState<HomeProperty[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/catalog/search?availability=Available&pageSize=3', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('CATALOG_UNAVAILABLE');
        const result: SearchResult = await response.json();
        setItems(result.items.map(item => ({ id: item.id, name: item.name, type: item.property_type || 'Apartment', image: item.cover_id ? `/api/catalog/media/${item.cover_id}?public=true` : '', description: item.description, location: item.location, price: priceLabel(item.price) + (item.price != null && item.price_period === 'Month' ? '/tháng' : ''), href: `/properties/${item.id}` })));
      })
      .catch(() => { /* Keep the explicitly labelled inspiration cards available offline. */ });
    return () => controller.abort();
  }, []);
  const inspiration = !items?.length;
  const cards: HomeProperty[] = inspiration ? examples.map(item => ({ ...item, id: item.type, image: `/images/home/${item.image}.webp`, href: `/properties?type=${item.type}` })) : items;
  return <>
    <div className={styles.propertyGrid}>{cards.map(item => <article key={item.id} className={styles.propertyCard}>
      {item.image ? <PropertyPhoto key={item.image} item={item}/> : <Link href={item.href} className={styles.propertyPhoto}><div className={styles.photoPlaceholder}><Building2 size={38}/><span>{item.name}</span></div></Link>}
      <div className={styles.propertyBody}>
        <div className={styles.propertyMeta}><span className={`${styles.typeBadge} ${item.type === 'Villa' ? styles.villaBadge : item.type === 'Office' ? styles.officeBadge : ''}`}>{propertyTypeLabels[item.type as keyof typeof propertyTypeLabels] || 'Bất động sản'}</span><span>{item.price}</span></div>
        <h3><Link href={item.href}>{item.name}</Link></h3><p>{item.description}</p>
        <div className={styles.propertyBottom}><span><MapPin size={15}/>{item.location}</span><Link href={item.href} className={styles.smallButton}>{inspiration ? 'Khám phá' : 'Xem chi tiết'}</Link></div>
      </div>
    </article>)}</div>
    {inspiration && <p className={styles.inspirationNote}>Hình ảnh và tên dự án minh họa phong cách. Khám phá danh mục để xem bất động sản đang được công bố.</p>}
  </>;
}

export function HomeConsultation() {
  const router = useRouter();
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim(), phone = String(form.get('phone') || '').trim(), need = String(form.get('need') || '');
    if (name.length < 2) {
      setError('Vui lòng nhập họ và tên từ 2 ký tự.');
      return;
    }
    if (!/^(?:\+84|0)[1-9]\d{8}$/.test(phone.replace(/[\s.-]/g, ''))) {
      setError('Vui lòng nhập số điện thoại Việt Nam hợp lệ.');
      return;
    }
    if (!saveInquiryDraft({ name, phone, message: `Tôi muốn được tư vấn về ${need.toLowerCase()}.`, createdAt: Date.now() })) {
      setError('Trình duyệt chưa cho phép lưu nhu cầu. Bạn có thể đăng nhập để gửi yêu cầu trực tiếp.');
      return;
    }
    router.push('/consultation');
  }
  return <form className={styles.consultationForm} id="dang-ky-tu-van" onSubmit={submit}>
    <h3>Đăng ký nhận tư vấn</h3>
    <div className={styles.contactFields}>
      <label>Họ và tên<input name="name" placeholder="Nhập họ và tên" autoComplete="name" required minLength={2} maxLength={80}/></label>
      <label>Số điện thoại<input name="phone" type="tel" placeholder="Nhập số điện thoại" autoComplete="tel" required maxLength={20}/></label>
    </div>
    <label>Nhu cầu<span className={styles.needSelect}><select name="need" aria-label="Nhu cầu" required defaultValue=""><option value="" disabled>Chọn loại hình bất động sản</option>{Object.values(propertyTypeLabels).map(label => <option key={label}>{label}</option>)}</select><ChevronDown size={16}/></span></label>
    {error && <p className={styles.formError} role="alert">{error} <Link href="/sign-in">Đăng nhập</Link></p>}
    <button type="submit" className={styles.primaryButton}>Tiếp tục gửi yêu cầu</button>
    <p className={styles.formNote}>Đăng nhập ở bước tiếp theo để xác nhận và theo dõi yêu cầu tư vấn.</p>
  </form>;
}
