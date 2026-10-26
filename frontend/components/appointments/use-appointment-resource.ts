'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { catalogRequest, CatalogRequestError } from '@/lib/catalog-client';
export function useAppointmentResource<T>(url: string | null, revision = 0) {
  const router = useRouter();
  const [response, setResponse] = useState<{ key: string; data?: T; error: string } | null>(null);
  const key = JSON.stringify([url, revision]);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    catalogRequest<T>(url, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setResponse({ key, data, error: '' }); }).catch(e => {
      if (controller.signal.aborted) return;
      setResponse({ key, error: e instanceof Error ? e.message : 'Chưa thể tải lịch hẹn.' });
      if (e instanceof CatalogRequestError && ['UNAUTHORIZED', 'FORBIDDEN'].includes(e.code)) router.refresh();
    });
    return () => controller.abort();
  }, [url, key, router]);
  return { data: url && response?.key === key ? response.data : undefined, error: url && response?.key === key ? response.error : '', loading: !!url && response?.key !== key };
}
