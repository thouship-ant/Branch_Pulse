import type { ReactNode } from 'react';
import { OfficeShell } from '@/components/Shells';

export default function OfficeLayout({ children }: { children: ReactNode }) {
  return <OfficeShell>{children}</OfficeShell>;
}
