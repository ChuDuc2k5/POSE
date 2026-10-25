'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Hover menus close after a short grace period so the pointer can travel from the
// trigger to the panel without the menu vanishing; clicks and Escape still work.
const closeDelayMs = 250;
export function useHoverMenu() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => { clearTimeout(timer.current); timer.current = undefined; }, []);
  useEffect(() => cancel, [cancel]);
  const show = useCallback(() => { cancel(); setOpen(true); }, [cancel]);
  const hide = useCallback(() => { cancel(); timer.current = setTimeout(() => setOpen(false), closeDelayMs); }, [cancel]);
  const close = useCallback(() => { cancel(); setOpen(false); }, [cancel]);
  const toggle = useCallback(() => { cancel(); setOpen(value => !value); }, [cancel]);
  return { open, close, toggle, hover: { onMouseEnter: show, onMouseLeave: hide, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Escape') close(); } } };
}
