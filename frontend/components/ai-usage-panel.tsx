'use client';
import { useState } from 'react';

type UsageRow={day:string;model:string;requests:number;total_tokens:number;p50_latency_ms:number;p95_latency_ms:number;fallback_rate:number;estimated_cost:number};
export function AiUsagePanel(){
  const [rows]=useState<UsageRow[]>([]);
  return <section className="ai-usage-panel" aria-labelledby="ai-usage-title">
    <div><p className="eyebrow">TERAVA AI</p><h2 id="ai-usage-title">AI usage & governance</h2><p className="muted">Daily model cost, latency and fallback health. Prices come from the server price table.</p></div>
    <div className="ai-usage-grid"><div><strong>{rows.reduce((n,r)=>n+r.requests,0)}</strong><span>requests</span></div><div><strong>{rows.reduce((n,r)=>n+r.total_tokens,0).toLocaleString()}</strong><span>tokens</span></div><div><strong>{rows.length ? `${(rows.reduce((n,r)=>n+r.fallback_rate,0)/rows.length*100).toFixed(1)}%` : '—'}</strong><span>fallback rate</span></div><div><strong>{rows.length ? `$${rows.reduce((n,r)=>n+r.estimated_cost,0).toFixed(2)}` : '—'}</strong><span>estimated cost</span></div></div>
    {rows.length ? <div className="ai-usage-table">{rows.map(row=><div className="ai-usage-row" key={`${row.day}-${row.model}`}><span>{row.day}</span><span>{row.model}</span><span>{row.requests} calls</span><span>p50 {row.p50_latency_ms}ms · p95 {row.p95_latency_ms}ms</span></div>)}</div> : <p className="ai-usage-empty">No usage rows are available yet. Apply <code>supabase/ai-request-log.sql</code> and connect the admin RPC to populate this view.</p>}
  </section>;
}
