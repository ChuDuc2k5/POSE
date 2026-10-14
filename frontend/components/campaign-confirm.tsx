'use client';
import { useEffect, useRef, type ReactNode } from 'react';
export function CampaignConfirm({label,onClose,children}:{label:string;onClose:()=>void;children:ReactNode}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
 return <dialog ref={ref} className="campaigns-confirm" aria-label={label} onCancel={onClose}>{children}</dialog>;
}
