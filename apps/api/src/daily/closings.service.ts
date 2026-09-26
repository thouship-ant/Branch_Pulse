import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClosingStatus, Prisma } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { toDate, todayIST } from '../common/dates';
import { D, ZERO } from '../common/money';
import { PrismaService, SYSTEM_SCOPE, Tx } from '../common/prisma.service';
import { RulesService } from '../common/rules.service';
import { SettingsService } from '../common/settings.service';
import { CashService } from './cash.service';
import { assertClosingTransition, cashVariance, evaluatePrechecks, expectedCash } from './daily.rules';

export class SubmitClosingDto {
  @IsOptional() @IsString() @MaxLength(1000) stockNotes?: string;
  @IsOptional() @IsString() @MaxLength(1000) remarks?: string;
}

export class ReviewDto {
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

const OPEN_STATES: ClosingStatus[] = ['PENDING', 'REJECTED', 'REOPENED'];

@Injectable()
export class ClosingsService {
  private readonly log = new Logger(ClosingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly settings: SettingsService,
    private readonly cash: CashService,
  ) {}

  // ------------------------------------------------------------ scheduled creation
  /** 00:05 IST: every active branch gets a PENDING closing for the day, so "not submitted" is a simple query. */
  @Cron('5 0 * * *', { timeZone: 'Asia/Kolkata' })
  async createTodaysClosings() {
    const date = toDate(todayIST());
    const n = await this.prisma.runScoped(SYSTEM_SCOPE, async (tx) => {
      const branches = await tx.location.findMany({ where: { type: 'BRANCH', status: 'ACTIVE' }, select: { id: true } });
      const res = await tx.dailyClosing.createMany({
        data: branches.map((b) => ({ location_id: b.id, business_date: date })),
        skipDuplicates: true,
      });
      return res.count;
    });
    this.log.log(`Created ${n} PENDING closings for ${todayIST()}`);
  }

  private async ensureClosing(tx: Tx, locationId: string, date: Date) {
    const found = await tx.dailyClosing.findUnique({
      where: { location_id_business_date: { location_id: locationId, business_date: date } },
    });
    if (found) return found;
    const loc = await tx.location.findUnique({ where: { id: locationId } });
    if (!loc || loc.status !== 'ACTIVE') throw notFound('Location');
    if (loc.type !== 'BRANCH') throw validation('INVALID_LOCATION', 'Daily closing applies to branches', 'locationId');
    return tx.dailyClosing.create({ data: { location_id: locationId, business_date: date } });
  }

