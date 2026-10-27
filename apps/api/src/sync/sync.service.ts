import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested,
} from 'class-validator';
import { AppException, forbiddenLocation } from '../common/app-exception';
import { can, canAccessLocation, ReqCtx } from '../common/auth-user';
import { toDate } from '../common/dates';
import { PrismaService } from '../common/prisma.service';
import { Envelope } from '../common/response';
import { SettingsService } from '../common/settings.service';
import { CashService } from '../daily/cash.service';
import { SalesService } from '../daily/sales.service';
import { ExpensesService } from '../expenses/expenses.service';
import { WastageService } from '../inventory/wastage.service';
import { PurchasesService } from '../purchases/purchases.service';

export class SyncOperationDto {
  @IsUUID() clientUuid: string;
  @IsString() @MaxLength(30) entityType: string;
  @IsIn(['CREATE', 'UPDATE']) op: 'CREATE' | 'UPDATE';
  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsInt() baseVersion?: number;
  @IsOptional() @IsString() clientCreatedAt?: string;
  @IsObject() payload: Record<string, any>;
}

export class SyncBatchDto {
  @IsString() @MaxLength(64) deviceId: string;
  @IsOptional() @IsInt() bootstrapVersion?: number;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SyncOperationDto) operations: SyncOperationDto[];
}

