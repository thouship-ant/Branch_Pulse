import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthUser } from './auth-user';

export type Tx = Prisma.TransactionClient;

/** What the database is told about the caller for row-level security (LLD s7). */
export interface DbScope {
  all: boolean;
  locationIds: string[];
}

export const scopeOf = (u: AuthUser): DbScope => ({ all: u.allLocations, locationIds: u.locationIds });
/** For background jobs that legitimately span every branch (e.g. nightly closing creation). */
export const SYSTEM_SCOPE: DbScope = { all: true, locationIds: [] };

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
   * set_config(..., true)). Every read/write of branch-owned data must go through this so PostgreSQL
   * enforces branch isolation even if application-level scoping has a bug. Unset variables deny.
   */
  runScoped<T>(scope: DbScope | AuthUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const s: DbScope = 'username' in scope ? scopeOf(scope) : scope;
    return this.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.all_locations', ${s.all ? 'true' : 'false'}, true),
                                  set_config('app.allowed_locations', ${s.locationIds.join(',')}, true)`;
        return fn(tx);
      },
      { maxWait: 5000, timeout: 20000 },
    );
  }
}
