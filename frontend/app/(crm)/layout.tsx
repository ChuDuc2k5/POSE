import type { ReactNode } from 'react';
import { readCrmSession } from '@/lib/crm-session';
import { readProfile } from '@/lib/page-profile';
import { CrmWorkspace } from '@/components/crm/crm-workspace';
export default async function CrmLayout({ children }: { children: ReactNode }) {
  const session = await readCrmSession();
  // Pages preserve the correct destination when login or token refresh is needed.
  if (!session || (session.role !== 'Admin' && session.role !== 'Sales')) return children;
  const { name } = await readProfile();
  return (
    <CrmWorkspace
      key={session.user.id + ':' + session.role}
      identity={{ userId: session.user.id, role: session.role, name }}
    >
      {children}
    </CrmWorkspace>
  );
}
