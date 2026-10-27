'use client';
import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { AiChatWidget } from './ai-chat-widget';
import { chatStorageKey } from '@/lib/chat-storage';

type PageContext = { ownerKey: string; signedIn: boolean; propertyId?: string; propertyName?: string; path: string };
const ChatContext = createContext<(page: PageContext) => void>(() => {});

export function AiChatProvider({ children, ownerKey }: { children: ReactNode; ownerKey: string }) {
  const path = usePathname(),
    query = useSearchParams().toString();
  const [page, setPage] = useState<PageContext>(),
    [generation, setGeneration] = useState(0);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(chatStorageKey) || 'null');
      if (saved && saved.ownerKey !== ownerKey) window.sessionStorage.removeItem(chatStorageKey);
    } catch {}
  }, [ownerKey]);
  useEffect(() => {
    const clear = () => {
      setPage(undefined);
      setGeneration((n) => n + 1);
    };
    window.addEventListener('terava-chat-clear', clear);
    return () => window.removeEventListener('terava-chat-clear', clear);
  }, []);
  return (
    <ChatContext value={setPage}>
      {children}
      {page && (
        <AiChatWidget
          key={`${page.ownerKey}:${generation}`}
          {...page}
          visible={page.path === path}
          navigationKey={`${path}${query ? `?${query}` : ''}`}
        />
      )}
    </ChatContext>
  );
}

export function AiChatPage({
  ownerKey,
  signedIn = false,
  propertyId,
  propertyName,
}: {
  ownerKey: string;
  signedIn?: boolean;
  propertyId?: string;
  propertyName?: string;
}) {
  const path = usePathname(),
    setPage = useContext(ChatContext);
  useLayoutEffect(() => {
    setPage({ ownerKey, signedIn, propertyId, propertyName, path });
  }, [ownerKey, signedIn, propertyId, propertyName, path, setPage]);
  return null;
}
