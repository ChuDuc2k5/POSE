'use client';
import { useId } from 'react';
import { ChartColumn } from 'lucide-react';
import { leadStatusLabels, temperatureLabels } from '@/lib/leads';
import { reportDate, type LeadReport } from '@/lib/reports';
import s from './reports.module.css';
const statusColors = { NEW: '#8c87b9', CONTACTED: '#6d94ac', QUALIFIED: '#3a8a78', FOLLOW_UP: '#bc9755', CONVERTED: '#28745c', LOST: '#a3a5a8' };
const temperatureColors = { HOT: '#c87c69', WARM: '#c7a05d', COLD: '#789ab1', UNRATED: '#bec3bc' };
const number = (v: number) => v.toLocaleString('vi-VN');
export function ChartEmpty() { return <div className={s.empty}><ChartColumn size={32} aria-hidden="true"/><p>Chưa có Lead phù hợp với bộ lọc.</p></div>; }
export function StatusChart({ rows }: { rows: LeadReport['statuses'] }) {
  const maximum = Math.max(1, ...rows.map(r => r.count));
  return <dl className={s.statusBars}>{rows.map(r => <div key={r.key}><dt><i style={{ background: statusColors[r.key] }} aria-hidden="true"/>{leadStatusLabels[r.key]}</dt><dd><span className={s.track} aria-hidden="true"><span style={{ width: r.count / maximum * 100 + '%', background: statusColors[r.key] }}/></span><strong>{number(r.count)}</strong></dd></div>)}</dl>;
}
export function TemperatureChart({ rows }: { rows: LeadReport['temperatures'] }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  let offset = 0;
  const stops = rows.map(r => { const start = offset; offset += total ? r.count / total * 100 : 0; return `${temperatureColors[r.key]} ${start}% ${offset}%`; });
  return <div className={s.temperatureChart}><div className={s.donut} style={{ background: total ? `conic-gradient(${stops.join(',')})` : '#eceee8' }} aria-hidden="true"><div><strong>{number(total)}</strong><span>Lead</span></div></div><ul className={s.legend}>{rows.map(r => <li key={r.key}><i style={{ background: temperatureColors[r.key] }} aria-hidden="true"/><span><strong>{r.key === 'UNRATED' ? 'Chưa đánh giá' : r.key}</strong>{r.key !== 'UNRATED' && <small>{temperatureLabels[r.key]}</small>}</span><b>{number(r.count)}</b></li>)}</ul></div>;
}
export function TrendChart({ data, bucket }: { data: LeadReport['trend']; bucket: LeadReport['bucket'] }) {
  const id = useId().replace(/[^a-zA-Z0-9_]/g, '');
  const width = 1000, height = 260, left = 46, right = 20, top = 20, bottom = 44;
  const max = Math.max(4, Math.ceil(Math.max(0, ...data.map(d => d.count)) / 4) * 4);
  const x = (i: number) => data.length < 2 ? (width + left - right) / 2 : left + i / (data.length - 1) * (width - left - right);
  const y = (count: number) => height - bottom - count / max * (height - top - bottom);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.count)}`).join(' ');
  const area = data.length ? `${path} L${x(data.length - 1)},${height - bottom} L${x(0)},${height - bottom} Z` : '';
  const tick = Math.max(1, Math.ceil((data.length - 1) / 5));
  return <><div className={s.trendGraph}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id + 'title'}><title id={id + 'title'}>Số Lead được tạo theo {bucket === 'day' ? 'ngày' : 'tháng'}, theo giờ Việt Nam</title><defs><linearGradient id={id + 'fill'} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#8d87b6" stopOpacity=".22"/><stop offset="1" stopColor="#8d87b6" stopOpacity=".02"/></linearGradient></defs>
    {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1={left} x2={width - right} y1={y(i * max / 4)} y2={y(i * max / 4)} stroke="#e7eae3" strokeDasharray="4 5"/><text x={left - 12} y={y(i * max / 4) + 4} textAnchor="end">{number(i * max / 4)}</text></g>)}
    <path d={area} fill={`url(#${id}fill)`}/><path d={path} fill="none" stroke="#746b9c" strokeWidth="2.5" strokeLinejoin="round"/>
    {data.map((d, i) => <g key={d.date}><circle cx={x(i)} cy={y(d.count)} r={data.length > 40 ? 2.5 : 4} fill="#746b9c" stroke="white" strokeWidth="2" tabIndex={0} aria-label={`${reportDate(d.date, bucket === 'month')}: ${number(d.count)} Lead`}><title>{reportDate(d.date, bucket === 'month')} · {number(d.count)} Lead</title></circle>{(i % tick === 0 || i === data.length - 1) && <text x={x(i)} y={height - 12} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{bucket === 'month' ? reportDate(d.date, true) : reportDate(d.date).slice(0, 5)}</text>}</g>)}
  </svg></div><details className={s.trendData}><summary>Xem số liệu theo {bucket === 'day' ? 'ngày' : 'tháng'}</summary><div><table><thead><tr><th>{bucket === 'day' ? 'Ngày' : 'Tháng'}</th><th>Lead phát sinh</th></tr></thead><tbody>{data.map(d => <tr key={d.date}><td>{reportDate(d.date, bucket === 'month')}</td><td>{number(d.count)}</td></tr>)}</tbody></table></div></details></>;
}
