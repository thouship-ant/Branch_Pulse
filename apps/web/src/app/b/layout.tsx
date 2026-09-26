import type { ReactNode } from 'react';
import { BranchShell } from '@/components/Shells';

export default function BranchLayout({ children }: { children: ReactNode }) {
  return <BranchShell>{children}</BranchShell>;
}
