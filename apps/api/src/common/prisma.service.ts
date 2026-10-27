import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthUser } from './auth-user';
import { companyStore } from './company-context';

export type Tx = Prisma.TransactionClient;

/** What the database is told about the caller for row-level security (LLD s7, plus the company boundary). */
export interface DbScope {
  all: boolean;
  locationIds: string[];
  /** The caller's company: every company-owned row is filtered to it, and new rows default to it. */
  companyId?: string | null;
  /** Super Admin: sees every company (and no branch work happens in this mode). */
  isSuper?: boolean;
}

export const scopeOf = (u: AuthUser): DbScope => ({ all: u.allLocations, locationIds: u.locationIds, companyId: u.companyId, isSuper: u.isSuper });
/** Scope of one company's data, for work done on that company's behalf (e.g. reading its settings). */
export const companyScope = (companyId: string): DbScope => ({ all: true, locationIds: [], companyId });
/** For background jobs that legitimately span every branch of every company (e.g. nightly closing creation). */
export const SYSTEM_SCOPE: DbScope = { all: true, locationIds: [], isSuper: true };

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run `fn` in one transaction with the RLS session variables set (`SET LOCAL` semantics via
   * set_config(..., true)). Every read/write of branch- or company-owned data must go through this so PostgreSQL
   * enforces isolation even if application-level scoping has a bug. Unset variables deny.
   */
  runScoped<T>(scope: DbScope | AuthUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const s: DbScope = 'username' in scope ? scopeOf(scope) : scope;
    return this.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.all_locations', ${s.all ? 'true' : 'false'}, true),
                                  set_config('app.allowed_locations', ${s.locationIds.join(',')}, true),
                                  set_config('app.company_id', ${s.companyId ?? ''}, true),
                                  set_config('app.super', ${s.isSuper ? 'true' : 'false'}, true)`;
        return fn(tx);
      },
      { maxWait: 5000, timeout: 20000 },
    );
  }

  /** runScoped for the caller of the current request (taken from the request context set by JwtAuthGuard). */
  runCurrent<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const st = companyStore.getStore();
    if (!st) throw new Error('runCurrent used outside an authenticated request; pass an explicit scope to runScoped');
    return this.runScoped(st.scope, fn);
  }

  /**
   * Sign-in, token refresh and session lookups happen before the caller's company is known, so they may read
   * users and roles across companies. Use it only for those lookups (never for business data).
   */
  runAuth<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.auth', 'true', true)`;
        return fn(tx);
      },
      { maxWait: 5000, timeout: 20000 },
    );
  }
}