type Result = 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED';
interface OpOutcome {
  clientUuid: string;
  result: Result;
  entityId?: string;
  version?: number;
  warnings?: unknown[];
  server?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

/**
 * Offline outbox endpoint (LLD s15). Each operation is applied through the normal domain service, so
 * every posting, validation, alert and audit rule is identical to an online entry. Exactly-once comes
 * from sync_operations (by client_uuid) plus the unique client_uuid on the entity tables.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly expenses: ExpensesService,
    private readonly sales: SalesService,
    private readonly cash: CashService,
    private readonly purchases: PurchasesService,
    private readonly wastage: WastageService,
  ) {}

  async batch(ctx: ReqCtx, dto: SyncBatchDto) {
    const results: OpOutcome[] = [];
    for (const op of dto.operations) results.push(await this.applyOne(ctx, dto.deviceId, op));

    const current = await this.bootstrapVersion();
    return { results, mastersChanged: dto.bootstrapVersion !== undefined && dto.bootstrapVersion !== current, bootstrapVersion: current };
  }

  private async applyOne(ctx: ReqCtx, deviceId: string, op: SyncOperationDto): Promise<OpOutcome> {
    // 1. already processed? return the stored response as DUPLICATE
    const seen = await this.prisma.syncOperation.findUnique({ where: { client_uuid: op.clientUuid } });
    if (seen) {
      if (seen.user_id !== ctx.user.id) return this.reject(op, 'FORBIDDEN', 'This operation belongs to another user');
      return { ...(seen.response as object), clientUuid: op.clientUuid, result: 'DUPLICATE' } as OpOutcome;
    }

    let outcome: OpOutcome;
    try {
      outcome = await this.dispatch({ ...ctx, source: 'PWA_OFFLINE', deviceId }, op);
    } catch (e) {
      outcome = await this.fromError(ctx, op, e);
    }

    // 6. remember the outcome so replays are answered without re-applying
    if (outcome.result === 'APPLIED' || outcome.result === 'REJECTED') {
      await this.prisma.syncOperation
        .create({
          data: {
            client_uuid: op.clientUuid, user_id: ctx.user.id, device_id: deviceId, entity_type: op.entityType,
            entity_id: outcome.entityId, result: outcome.result, response: outcome as unknown as Prisma.InputJsonValue,
          },
        })
        .catch((e) => {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        });
    }
    return outcome;
  }

  private need(ctx: ReqCtx, perm: string) {
    if (!can(ctx.user, perm)) throw new AppException(403, 'FORBIDDEN', 'You do not have permission for this action', { missing: [perm] });
  }

  private async dispatch(ctx: ReqCtx, op: SyncOperationDto): Promise<OpOutcome> {
    const p = op.payload;
    const locationId: string | undefined = p.locationId;
    if (!locationId) throw new AppException(422, 'VALIDATION_ERROR', 'payload.locationId is required');
    if (!canAccessLocation(ctx.user, locationId)) throw forbiddenLocation();

    switch (op.entityType) {
      case 'EXPENSE': {
        if (op.op !== 'CREATE') throw new AppException(422, 'UNSUPPORTED_OPERATION', 'Expenses sync as CREATE only');
        this.need(ctx, 'expense:create');
        const env = await this.expenses.create(ctx, { ...p, clientUuid: op.clientUuid, clientCreatedAt: op.clientCreatedAt } as any);
        return this.applied(op, env);
      }
      case 'WASTAGE': {
        if (op.op !== 'CREATE') throw new AppException(422, 'UNSUPPORTED_OPERATION', 'Wastage syncs as CREATE only');
        this.need(ctx, 'wastage:create');
        const env = await this.wastage.create(ctx, { ...p, clientUuid: op.clientUuid, clientCreatedAt: op.clientCreatedAt } as any);
        return this.applied(op, env);
      }
      case 'PURCHASE': {
        if (op.op !== 'CREATE') throw new AppException(422, 'UNSUPPORTED_OPERATION', 'Purchases sync as CREATE only');
        this.need(ctx, 'purchase:create');
        const env = await this.purchases.create(ctx, { ...p, clientUuid: op.clientUuid, clientCreatedAt: op.clientCreatedAt } as any);
        return this.applied(op, env);
      }
      case 'DAILY_SALES': {
        this.need(ctx, 'sales:enter');
        const existing = await this.sales.get(ctx, locationId, p.businessDate);
        // a second device entering the same day is a conflict, never a silent overwrite
        if (existing && existing.client_uuid !== op.clientUuid && (op.op === 'CREATE' || op.baseVersion === undefined)) {
          return { clientUuid: op.clientUuid, result: 'CONFLICT', entityId: existing.id, server: existing };
        }
        const env = await this.sales.upsert(ctx, locationId, p.businessDate, {
          ...p, version: op.baseVersion ?? existing?.version, clientUuid: op.clientUuid, clientCreatedAt: op.clientCreatedAt,
        } as any);
        return this.applied(op, env);
      }
      case 'CASH_RECONCILIATION': {
        this.need(ctx, 'cash:enter');
        const env = await this.cash.save(ctx, locationId, p.businessDate, { ...p, version: op.baseVersion } as any);
        return this.applied(op, env);
      }
      case 'CASH_TRANSACTION': {
        this.need(ctx, 'cash:enter');
        const row = await this.cash.createTxn(ctx, { ...p, clientUuid: op.clientUuid } as any);
        return { clientUuid: op.clientUuid, result: 'APPLIED', entityId: row.id, version: row.version };
      }
      default:
        throw new AppException(422, 'UNSUPPORTED_ENTITY', `${op.entityType} cannot be synced yet`);
    }
  }

  private applied(op: SyncOperationDto, env: Envelope<any>): OpOutcome {
    return {
      clientUuid: op.clientUuid, result: 'APPLIED', entityId: env.data?.id, version: env.data?.version, warnings: env.warnings,
    };
  }

  private reject(op: SyncOperationDto, code: string, message: string, details?: unknown): OpOutcome {
    return { clientUuid: op.clientUuid, result: 'REJECTED', error: { code, message, details } };
  }

  /** Map a domain error to the protocol's per-operation results; unexpected errors fail the batch (client retries). */
  private async fromError(ctx: ReqCtx, op: SyncOperationDto, e: unknown): Promise<OpOutcome> {
    if (e instanceof AppException) {
      if (e.code === 'STALE_VERSION') {
        return { clientUuid: op.clientUuid, result: 'CONFLICT', error: { code: e.code, message: e.message }, server: await this.serverCopy(ctx, op) };
      }
      return this.reject(op, e.code, e.message, e.details);
    }
    const text = (e as Error)?.message ?? '';
    if (text.includes('DAY_LOCKED')) return this.reject(op, 'DAY_LOCKED', 'Day closed - ask the owner to reopen it');
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // unique client_uuid hit: the entity exists from an earlier attempt -> treat as duplicate
      return { clientUuid: op.clientUuid, result: 'DUPLICATE' };
    }
    throw e;
  }

  private async serverCopy(ctx: ReqCtx, op: SyncOperationDto) {
    const p = op.payload;
    if (op.entityType === 'DAILY_SALES' && p.locationId && p.businessDate) return this.sales.get(ctx, p.locationId, p.businessDate);
    return null;
  }

  // ------------------------------------------------------------ bootstrap
  /** Cheap change marker for master data: newest updated_at across the offline masters. */
  private async bootstrapVersion(): Promise<number> {
    const [c, l, i, s] = await this.prisma.runCurrent((tx) => Promise.all([
      tx.expenseCategory.aggregate({ _max: { updated_at: true } }),
      tx.location.aggregate({ _max: { updated_at: true } }),
      tx.inventoryItem.aggregate({ _max: { updated_at: true } }),
      tx.setting.aggregate({ _max: { updated_at: true } }),
    ]));
    const t = Math.max(...[c, l, i, s].map((x) => x._max.updated_at?.getTime() ?? 0));
    return Math.floor(t / 1000);
  }

  /** Master-data snapshot the PWA caches for offline entry (categories, items, units, suppliers, thresholds). */
  async bootstrap(ctx: ReqCtx, locationId?: string) {
    if (locationId && !canAccessLocation(ctx.user, locationId)) throw forbiddenLocation();
    const [categories, units, items, suppliers, location, version] = await this.prisma.runScoped(ctx.user, (tx) => Promise.all([
      tx.expenseCategory.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ sort_order: 'asc' }, { name_en: 'asc' }] }),
      tx.unit.findMany(),
      tx.inventoryItem.findMany({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } }),
      tx.supplier.findMany({ where: { status: 'ACTIVE' }, select: { id: true, code: true, name: true, phone: true, payment_terms_days: true } }),
      locationId ? tx.location.findUnique({ where: { id: locationId } }) : null,
      this.bootstrapVersion(),
    ]));
    const s = this.settings;
    return {
      bootstrapVersion: version,
      serverTime: new Date().toISOString(),
      location,
      categories,
      units,
      items,
      suppliers,
      rules: {
        receiptAbove: await s.get('expense.receipt_above'),
        backdateDays: await s.get('entry.backdate_days'),
        salesMismatchTolerance: await s.get('sales.mismatch_tolerance'),
        cashVarianceThreshold: await s.get('cash.variance_threshold'),
        closingCutoff: await s.get('closing.cutoff_time'),
      },
    };
  }
}

export const isoDate = (d: string) => toDate(d);
