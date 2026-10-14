import Link from 'next/link';
import { useId } from 'react';

export function TeravaMark({ size = 32 }: { size?: number }) {
  const id = useId();
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <defs><linearGradient id={id} x1="8" y1="4" x2="56" y2="58" gradientUnits="userSpaceOnUse"><stop stopColor="#fbe7a6"/><stop offset=".5" stopColor="#e2b04a"/><stop offset="1" stopColor="#c9821f"/></linearGradient></defs>
    <g stroke={`url(#${id})`} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round">
      <path d="M20 14 8 28v11l11 17h26l11-17V28l-9-12"/>
      <path d="M20 56V6h9v50"/>
      <path d="M29 15 38 6l7 7v43"/>
      <path d="M37 56V27h8"/>
      <path d="M27 56V40h10"/>
    </g>
    <path d="m35 14 3-3 3 3-3 3z" fill={`url(#${id})`}/>
  </svg>;
}

export function Brand({ light = false, href = '/' }: { light?: boolean; href?: string }) {
  return <Link href={href} className={`brand ${light ? 'brand-light' : ''}`} aria-label="TERAVA Group — Trang chủ"><span className="brand-mark"><TeravaMark/></span><span className="brand-name">TERAVA<span className="brand-caption">GROUP · REAL ESTATE & AI</span></span></Link>;
}

export function CityIllustration({ compact = false }: { compact?: boolean }) {
  return <div className={`city ${compact ? 'city-compact' : ''}`} aria-hidden="true"><div className="city-sun"/><div className="city-cloud cloud-one"/><div className="city-cloud cloud-two"/><div className="city-ground"/><div className="city-building tower-one">{Array.from({ length: 18 }, (_, i) => <i key={i}/>)}</div><div className="city-building tower-two">{Array.from({ length: 24 }, (_, i) => <i key={i}/>)}</div><div className="city-building tower-three">{Array.from({ length: 12 }, (_, i) => <i key={i}/>)}</div><div className="city-tree tree-one"/><div className="city-tree tree-two"/><div className="city-path"/></div>;
}
