import { Injectable } from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { notFound, validation } from '../common/app-exception';
import { ReqCtx } from '../common/auth-user';
import { fmtDate, toDate } from '../common/dates';
import { sum, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';

const COUNTED = { in: ['SUBMITTED', 'APPROVED'] as Array<'SUBMITTED' | 'APPROVED'> };
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export class PLQuery {
  @IsUUID() locationId: string;
  @IsString() from: string;
  @IsString() to: string;
}
export class ConsolidatedPLQuery {
  @IsString() from: string;
  @IsString() to: string;
}

function parseRange(fromStr: string, toStr: string) {
  const from = toDate(fromStr, 'from');
  const to = toDate(toStr, 'to');
  if (from.getTime() > to.getTime()) throw validation('INVALID_RANGE', 'from must be on or before to', 'from');
  if ((to.getTime() - from.getTime()) / 86_400_000 > 400) throw validation('INVALID_RANGE', 'Choose a range of at most 400 days', 'to');
  return { from, to };
}

/**
 * Management P&L (never a statutory/tax P&L): Sales - Raw material - Salary - Rent - Electricity - Transport -
 * Maintenance - Other expenses - Wastage = Operating profit. Computed live from the same source tables every
 * other report reads, never a stored snapshot, so it can never drift.
 *
 * Data sources, deliberately: raw material cost is the day's actual stock CONSUMPTION value (not what was bought,
 * which can sit unused in the stock room), salary is the payroll module's computed payable (not a hand-typed
 * expense line), and rent/electricity/transport/maintenance are their own expense-category buckets. Any expense
 * manually logged under the RAW_MATERIAL or SALARY buckets (instead of going through Purchases or Payroll) is
 * folded into "other expenses" so it is never silently dropped, but also never double-counted against its
 * authoritative source above.
 */
@Injectable()
export class PLService {
  constructor(private readonly prisma: PrismaService) {}

  private async computeLines(tx: Tx, locationIds: string[], from: Date, to: Date) {
    const range = { gte: from, lte: to };
    const live = { status: 'ACTIVE' as const, location_id: { in: locationIds } };
    const [sales, expenses, wastageRows, consumptionRows, salaryRows, cats] = await Promise.all([
      tx.dailySales.findMany({ where: { ...live, business_date: range }, select: { total_sales: true, business_date: true } }),
      tx.expense.findMany({ where: { ...live, approval_status: COUNTED, business_date: range }, select: { amount: true, category_id: true } }),
      tx.wastage.findMany({ where: { ...live, approval_status: COUNTED, business_date: range }, select: { estimated_value: true } }),
      tx.inventoryTransaction.findMany({ where: { location_id: { in: locationIds }, txn_type: 'CONSUMPTION', business_date: range }, select: { value: true } }),
      // a salary belongs to the whole month it was run for; a range is credited with any month it touches, not prorated by day
      tx.salary.findMany({ where: { location_id: { in: locationIds }, period_month: { gte: monthStart(from), lte: to } }, select: { payable: true } }),
      tx.expenseCategory.findMany({ select: { id: true, pl_bucket: true } }),
    ]);

    const bucketOf = (id: string) => cats.find((c) => c.id === id)?.pl_bucket ?? 'OTHER';
    const sumBucket = (bucket: string) => sum(expenses.filter((e) => bucketOf(e.category_id) === bucket).map((e) => e.amount));

    const totalSales = sum(sales.map((s) => s.total_sales));
    const rawMaterial = sum(consumptionRows.map((r) => r.value)).abs();
    const salary = sum(salaryRows.map((r) => r.payable));
    const rent = sumBucket('RENT');
    const electricity = sumBucket('ELECTRICITY');
    const transport = sumBucket('TRANSPORT');
    const maintenance = sumBucket('MAINTENANCE');
    const otherExpenses = sumBucket('OTHER').plus(sumBucket('RAW_MATERIAL')).plus(sumBucket('SALARY'));
    const wastage = sum(wastageRows.map((w) => w.estimated_value));
    const operatingProfit = totalSales.minus(rawMaterial).minus(salary).minus(rent).minus(electricity).minus(transport).minus(maintenance).minus(otherExpenses).minus(wastage);
    const marginPct = totalSales.isZero() ? null : operatingProfit.div(totalSales).mul(100).toDecimalPlaces(1);
    const salesDays = new Set(sales.map((s) => fmtDate(s.business_date))).size;
    const avgDailySales = salesDays ? totalSales.div(salesDays).toDecimalPlaces(2) : ZERO;

    return { totalSales, rawMaterial, salary, rent, electricity, transport, maintenance, otherExpenses, wastage, operatingProfit, marginPct, salesDays, avgDailySales };
  }

  /** One branch's Management P&L for an owner-chosen range (the frontend offers day/week/month/year presets that just set from/to). */
  async branch(ctx: ReqCtx, q: PLQuery) {
    const { from, to } = parseRange(q.from, q.to);
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: q.locationId } });
      if (!loc) throw notFound('Branch');
      if (loc.type !== 'BRANCH') throw validation('INVALID_LOCATION', 'A management P&L is for a branch', 'locationId');
      const lines = await this.computeLines(tx, [q.locationId], from, to);
      return { label: 'MANAGEMENT P&L', branch: { id: loc.id, code: loc.code, name: loc.name, nameTa: loc.name_ta }, from: fmtDate(from), to: fmtDate(to), ...lines };
    });
  }

  /** Every branch rolled into one consolidated Management P&L, for the owner. */
  async consolidated(ctx: ReqCtx, q: ConsolidatedPLQuery) {
    const { from, to } = parseRange(q.from, q.to);
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const branches = await tx.location.findMany({ where: { type: 'BRANCH', status: 'ACTIVE' }, select: { id: true } });
      const lines = await this.computeLines(tx, branches.map((b) => b.id), from, to);
      return { label: 'CONSOLIDATED BUSINESS P&L', branchCount: branches.length, from: fmtDate(from), to: fmtDate(to), ...lines };
    });
  }
}
