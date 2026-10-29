import type { ReactNode } from 'react';
export function AdminWorkspaceShell({ children }: { section?: string; detail?: string; children: ReactNode }) {
  return <>{children}</>;
}
