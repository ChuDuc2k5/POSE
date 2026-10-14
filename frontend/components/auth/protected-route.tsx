'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getAuthSession } from '@/lib/auth-client';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = getAuthSession();
    if (!session) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    setReady(true);
  }, [pathname, router]);

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-slate-500">Checking access...</div>;

  return <>{children}</>;
}
