import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbScope } from './prisma.service';

/** The company (and database scope) the current request acts for. Set by JwtAuthGuard once the caller is known. */
export interface CompanyStore {
  companyId: string | null;
  isSuper: boolean;
  scope: DbScope;
}

export const companyStore = new AsyncLocalStorage<CompanyStore>();
export const currentCompanyId = (): string | null => companyStore.getStore()?.companyId ?? null;
