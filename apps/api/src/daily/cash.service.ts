import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AppException, staleVersion, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { toDate } from '../common/dates';
import { Dec, D, MONEY_PATTERN, parseMoney, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { RulesService } from '../common/rules.service';
import { SettingsService } from '../common/settings.service';
import { Envelope } from '../common/response';
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
  @IsOptional() @IsInt() version?: number;
}

const DIRECTION: Record<string, 1 | -1> = { OTHER_RECEIPT: 1, WITHDRAWAL: -1, DEPOSIT_TO_BANK: -1 };
const VALID_DENOMS = new Set(['500', '200', '100', '50', '20', '10', '5', '2', '1']);

@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly settings: SettingsService,
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
      return row;
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
    for (const g of grouped) {
      const key = `${g.txn_type}:${g.direction}`;
      totals[key] = g._sum.amount ?? ZERO;
    }
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
    return { locationId, row, c, expected, actual, variance };
  }

  private view(b: {
    locationId: string;
    row: Prisma.CashReconciliationGetPayload<object> | null;
    c: CashComponents;
    expected: Dec;
    actual: Dec | null;
    variance: Dec | null;
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
      isLocked: row?.is_locked ?? false,
      version: row?.version ?? null,
    };
  }

  /** PUT /cash/reconciliation/:locationId/:date - actual cash, denominations, reason. */
  async save(ctx: ReqCtx, locationId: string, dateStr: string, dto: ReconciliationDto) {
    const date = await this.rules.assertBusinessDate(ctx.user, dateStr, 'date');
    if (dto.denominations) this.assertDenominations(dto.denominations);
    const actual = dto.actualClosing !== undefined ? parseMoney(dto.actualClosing, 'actualClosing') : undefined;
    const override = dto.openingCash !== undefined ? parseMoney(dto.openingCash, 'openingCash') : undefined;
    if (override && !dto.overrideReason?.trim()) {
      throw validation('OVERRIDE_REASON_REQUIRED', 'Give a reason for changing the opening cash', 'overrideReason');
    }

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

      let approval = existing?.variance_approval ?? null;
      if (variance && !variance.isZero()) {
        // a new or changed variance needs (re)approval
        if (!existing || !existing.variance?.equals(variance) || approval !== 'SUBMITTED') approval = 'SUBMITTED';
      } else {
        approval = null;
      }

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
        approved_by: approval === 'SUBMITTED' ? null : existing?.approved_by ?? null,
        approved_at: approval === 'SUBMITTED' ? null : existing?.approved_at ?? null,
      };

      const row = existing
        ? await tx.cashReconciliation.update({
            where: { id: existing.id },
            data: { ...data, updated_by: ctx.user.id, version: { increment: 1 } },
          })
        : await tx.cashReconciliation.create({
            data: {
              ...data,
              location_id: locationId,
              business_date: date,
              created_by: ctx.user.id,
              updated_by: ctx.user.id,
            },
          });

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
      return new Envelope(this.view({ locationId, row, c, expected, actual: actualClosing, variance }), warnings);
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
