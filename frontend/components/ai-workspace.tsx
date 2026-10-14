'use client';
import { useEffect, useState } from 'react';
import { TeravaMark } from './brand';
type Lead={id:string;full_name:string;version:number;score:number|null;classification:string;score_rule_version:string|null;score_evidence:{breakdown?:Record<string,{points:number;evidence:string|null}>}|null};
type Task={id:string;summary:string;kind:string;leads:Lead|null};
type Log={id:string;tool:string;reason:string;decision:'blocked'|'flagged';created_at:string;rule_version:string};
export function AiWorkspace({admin=false}:{admin?:boolean}){
 const [tasks,setTasks]=useState<Task[]>([]),[logs,setLogs]=useState<Log[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[notice,setNotice]=useState('');
 async function load(){setLoading(true);try{const response=await fetch(`/api/ai/workspace${admin ? '?logs=true':''}`);const data=await response.json();if(!response.ok)throw new Error(data.message);if(admin)setLogs(data.items);else setTasks(data.items);}catch(e){setError(e instanceof Error ? e.message:'Chưa thể tải dữ liệu.');}finally{setLoading(false);}}
 useEffect(()=>{
  let active=true;
  fetch(`/api/ai/workspace${admin ? '?logs=true':''}`).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.message);if(active){if(admin)setLogs(data.items);else setTasks(data.items);}}).catch(e=>{if(active)setError(e instanceof Error ? e.message:'Chưa thể tải dữ liệu.');}).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[admin]);
 async function override(event:React.FormEvent<HTMLFormElement>,lead:Lead){event.preventDefault();const data=new FormData(event.currentTarget);setError('');try{const response=await fetch('/api/ai/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead_id:lead.id,version:lead.version,classification:data.get('classification'),reason:data.get('reason')})});const result=await response.json();if(!response.ok)throw new Error(result.message);setNotice('Đã cập nhật phân loại và lưu lý do.');await load();}catch(e){setError(e instanceof Error ? e.message:'Chưa thể lưu.');}}
 return <section className="ai-workspace catalog-list-panel"><header className="ai-workspace-heading"><TeravaMark size={32}/><h2>{admin ? 'AI Agent · nhật ký kiểm soát':'Bàn giao từ trợ lý AI'}</h2></header>{loading && <p role="status">Đang tải…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}<button className="button secondary" onClick={()=>void load()}>Tải lại</button>
 {admin ? logs.map(l=><article key={l.id}><strong>{l.tool} · {l.decision==='flagged' ? 'Đã gắn cờ':'Đã chặn'}</strong><p>{l.reason} · {l.rule_version}</p><small>{new Date(l.created_at).toLocaleString('vi-VN')}</small></article>):tasks.map(t=><article key={t.id}><h3>{t.kind} · {t.summary}</h3>{t.leads ? <><p>{t.leads.full_name} · {t.leads.score ?? 'Chưa có điểm'} · {t.leads.classification} · {t.leads.score_rule_version}</p><dl>{Object.entries(t.leads.score_evidence?.breakdown || {}).map(([k,b])=><div key={k}><dt>{k} · {b.points}</dt><dd>{b.evidence || 'Chưa xác định'}</dd></div>)}</dl><form onSubmit={e=>void override(e,t.leads!)}><label>Phân loại <select name="classification" defaultValue={t.leads.classification}>{['Hot','Warm','Cold','Unrated'].map(c=><option key={c}>{c}</option>)}</select></label><label>Lý do <input name="reason" required minLength={3} maxLength={1000}/></label><button className="button primary">Lưu phân loại</button></form></>:<p>Đang chờ phân công Lead cho chuyên viên.</p>}</article>)}
 {!loading && !(admin ? logs:tasks).length && <p>Chưa có mục nào trong phạm vi của bạn.</p>}</section>;
}
