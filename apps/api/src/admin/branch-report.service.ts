import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException, notFound, validation } from '../common/app-exception';
import { ReqCtx } from '../common/auth-user';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { D, sum, ZERO } from '../common/money';
import { PrismaService } from '../common/prisma.service';

type Dec = Prisma.Decimal;
const COUNTED = { in: ['SUBMITTED', 'APPROVED'] as Array<'SUBMITTED' | 'APPROVED'> };

/**
 * Branch-wise report (LLD s18 family SAL/EXP/CSH): one branch, one period, everything the owner asks about
 * that branch in one response. Runs under the caller's location scope, so a manager can only ever read
 * their own branch and the owner any.
 */
@Injectable()
export class BranchReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(ctx: ReqCtx, locationId: string, fromStr?: string, toStr?: string) {
    const to = toStr ? toDate(toStr, 'to') : toDate(todayIST());
    const from = fromStr ? toDate(fromStr, 'from') : addDays(to, -29);
    if (from.getTime() > to.getTime()) throw validation('INVALID_RANGE', 'from must be on or before to', 'from');
    if ((to.getTime() - from.getTime()) / 86_400_000 > 400) throw validation('INVALID_RANGE', 'Choose a range of at most 400 days', 'to');
    const range = { gte: from, lte: to };

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: locationId } });
      if (!loc) throw notFound('Branch');
      if (loc.type !== 'BRANCH') throw new AppException(422, 'INVALID_LOCATION', 'Reports are for branches');

      const live = { location_id: locationId, status: 'ACTIVE' as const };
      const [sales, expenses, wastage, recons, closings, cats] = await Promise.all([
        tx.dailySales.findMany({ where: { ...live, business_date: range }, orderBy: { business_date: 'asc' } }),
        tx.expense.findMany({
          where: { ...live, approval_status: COUNTED, business_date: range },
          select: { business_date: true, category_id: true, amount: true },
        }),
        tx.wastage.findMany({
          where: { ...live, approval_status: COUNTED, business_date: range },
          select: { business_date: true, estimated_value: true },
        }),
        tx.cashReconciliation.findMany({ where: { location_id: locationId, business_date: range } }),
        tx.dailyClosing.findMany({ where: { location_id: locationId, business_date: range } }),
        tx.expenseCategory.findMany({ select: { id: true, name_en: true, name_ta: true, pl_bucket: true } }),
      ]);

      // ---- day by day
      const days: Array<Record<string, unknown>> = [];
      for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
        const key = fmtDate(d);
        const s = sales.find((x) => fmtDate(x.business_date) === key);
        const exp = sum(expenses.filter((x) => fmtDate(x.business_date) === key).map((x) => x.amount));
        const was = sum(wastage.filter((x) => fmtDate(x.business_date) === key).map((x) => x.estimated_value));
        const r = recons.find((x) => fmtDate(x.business_date) === key);
        const c = closings.find((x) => fmtDate(x.business_date) === key);
        days.push({
          date: key,
          sales: s?.total_sales ?? null,
          cash: s?.cash_sales ?? null, upi: s?.upi_sales ?? null, card: s?.card_sales ?? null, credit: s?.credit_sales ?? null,
          expenses: exp, wastage: was,
          cashVariance: r?.variance ?? null,
          closingStatus: c?.status ?? null,
        });
      }

      // ---- expenses by category
      const byCat = new Map<string, Dec>();
      for (const e of expenses) byCat.set(e.category_id, (byCat.get(e.category_id) ?? ZERO).plus(e.amount));
      const totalExpenses = sum([...byCat.values()]);
      const expenseByCategory = [...byCat.entries()]
        .map(([id, amount]) => {
          const c = cats.find((x) => x.id === id);
          return {
            categoryId: id, name: c?.name_en ?? '?', nameTa: c?.name_ta ?? null, plBucket: c?.pl_bucket ?? 'OTHER', amount,
            sharePct: totalExpenses.isZero() ? null : amount.div(totalExpenses).mul(100).toDecimalPlaces(1),
          };
        })
        .sort((a, b) => b.amount.comparedTo(a.amount));

      // ---- summary
      const totalSales = sum(sales.map((s) => s.total_sales));
      const salesDays = sales.length;
      const totalWastage = sum(wastage.map((w) => w.estimated_value));
      // operating expenses exclude the NON_PL bucket (staff advances), as in the dashboard profitability chart
      const operating = sum(expenseByCategory.filter((c) => c.plBucket !== 'NON_PL').map((c) => c.amount));
      const profit = totalSales.minus(operating).minus(totalWastage);
      const variances = recons.map((r) => r.variance).filter((v): v is Dec => v !== null);
      const shortages = variances.filter((v) => v.isNegative());
      const pct = (part: Dec) => (totalSales.isZero() ? null : part.div(totalSales).mul(100).toDecimalPlaces(1));
      const count = (status: string) => closings.filter((c) => c.status === status).length;

      return {
        branch: { id: loc.id, code: loc.code, name: loc.name, nameTa: loc.name_ta, status: loc.status },
        from: fmtDate(from), to: fmtDate(to),
        summary: {
          totalSales, salesDays,
          avgDailySales: salesDays ? totalSales.div(salesDays).toDecimalPlaces(2) : null,
          cash: sum(sales.map((s) => s.cash_sales)), upi: sum(sales.map((s) => s.upi_sales)),
          card: sum(sales.map((s) => s.card_sales)), credit: sum(sales.map((s) => s.credit_sales)),
          cashPct: pct(sum(sales.map((s) => s.cash_sales))), upiPct: pct(sum(sales.map((s) => s.upi_sales))),
          cardPct: pct(sum(sales.map((s) => s.card_sales))), creditPct: pct(sum(sales.map((s) => s.credit_sales))),
          totalExpenses, operatingExpenses: operating, totalWastage,
          operatingProfit: profit, marginPct: pct(profit),
          netCashVariance: sum(variances), shortageDays: shortages.length,
          largestShortage: shortages.length ? shortages.reduce((m, v) => (v.lessThan(m) ? v : m), D(0)) : null,
          closings: { approved: count('APPROVED'), submitted: count('SUBMITTED'), rejected: count('REJECTED'), reopened: count('REOPENED'), pending: count('PENDING') },
        },
        expenseByCategory,
        days,
      };
    });
  }
}
