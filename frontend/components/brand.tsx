import Link from 'next/link';
import { PhoneCall } from 'lucide-react';

export function Brand({ light = false, href = '/' }: { light?: boolean; href?: string }) {
  return <Link href={href} className={`brand ${light ? 'brand-light' : ''}`} aria-label="NexCall — Trang chủ"><span className="brand-mark"><PhoneCall size={23} strokeWidth={1.8}/></span><span>NexCall<span className="brand-caption">PROPERTY & CUSTOMER WORKSPACE</span></span></Link>;
}

export function CityIllustration({ compact = false }: { compact?: boolean }) {
  return <div className={`city ${compact ? 'city-compact' : ''}`} aria-hidden="true"><div className="city-sun"/><div className="city-cloud cloud-one"/><div className="city-cloud cloud-two"/><div className="city-ground"/><div className="city-building tower-one">{Array.from({ length: 18 }, (_, i) => <i key={i}/>)}</div><div className="city-building tower-two">{Array.from({ length: 24 }, (_, i) => <i key={i}/>)}</div><div className="city-building tower-three">{Array.from({ length: 12 }, (_, i) => <i key={i}/>)}</div><div className="city-tree tree-one"/><div className="city-tree tree-two"/><div className="city-path"/></div>;
}
