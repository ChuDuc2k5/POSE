'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, RotateCcw, Trash2, X } from 'lucide-react';
import type { CatalogItem } from '@/lib/catalog';
import { catalogRequest } from '@/lib/catalog-client';

export function CatalogLifecycleDialog({ item, action, onClose, onChanged }: {
  item: CatalogItem; action: 'delete' | 'restore'; onClose: () => void; onChanged: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason,setReason] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  useEffect(() => { const element=dialog.current; element?.showModal(); return () => element?.close(); },[]);
  const deleting=action==='delete';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length<3 || reason.length>1000) { setError('Nhập lý do từ 3 đến 1.000 ký tự.'); return; }
    setBusy(true); setError('');
    try {
      const result=await catalogRequest<{message:string}>(`/api/admin/catalog/properties/${item.id}${deleting ? '' : '/restore'}`, {
        method:deleting ? 'DELETE' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({version:item.version,reason:reason.trim()}),
      });
      onChanged(result.message);
    } catch(cause) { setError(cause instanceof Error ? cause.message : 'Không thể kết nối. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="catalog-editor catalog-lifecycle-dialog" aria-labelledby="catalog-lifecycle-title" aria-describedby="catalog-lifecycle-description" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <form onSubmit={submit}>
      <div className="catalog-editor-header"><span className="catalog-editor-symbol">{deleting ? <Trash2 size={23}/> : <RotateCcw size={23}/>}</span><h2 id="catalog-lifecycle-title">{deleting ? 'Chuyển vào thùng rác?' : 'Khôi phục sản phẩm?'}</h2><button type="button" className="catalog-icon-button" aria-label="Đóng xác nhận" onClick={onClose} disabled={busy}><X size={21}/></button></div>
      <div className="catalog-editor-body"><strong>{item.name}</strong><p id="catalog-lifecycle-description">{deleting ? 'Sản phẩm và các tệp sẽ ngừng hiển thị công khai. Thông tin, liên kết nghiệp vụ và lịch sử được giữ lại để có thể khôi phục.' : 'Sản phẩm sẽ trở về bản nháp. Kiểm tra thông tin và quyền hiển thị tệp trước khi công bố lại.'}</p>
        <label className="catalog-lifecycle-reason" htmlFor="catalog-lifecycle-reason">Lý do {deleting ? 'xóa' : 'khôi phục'}<textarea id="catalog-lifecycle-reason" value={reason} onChange={event=>setReason(event.target.value)} required minLength={3} maxLength={1000} rows={3} disabled={busy}/></label>
        {error && <div className="form-alert error" role="alert">{error}</div>}
      </div>
      <div className="catalog-editor-footer"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Hủy</button><button className={`button ${deleting ? 'catalog-danger-button' : 'primary'}`} disabled={busy}>{busy && <LoaderCircle size={16} className="spin"/>}{deleting ? 'Chuyển vào thùng rác' : 'Khôi phục về bản nháp'}</button></div>
    </form>
  </dialog>;
}
