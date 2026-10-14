'use client';
import Link from 'next/link';
export default function PropertyError({reset}:{reset:()=>void}){return <main className="container customer-empty"><h1>Chưa thể tải sản phẩm</h1><p>Vui lòng thử lại sau.</p><button className="button primary" onClick={reset}>Thử lại</button><Link className="button secondary" href="/properties">Về danh sách</Link></main>;}