  // ------------------------------------------------------------ reads
  /** Closing board: one row per in-scope active branch for the date. */
  async board(ctx: ReqCtx, dateStr: string, status?: string) {
    const date = toDate(dateStr, 'date');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const branches = await tx.location.findMany({
        where: { type: 'BRANCH', status: 'ACTIVE' },
        orderBy: { code: 'asc' },
      });
      // rows are created lazily for today/past dates so the board is complete even if the cron missed
      if (date.getTime() <= toDate(todayIST()).getTime() && branches.length) {
        await tx.dailyClosing.createMany({
          data: branches.map((b) => ({ location_id: b.id, business_date: date })),
          skipDuplicates: true,
        });
      }
      const ids = branches.map((b) => b.id);
      const [closings, sales, recons] = await Promise.all([
        tx.dailyClosing.findMany({ where: { location_id: { in: ids }, business_date: date } }),
        tx.dailySales.findMany({ where: { location_id: { in: ids }, business_date: date, status: 'ACTIVE' } }),
        tx.cashReconciliation.findMany({ where: { location_id: { in: ids }, business_date: date } }),
      ]);
      const rows = branches.map((b) => {
        const c = closings.find((x) => x.location_id === b.id);
        const s = sales.find((x) => x.location_id === b.id);
        const r = recons.find((x) => x.location_id === b.id);
        return {
          closingId: c?.id ?? null,
          locationId: b.id,
          locationCode: b.code,
          locationName: b.name,
          locationNameTa: b.name_ta,
          businessDate: date,
          status: c?.status ?? 'PENDING',
          totalSales: c?.total_sales ?? s?.total_sales ?? null,
          cashVariance: c?.cash_variance ?? r?.variance ?? null,
          varianceApproval: r?.variance_approval ?? null,
          submittedAt: c?.submitted_at ?? null,
          reopenCount: c?.reopen_count ?? 0,
        };
      });
      return status ? rows.filter((r) => r.status === status) : rows;
    });
  }

  /** Everything the closing screens need: totals, cash workings, pre-check list, current status. */
  async screen(ctx: ReqCtx, locationId: string, dateStr: string) {
    const date = toDate(dateStr, 'date');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const closing = await this.ensureClosing(tx, locationId, date);
      const g = await this.gather(tx, locationId, date, false);
      const tolerance = D(await this.settings.getNumber('sales.mismatch_tolerance'));
      const prechecks = evaluatePrechecks({
        sales: g.sales ? { mismatch: g.sales.mismatch_amount, remarks: g.sales.remarks } : null,
        recon: g.recon
          ? {
              actualClosing: g.recon.actual_closing,
              variance: g.variance,
              reason: g.recon.variance_reason,
              explanation: g.recon.manager_explanation,
            }
          : null,
        tolerance,
      });
      return {
        closing,
        sales: g.sales,
        cash: await this.cash.get(ctx, locationId, dateStr).catch(() => null),
        totals: g.totals,
        pending: g.pending,
        prechecks,
        canSubmit: prechecks.every((p) => p.ok) && OPEN_STATES.includes(closing.status),
      };
    });
  }

  async events(ctx: ReqCtx, closingId: string) {
    return this.prisma.runScoped(ctx.user, (tx) =>
      tx.dailyClosingEvent.findMany({ where: { daily_closing_id: closingId }, orderBy: { created_at: 'asc' } }),
    );
  }

  // ------------------------------------------------------------ helpers
  /** Collect the day's sales, refreshed cash reconciliation and roll-up totals. */
  private async gather(tx: Tx, locationId: string, date: Date, persistRecon: boolean, ctx?: ReqCtx) {
    const [sales, recon] = await Promise.all([
      tx.dailySales.findFirst({ where: { location_id: locationId, business_date: date, status: 'ACTIVE' } }),
      tx.cashReconciliation.findUnique({
        where: { location_id_business_date: { location_id: locationId, business_date: date } },
      }),
    ]);

    // expected cash is always recomputed: expenses may have been added after the count was saved
    let variance: Prisma.Decimal | null = null;
    let expected: Prisma.Decimal | null = null;
    let freshRecon = recon;
    if (recon) {
      const c = await this.cash.components(tx, locationId, date, recon.opening_cash);
      expected = expectedCash(c);
      variance = recon.actual_closing ? cashVariance(recon.actual_closing, expected) : null;
      if (persistRecon && ctx && (!recon.expected_closing.equals(expected) || !(recon.variance ?? ZERO).equals(variance ?? ZERO))) {
        const needsApproval = variance && !variance.isZero();
        freshRecon = await tx.cashReconciliation.update({
          where: { id: recon.id },
          data: {
            cash_sales: c.cashSales, other_receipts: c.otherReceipts, cash_expenses: c.cashExpenses,
            cash_purchases: c.cashPurchases, other_cash_out: c.otherCashOut, withdrawals: c.withdrawals,
            expected_closing: expected, variance,
            variance_approval: needsApproval ? 'SUBMITTED' : null,
            updated_by: ctx.user.id, version: { increment: 1 },
          },
        });
      }
    }

    const live = { location_id: locationId, business_date: date, status: 'ACTIVE' as const };
    const inFlight = { in: ['SUBMITTED', 'APPROVED'] as Array<'SUBMITTED' | 'APPROVED'> };
    const [exp, pur, was, pendingExp, pendingPur, pendingWas] = await Promise.all([
      tx.expense.aggregate({ where: { ...live, approval_status: inFlight }, _sum: { amount: true }, _count: true }),
      tx.purchase.aggregate({ where: { ...live, approval_status: inFlight }, _sum: { total_amount: true }, _count: true }),
      tx.wastage.aggregate({ where: { ...live, approval_status: inFlight }, _sum: { estimated_value: true }, _count: true }),
      tx.expense.count({ where: { ...live, approval_status: 'SUBMITTED' } }),
      tx.purchase.count({ where: { ...live, approval_status: 'SUBMITTED' } }),
      tx.wastage.count({ where: { ...live, approval_status: 'SUBMITTED' } }),
    ]);

    return {
      sales,
      recon: freshRecon,
      expected,
      variance,
      totals: {
        totalExpenses: exp._sum.amount ?? ZERO,
        expenseCount: exp._count,
        totalPurchases: pur._sum.total_amount ?? ZERO,
        purchaseCount: pur._count,
        totalWastageValue: was._sum.estimated_value ?? ZERO,
        wastageCount: was._count,
      },
      pending: { expenses: pendingExp, purchases: pendingPur, wastage: pendingWas },
    };
  }

  private async writeEvent(tx: Tx, closingId: string, from: ClosingStatus | null, to: ClosingStatus, ctx: ReqCtx, comment?: string, snapshot?: unknown) {
    await tx.dailyClosingEvent.create({
      data: {
        daily_closing_id: closingId,
        from_status: from,
        to_status: to,
        actor_id: ctx.user.id,
        comment: comment ?? null,
        snapshot: (snapshot ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });
  }

  private async load(tx: Tx, closingId: string) {
    const c = await tx.dailyClosing.findUnique({ where: { id: closingId } });
    if (!c) throw notFound('Closing');
    return c;
  }

  // ------------------------------------------------------------ transitions
  /** PENDING/REJECTED/REOPENED -> SUBMITTED. Runs pre-checks, freezes snapshot totals. */
  async submit(ctx: ReqCtx, closingId: string, dto: SubmitClosingDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const closing = await this.load(tx, closingId);
      assertClosingTransition(closing.status, 'SUBMITTED');

      const g = await this.gather(tx, closing.location_id, closing.business_date, true, ctx);
      const tolerance = D(await this.settings.getNumber('sales.mismatch_tolerance'));
      const checks = evaluatePrechecks({
        sales: g.sales ? { mismatch: g.sales.mismatch_amount, remarks: g.sales.remarks } : null,
        recon: g.recon
          ? {
              actualClosing: g.recon.actual_closing,
              variance: g.recon.variance,
              reason: g.recon.variance_reason,
              explanation: g.recon.manager_explanation,
            }
          : null,
        tolerance,
      });
      const failed = checks.filter((c) => !c.ok);
      if (failed.length) {
        throw new AppException(422, 'CLOSING_PRECHECK_FAILED', 'Fix the items below before submitting', failed);
      }

      const snapshot = {
        total_sales: g.sales!.total_sales,
        cash_sales: g.sales!.cash_sales,
        upi_sales: g.sales!.upi_sales,
        card_sales: g.sales!.card_sales,
        total_expenses: g.totals.totalExpenses,
        total_purchases: g.totals.totalPurchases,
        total_wastage_value: g.totals.totalWastageValue,
        expected_cash: g.recon!.expected_closing,
        actual_cash: g.recon!.actual_closing,
        cash_variance: g.recon!.variance,
      };
      const after = await tx.dailyClosing.update({
        where: { id: closing.id },
        data: {
          ...snapshot,
          status: 'SUBMITTED',
          daily_sales_id: g.sales!.id,
          cash_reconciliation_id: g.recon!.id,
          stock_notes: dto.stockNotes ?? null,
          remarks: dto.remarks ?? null,
          submitted_by: ctx.user.id,
          submitted_at: new Date(),
          reviewed_by: null,
          reviewed_at: null,
          review_comment: null,
          updated_by: ctx.user.id,
          version: { increment: 1 },
        },
      });
      await this.writeEvent(tx, closing.id, closing.status, 'SUBMITTED', ctx, dto.remarks, snapshot);
      await this.audit.log(tx, ctx, {
        action: 'STATUS_CHANGE', entityType: 'DAILY_CLOSING', entityId: closing.id,
        locationId: closing.location_id, before: { status: closing.status }, after: { status: 'SUBMITTED', ...snapshot },
      });
      return after;
    });
  }

  /** SUBMITTED -> APPROVED. Locks every record of the branch-day. */
  async approve(ctx: ReqCtx, closingId: string, dto: ReviewDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const closing = await this.load(tx, closingId);
      assertClosingTransition(closing.status, 'APPROVED');

      const g = await this.gather(tx, closing.location_id, closing.business_date, false);
      const { expenses, purchases, wastage } = g.pending;
      if (expenses + purchases + wastage > 0) {
        throw new AppException(
          409,
          'CLOSING_HAS_PENDING_ITEMS',
          'Approve or reject the pending expenses / purchases / wastage of this day first',
          g.pending,
        );
      }

      // The numbers the manager submitted must still be the live numbers (e.g. an expense was reversed
      // or sales were edited after submission). Otherwise the owner would approve a stale snapshot.
      const changed: string[] = [];
      if (g.sales && closing.total_sales && !g.sales.total_sales.equals(closing.total_sales)) changed.push('totalSales');
      if (g.expected && closing.expected_cash && !g.expected.equals(closing.expected_cash)) changed.push('expectedCash');
      if (changed.length) {
        throw new AppException(
          409,
          'CLOSING_FIGURES_CHANGED',
          'Figures changed after submission. Reject the closing so the branch can recount and resubmit.',
          { changed },
        );
      }

      // approving the closing also settles an outstanding cash variance, within the approver's limit
      const recon = g.recon;
      if (recon?.variance && !recon.variance.isZero() && recon.variance_approval === 'SUBMITTED') {
        await this.assertVarianceLimit(tx, ctx, recon.variance);
        await tx.cashReconciliation.update({
          where: { id: recon.id },
          data: { variance_approval: 'APPROVED', approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } },
        });
      }

      // lock children FIRST (the lock trigger only fires once the closing itself is APPROVED)
      if (g.sales) await tx.dailySales.update({ where: { id: g.sales.id }, data: { is_locked: true } });
      if (recon) await tx.cashReconciliation.update({ where: { id: recon.id }, data: { is_locked: true } });

      const after = await tx.dailyClosing.update({
        where: { id: closing.id },
        data: {
          status: 'APPROVED',
          reviewed_by: ctx.user.id,
          reviewed_at: new Date(),
          review_comment: dto.comment ?? null,
          updated_by: ctx.user.id,
          version: { increment: 1 },
        },
      });
      await this.writeEvent(tx, closing.id, closing.status, 'APPROVED', ctx, dto.comment);
      await this.audit.log(tx, ctx, {
        action: 'APPROVE', entityType: 'DAILY_CLOSING', entityId: closing.id, locationId: closing.location_id,
        before: { status: closing.status }, after: { status: 'APPROVED' }, reason: dto.comment,
      });
      return after;
    });
  }

  /** SUBMITTED -> REJECTED (comment mandatory). */
  async reject(ctx: ReqCtx, closingId: string, dto: ReviewDto) {
    if (!dto.comment?.trim()) throw validation('COMMENT_REQUIRED', 'Say what needs to be fixed', 'comment');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const closing = await this.load(tx, closingId);
      assertClosingTransition(closing.status, 'REJECTED');
      const after = await tx.dailyClosing.update({
        where: { id: closing.id },
        data: { status: 'REJECTED', reviewed_by: ctx.user.id, reviewed_at: new Date(), review_comment: dto.comment, updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.writeEvent(tx, closing.id, closing.status, 'REJECTED', ctx, dto.comment);
      await this.audit.log(tx, ctx, {
        action: 'REJECT', entityType: 'DAILY_CLOSING', entityId: closing.id, locationId: closing.location_id,
        before: { status: closing.status }, after: { status: 'REJECTED' }, reason: dto.comment,
      });
      return after;
    });
  }

  /** APPROVED -> REOPENED (owner only; reason mandatory). Unlocks the branch-day. */
  async reopen(ctx: ReqCtx, closingId: string, dto: ReviewDto) {
    if (!dto.comment?.trim()) throw validation('REASON_REQUIRED', 'Give a reason for reopening', 'comment');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const closing = await this.load(tx, closingId);
      assertClosingTransition(closing.status, 'REOPENED');

      // status first: it removes the lock the trigger checks, then children can be unlocked
      const after = await tx.dailyClosing.update({
        where: { id: closing.id },
        data: {
          status: 'REOPENED',
          reopen_count: { increment: 1 },
          review_comment: dto.comment,
          reviewed_by: ctx.user.id,
          reviewed_at: new Date(),
          updated_by: ctx.user.id,
          version: { increment: 1 },
        },
      });
      await tx.dailySales.updateMany({
        where: { location_id: closing.location_id, business_date: closing.business_date },
        data: { is_locked: false },
      });
      await tx.cashReconciliation.updateMany({
        where: { location_id: closing.location_id, business_date: closing.business_date },
        data: { is_locked: false },
      });
      await this.writeEvent(tx, closing.id, closing.status, 'REOPENED', ctx, dto.comment);
      await this.audit.log(tx, ctx, {
        action: 'REOPEN', entityType: 'DAILY_CLOSING', entityId: closing.id, locationId: closing.location_id,
        before: { status: closing.status }, after: { status: 'REOPENED' }, reason: dto.comment,
      });
      return after;
    });
  }

  // ------------------------------------------------------------ cash variance approval (LLD s8)
  private async assertVarianceLimit(tx: Tx, ctx: ReqCtx, variance: Prisma.Decimal) {
    const limit = await this.rules.approvalLimit(tx, ctx.user, 'CASH_VARIANCE');
    if (!this.rules.withinLimit(limit, variance.abs())) {
      throw new AppException(403, 'APPROVAL_LIMIT_EXCEEDED', 'This variance is above your approval limit; ask the owner');
    }
  }

  async approveVariance(ctx: ReqCtx, reconId: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const r = await tx.cashReconciliation.findUnique({ where: { id: reconId } });
      if (!r) throw notFound('Cash reconciliation');
      if (!r.variance || r.variance.isZero() || r.variance_approval !== 'SUBMITTED') {
        throw new AppException(409, 'INVALID_TRANSITION', 'There is no variance waiting for approval');
      }
      await this.assertVarianceLimit(tx, ctx, r.variance);
      const after = await tx.cashReconciliation.update({
        where: { id: r.id },
        data: { variance_approval: 'APPROVED', approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.audit.log(tx, ctx, {
        action: 'APPROVE', entityType: 'CASH_RECONCILIATION', entityId: r.id, locationId: r.location_id, before: r, after,
      });
      return after;
    });
  }

  /** Rejecting a variance sends a SUBMITTED closing back to REJECTED. */
  async rejectVariance(ctx: ReqCtx, reconId: string, dto: ReviewDto) {
    if (!dto.comment?.trim()) throw validation('COMMENT_REQUIRED', 'Say why the variance is rejected', 'comment');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const r = await tx.cashReconciliation.findUnique({ where: { id: reconId } });
      if (!r) throw notFound('Cash reconciliation');
      if (r.variance_approval !== 'SUBMITTED') throw new AppException(409, 'INVALID_TRANSITION', 'There is no variance waiting for approval');
      const after = await tx.cashReconciliation.update({
        where: { id: r.id },
        data: { variance_approval: 'REJECTED', approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } },
      });
      const closing = await tx.dailyClosing.findUnique({
        where: { location_id_business_date: { location_id: r.location_id, business_date: r.business_date } },
      });
      if (closing?.status === 'SUBMITTED') {
        await tx.dailyClosing.update({
          where: { id: closing.id },
          data: { status: 'REJECTED', reviewed_by: ctx.user.id, reviewed_at: new Date(), review_comment: dto.comment, updated_by: ctx.user.id, version: { increment: 1 } },
        });
        await this.writeEvent(tx, closing.id, 'SUBMITTED', 'REJECTED', ctx, `Cash variance rejected: ${dto.comment}`);
      }
      await this.audit.log(tx, ctx, {
        action: 'REJECT', entityType: 'CASH_RECONCILIATION', entityId: r.id, locationId: r.location_id, before: r, after, reason: dto.comment,
      });
      return after;
    });
  }
}
