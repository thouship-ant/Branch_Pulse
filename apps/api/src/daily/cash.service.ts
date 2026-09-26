import { Injectable } from '@nestjs/common';
import { ApprovalStatus, Prisma } from '@prisma/client';
import { IsArray, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AttachmentsService } from '../attachments/attachments.service';
import { AppException, notFound, staleVersion, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { toDate } from '../common/dates';
import { Dec, D, MONEY_PATTERN, parseMoney, sum, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { Envelope } from '../common/response';
import { RulesService } from '../common/rules.service';
import { SettingsService } from '../common/settings.service';
import { CashComponents, cashVariance, expectedCash, varianceLabel } from './daily.rules';

export class CashTxnDto {
  @IsUUID() locationId: string;
  @IsString() businessDate: string;
  @IsEnum(['OTHER_RECEIPT', 'WITHDRAWAL', 'DEPOSIT_TO_BANK', 'ADJUSTMENT']) type: string;
  @IsOptional() @IsIn([1, -1]) direction?: 1 | -1; // required for ADJUSTMENT
  @Matches(MONEY_PATTERN) amount: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsUUID() clientUuid?: string;
}

export class ReconciliationDto {
  @IsOptional() @Matches(MONEY_PATTERN) actualClosing?: string;
  @IsOptional() @IsObject() denominations?: Record<string, number>;
  @IsOptional() @Matches(MONEY_PATTERN) openingCash?: string; // manager override (audited)
  @IsOptional() @IsString() @MaxLength(300) overrideReason?: string;
  @IsOptional() @IsString() @MaxLength(40) varianceReason?: string;
  @IsOptional() @IsString() @MaxLength(1000) managerExplanation?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attachmentKeys?: string[]; // optional photo(s) explaining the variance
  @IsOptional() @IsInt() version?: number;
}

const DIRECTION: Record<string, 1 | -1> = { OTHER_RECEIPT: 1, WITHDRAWAL: -1, DEPOSIT_TO_BANK: -1 };
const MANUAL_TYPES = ['OTHER_RECEIPT', 'WITHDRAWAL', 'DEPOSIT_TO_BANK', 'ADJUSTMENT'];
const VALID_DENOMS = new Set(['500', '200', '100', '50', '20', '10', '5', '2', '1']);
const MAX_PHOTOS = 3;

/**
 * Where a variance stands (LLD s8 "Cash variance"): no variance needs no approval; a new or changed variance is a
 * DRAFT until the manager sends it (or submits the closing); a rejected one goes back to DRAFT when the manager
 * corrects it. SUBMITTED / APPROVED stay as they are while the figures are unchanged.
 */
export function nextVarianceApproval(
  prev: { variance: Dec | null; variance_approval: ApprovalStatus | null } | null,
  variance: Dec | null,
): ApprovalStatus | null {
  if (!variance || variance.isZero()) return null;
  const changed = !prev || !prev.variance || !prev.variance.equals(variance);
  if (changed || !prev?.variance_approval || prev.variance_approval === 'REJECTED') return 'DRAFT';
  return prev.variance_approval;
}

@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly settings: SettingsService,
    private readonly attachments: AttachmentsService,
  ) {}

  // ------------------------------------------------------------ transactions
  async createTxn(ctx: ReqCtx, dto: CashTxnDto) {
    const date = await this.rules.assertBusinessDate(ctx.user, dto.businessDate);
    const amount = parseMoney(dto.amount, 'amount', { allowZero: false });
    const direction = dto.type === 'ADJUSTMENT' ? dto.direction : DIRECTION[dto.type];
    if (!direction) throw validation('INVALID_DIRECTION', 'Adjustments need a direction (+1 or -1)', 'direction');

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw new AppException(404, 'NOT_FOUND', 'Location not found');
      await this.rules.assertDayEditable(tx, ctx.user, dto.locationId, date);
      if (dto.clientUuid) {
        const dup = await tx.cashTransaction.findUnique({ where: { client_uuid: dto.clientUuid } });
        if (dup) return dup;
      }
      const row = await tx.cashTransaction.create({
        data: {
          location_id: dto.locationId,
          business_date: date,
          txn_type: dto.type as any,
          direction,
          amount,
          description: dto.description,
          client_uuid: dto.clientUuid,
          source: ctx.source,
          created_by: ctx.user.id,
          updated_by: ctx.user.id,
        },
      });
      await this.audit.log(tx, ctx, {
        action: 'CREATE', entityType: 'CASH_TRANSACTION', entityId: row.id, entityCode: `${loc.code} ${dto.type}`,
        locationId: dto.locationId, after: row,
      });
      await this.refreshExisting(tx, ctx, dto.locationId, date);
      return row;
    });
  }

  /** Cancel a hand-entered cash movement (never a delete): only receipts, withdrawals, bank deposits and adjustments. */
  cancelTxn(ctx: ReqCtx, id: string, reason?: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const t = await tx.cashTransaction.findUnique({ where: { id } });
      if (!t) throw notFound('Cash entry');
      if (t.status !== 'ACTIVE' || t.source_type || !MANUAL_TYPES.includes(t.txn_type)) {
        throw new AppException(409, 'INVALID_TRANSITION', 'Only entries typed in by hand can be cancelled; expenses and payments are cancelled from their own record');
      }
      await this.rules.assertDayEditable(tx, ctx.user, t.location_id, t.business_date);
      const after = await tx.cashTransaction.update({ where: { id }, data: { status: 'CANCELLED', updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'CANCEL', entityType: 'CASH_TRANSACTION', entityId: id, locationId: t.location_id, before: t, after, reason });
      await this.refreshExisting(tx, ctx, t.location_id, t.business_date);
      return after;
    });
  }

  listTxns(ctx: ReqCtx, locationId: string, dateStr: string) {
    const date = toDate(dateStr, 'date');
    return this.prisma.runScoped(ctx.user, (tx) =>
      tx.cashTransaction.findMany({
        where: { location_id: locationId, business_date: date },
        orderBy: { created_at: 'asc' },
      }),
    );
  }

  // ------------------------------------------------------------ reconciliation (LLD 9.2)
  /**
   * Compute every component of expected closing cash from the day's ACTIVE cash rows.
   * Cash expenses, purchases, supplier payments and advances all post cash_transactions, so the
   * till total has one source of truth and nothing is double counted.
   */
  async components(tx: Tx, locationId: string, date: Date, openingOverride?: Dec): Promise<CashComponents> {
    const [sales, grouped] = await Promise.all([
      tx.dailySales.findFirst({
        where: { location_id: locationId, business_date: date, status: 'ACTIVE' },
        select: { cash_sales: true },
      }),
      tx.cashTransaction.groupBy({
        by: ['txn_type', 'direction'],
        where: { location_id: locationId, business_date: date, status: 'ACTIVE' },
        _sum: { amount: true },
      }),
    ]);

    const totals: Record<string, Dec> = {};
    for (const g of grouped) totals[`${g.txn_type}:${g.direction}`] = g._sum.amount ?? ZERO;
    const t = (type: string, dir: number) => totals[`${type}:${dir}`] ?? ZERO;

    return {
      opening: openingOverride ?? (await this.defaultOpening(tx, locationId, date)),
      cashSales: sales?.cash_sales ?? ZERO,
      otherReceipts: t('OTHER_RECEIPT', 1).plus(t('ADJUSTMENT', 1)),
      cashExpenses: t('EXPENSE', -1),
      cashPurchases: t('PURCHASE', -1),
      otherCashOut: t('SUPPLIER_PAYMENT', -1).plus(t('ADVANCE_PAYMENT', -1)).plus(t('ADJUSTMENT', -1)),
      withdrawals: t('WITHDRAWAL', -1).plus(t('DEPOSIT_TO_BANK', -1)),
    };
  }

  /** Opening = previous business day's actual closing; first day = the branch's default opening cash. */
  private async defaultOpening(tx: Tx, locationId: string, date: Date): Promise<Dec> {
    const prev = await tx.cashReconciliation.findFirst({
      where: { location_id: locationId, business_date: { lt: date }, actual_closing: { not: null } },
      orderBy: { business_date: 'desc' },
      select: { actual_closing: true },
    });
    if (prev?.actual_closing) return prev.actual_closing;
    const loc = await tx.location.findUnique({ where: { id: locationId }, select: { default_opening_cash: true } });
    return loc?.default_opening_cash ?? ZERO;
  }

  /**
   * After a cash movement changes, a saved count is stale. Recompute the saved row's workings and variance so
   * what is shown (and later approved) always matches the till; a changed variance goes back to DRAFT.
   */
  private async refreshExisting(tx: Tx, ctx: ReqCtx, locationId: string, date: Date) {
    const row = await tx.cashReconciliation.findUnique({ where: { location_id_business_date: { location_id: locationId, business_date: date } } });
    if (!row || row.is_locked) return;
    const c = await this.components(tx, locationId, date, row.opening_cash);
    const expected = expectedCash(c);
    const variance = row.actual_closing ? cashVariance(row.actual_closing, expected) : null;
    const approval = nextVarianceApproval(row, variance);
    await tx.cashReconciliation.update({
      where: { id: row.id },
      data: {
        cash_sales: c.cashSales, other_receipts: c.otherReceipts, cash_expenses: c.cashExpenses, cash_purchases: c.cashPurchases,
        other_cash_out: c.otherCashOut, withdrawals: c.withdrawals, expected_closing: expected, variance, variance_approval: approval,
        ...(approval !== row.variance_approval && approval !== 'APPROVED' ? { approved_by: null, approved_at: null } : {}),
        updated_by: ctx.user.id, version: { increment: 1 },
      },
    });
  }

  /** Live view of the day's reconciliation (saved actual + freshly computed expected). */
  async get(ctx: ReqCtx, locationId: string, dateStr: string) {
    const date = toDate(dateStr, 'date');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const row = await tx.cashReconciliation.findUnique({
        where: { location_id_business_date: { location_id: locationId, business_date: date } },
      });
      return this.view(await this.buildView(tx, locationId, date, row));
    });
  }

  private async buildView(tx: Tx, locationId: string, date: Date, row: Prisma.CashReconciliationGetPayload<object> | null) {
    const c = await this.components(tx, locationId, date, row?.opening_cash);
    const expected = expectedCash(c);
    const actual = row?.actual_closing ?? null;
    const variance = actual ? cashVariance(actual, expected) : null;
    const photos = row
      ? await tx.attachment.findMany({
          where: { entity_type: 'CASH_RECONCILIATION', entity_id: row.id, status: 'ACTIVE' },
          select: { id: true, file_name: true, mime_type: true, size_bytes: true },
        })
      : [];
    const approver = row?.approved_by
      ? await this.prisma.user.findUnique({ where: { id: row.approved_by }, select: { full_name: true } })
      : null;
    return { locationId, row, c, expected, actual, variance, photos, approverName: approver?.full_name ?? null };
  }

  private view(b: {
    locationId: string;
    row: Prisma.CashReconciliationGetPayload<object> | null;
    c: CashComponents;
    expected: Dec;
    actual: Dec | null;
    variance: Dec | null;
    photos?: unknown[];
    approverName?: string | null;
  }) {
    const { row, c, expected, actual, variance } = b;
    return {
      id: row?.id ?? null,
      locationId: b.locationId,
      openingCash: c.opening,
      cashSales: c.cashSales,
      otherReceipts: c.otherReceipts,
      cashExpenses: c.cashExpenses,
      cashPurchases: c.cashPurchases,
      otherCashOut: c.otherCashOut,
      withdrawals: c.withdrawals,
      expectedClosing: expected,
      actualClosing: actual,
      variance,
      varianceLabel: varianceLabel(variance),
      denominations: row?.denomination_json ?? null,
      varianceReason: row?.variance_reason ?? null,
      managerExplanation: row?.manager_explanation ?? null,
      varianceApproval: row?.variance_approval ?? null,
      approvedBy: b.approverName ?? null,
      approvedAt: row?.approved_at ?? null,
      photos: b.photos ?? [],
      isLocked: row?.is_locked ?? false,
      version: row?.version ?? null,
    };
  }

  /** PUT /cash/reconciliation/:locationId/:date - actual cash, denominations, reason, optional photo. Saves as a draft. */
  async save(ctx: ReqCtx, locationId: string, dateStr: string, dto: ReconciliationDto) {
    const date = await this.rules.assertBusinessDate(ctx.user, dateStr, 'date');
    if (dto.denominations) this.assertDenominations(dto.denominations);
    const actual = dto.actualClosing !== undefined ? parseMoney(dto.actualClosing, 'actualClosing') : undefined;
    const override = dto.openingCash !== undefined ? parseMoney(dto.openingCash, 'openingCash') : undefined;
    if (override && !dto.overrideReason?.trim()) {
      throw validation('OVERRIDE_REASON_REQUIRED', 'Give a reason for changing the opening cash', 'overrideReason');
    }
    if ((dto.attachmentKeys?.length ?? 0) > MAX_PHOTOS) throw validation('TOO_MANY_FILES', `At most ${MAX_PHOTOS} photos`, 'attachmentKeys');

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw new AppException(404, 'NOT_FOUND', 'Location not found');
      if (loc.type !== 'BRANCH') throw validation('INVALID_LOCATION', 'Cash reconciliation is for branches', 'locationId');
      await this.rules.assertDayEditable(tx, ctx.user, locationId, date);

      const existing = await tx.cashReconciliation.findUnique({
        where: { location_id_business_date: { location_id: locationId, business_date: date } },
      });
      if (existing && dto.version !== undefined && dto.version !== existing.version) throw staleVersion();

      const c = await this.components(tx, locationId, date, override ?? existing?.opening_cash);
      const expected = expectedCash(c);
      const actualClosing = actual ?? existing?.actual_closing ?? null;
      const variance = actualClosing ? cashVariance(actualClosing, expected) : null;
      const approval = nextVarianceApproval(existing, variance);

      const data = {
        opening_cash: c.opening,
        cash_sales: c.cashSales,
        other_receipts: c.otherReceipts,
        cash_expenses: c.cashExpenses,
        cash_purchases: c.cashPurchases,
        other_cash_out: c.otherCashOut,
        withdrawals: c.withdrawals,
        expected_closing: expected,
        actual_closing: actualClosing,
        variance,
        denomination_json: (dto.denominations ?? existing?.denomination_json ?? Prisma.DbNull) as Prisma.InputJsonValue,
        variance_reason: dto.varianceReason ?? existing?.variance_reason ?? null,
        manager_explanation: dto.managerExplanation ?? existing?.manager_explanation ?? null,
        variance_approval: approval,
        // a decision only stands while the figures it decided are unchanged
        ...(approval === 'APPROVED' ? {} : { approved_by: null, approved_at: null }),
      };

      const row = existing
        ? await tx.cashReconciliation.update({
            where: { id: existing.id },
            data: { ...data, updated_by: ctx.user.id, version: { increment: 1 } },
          })
        : await tx.cashReconciliation.create({
            data: { ...data, location_id: locationId, business_date: date, created_by: ctx.user.id, updated_by: ctx.user.id },
          });

      if (dto.attachmentKeys?.length) {
        const have = await tx.attachment.count({ where: { entity_type: 'CASH_RECONCILIATION', entity_id: row.id, status: 'ACTIVE' } });
        if (have + dto.attachmentKeys.length > MAX_PHOTOS) throw validation('TOO_MANY_FILES', `At most ${MAX_PHOTOS} photos`, 'attachmentKeys');
        await this.attachments.register(tx, ctx, { entityType: 'CASH_RECONCILIATION', entityId: row.id, locationId, keys: dto.attachmentKeys });
      }

      await this.audit.log(tx, ctx, {
        action: existing ? 'UPDATE' : 'CREATE',
        entityType: 'CASH_RECONCILIATION',
        entityId: row.id,
        entityCode: `${loc.code} ${dateStr}`,
        locationId,
        before: existing,
        after: row,
        reason: override ? dto.overrideReason : undefined,
      });

      const warnings = [];
      const threshold = D(await this.settings.getNumber('cash.variance_threshold'));
      if (variance && variance.abs().greaterThan(threshold)) {
        warnings.push({
          code: 'CASH_VARIANCE_LARGE',
          message: `Cash ${variance.isNegative() ? 'shortage' : 'surplus'} of ${variance.abs().toFixed(2)} is above the alert limit`,
        });
      }
      const view = await this.buildView(tx, locationId, date, row);
      return new Envelope(this.view(view), warnings);
    });
  }

  /**
   * POST .../submit - the manager sends a variance for approval. Needs a reason and an explanation (V10);
   * a photo is optional. Submitting the daily closing does the same automatically.
   */
  submitVariance(ctx: ReqCtx, locationId: string, dateStr: string) {
    const date = toDate(dateStr, 'date');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      await this.rules.assertDayEditable(tx, ctx.user, locationId, date);
      const row = await tx.cashReconciliation.findUnique({ where: { location_id_business_date: { location_id: locationId, business_date: date } } });
      if (!row || !row.actual_closing) throw validation('CASH_NOT_COUNTED', 'Count and save the cash first', 'actualClosing');
      // always judge the live till, not a stale saved variance
      await this.refreshExisting(tx, ctx, locationId, date);
      const fresh = (await tx.cashReconciliation.findUnique({ where: { id: row.id } }))!;
      if (!fresh.variance || fresh.variance.isZero()) throw new AppException(409, 'NO_VARIANCE', 'The cash tallies, so there is nothing to approve');
      if (!fresh.variance_reason || (fresh.manager_explanation?.trim().length ?? 0) < 10) {
        throw validation('VARIANCE_REASON_REQUIRED', 'Choose a reason and write an explanation (at least 10 characters)', 'managerExplanation');
      }
      if (fresh.variance_approval === 'SUBMITTED' || fresh.variance_approval === 'APPROVED') {
        throw new AppException(409, 'INVALID_TRANSITION', `The variance is already ${fresh.variance_approval.toLowerCase()}`);
      }
      const after = await tx.cashReconciliation.update({
        where: { id: fresh.id },
        data: { variance_approval: 'SUBMITTED', approved_by: null, approved_at: null, updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.audit.log(tx, ctx, {
        action: 'STATUS_CHANGE', entityType: 'CASH_RECONCILIATION', entityId: fresh.id, locationId,
        before: { variance_approval: fresh.variance_approval }, after: { variance_approval: 'SUBMITTED' }, reason: 'sent for approval',
      });
      return this.view(await this.buildView(tx, locationId, date, after));
    });
  }

  // ------------------------------------------------------------ all branches for one day (owner view)
  async overview(ctx: ReqCtx, dateStr: string) {
    const date = toDate(dateStr, 'date');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const branches = await tx.location.findMany({ where: { type: 'BRANCH', status: 'ACTIVE' }, orderBy: { code: 'asc' } });
      const ids = branches.map((b) => b.id);
      const [rows, closings] = await Promise.all([
        tx.cashReconciliation.findMany({ where: { location_id: { in: ids }, business_date: date } }),
        tx.dailyClosing.findMany({ where: { location_id: { in: ids }, business_date: date }, select: { location_id: true, status: true } }),
      ]);
      const photos = rows.length
        ? await tx.attachment.groupBy({
            by: ['entity_id'],
            where: { entity_type: 'CASH_RECONCILIATION', entity_id: { in: rows.map((r) => r.id) }, status: 'ACTIVE' },
            _count: true,
          })
        : [];

      const out = [];
      for (const b of branches) {
        const row = rows.find((r) => r.location_id === b.id) ?? null;
        const c = await this.components(tx, b.id, date, row?.opening_cash);
        const expected = expectedCash(c);
        const actual = row?.actual_closing ?? null;
        const variance = actual ? cashVariance(actual, expected) : null;
        out.push({
          locationId: b.id, code: b.code, name: b.name, nameTa: b.name_ta,
          reconId: row?.id ?? null,
          openingCash: c.opening, cashSales: c.cashSales, otherReceipts: c.otherReceipts, cashExpenses: c.cashExpenses,
          cashPurchases: c.cashPurchases, otherCashOut: c.otherCashOut, withdrawals: c.withdrawals,
          expectedClosing: expected, actualClosing: actual, variance, varianceLabel: varianceLabel(variance),
          varianceReason: row?.variance_reason ?? null,
          varianceApproval: variance && !variance.isZero() ? (row?.variance_approval ?? 'DRAFT') : null,
          photoCount: photos.find((p) => p.entity_id === row?.id)?._count ?? 0,
          closingStatus: closings.find((x) => x.location_id === b.id)?.status ?? 'PENDING',
        });
      }
      const counted = out.filter((r) => r.actualClosing !== null);
      return {
        date,
        rows: out,
        totals: {
          expected: sum(counted.map((r) => r.expectedClosing)),
          actual: sum(counted.map((r) => r.actualClosing)),
          netVariance: sum(counted.map((r) => r.variance)),
          branchesCounted: counted.length,
          shortages: counted.filter((r) => r.variance!.isNegative()).length,
          surpluses: counted.filter((r) => r.variance!.greaterThan(0)).length,
          awaitingApproval: out.filter((r) => r.varianceApproval === 'SUBMITTED').length,
        },
      };
    });
  }

  private assertDenominations(d: Record<string, number>) {
    for (const [k, v] of Object.entries(d)) {
      if (!VALID_DENOMS.has(k) || !Number.isInteger(v) || v < 0 || v > 100000) {
        throw validation('INVALID_DENOMINATION', `Invalid denomination entry ${k}`, 'denominations');
      }
    }
  }
}
