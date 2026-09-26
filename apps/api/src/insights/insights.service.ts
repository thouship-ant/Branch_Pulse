import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException, validation } from '../common/app-exception';
import { Envelope } from '../common/response';
import { ReqCtx } from '../common/auth-user';
import { addDays, fmtDate, timeIST, toDate, todayIST } from '../common/dates';
import { D, ZERO, sum } from '../common/money';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';

type Dec = Prisma.Decimal;

export const CHART_CODES = [
  'daily-sales-trend', 'branch-sales', 'expense-categories', 'monthly-sales',
  'monthly-expenses', 'branch-profitability', 'stock-consumption', 'wastage-trend',
];

/** Inclusive list of YYYY-MM-DD strings. */
function dateList(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) out.push(fmtDate(d));
  return out;
}

const OPEN = ['PENDING', 'REJECTED', 'REOPENED'];
const IN_FLIGHT = { in: ['SUBMITTED', 'APPROVED'] as Array<'SUBMITTED' | 'APPROVED'> };

export interface ExceptionItem {
  code: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  /** English heading (kept for logs/exports). The UI translates from `groupKey` instead. */
  group: string;
  /** CLOSING_PENDING | CLOSING_REJECTED | CLOSING_REOPENED | CASH_SHORTAGE | CASH_SURPLUS | APPROVAL_PENDING */
  groupKey: string;
  groupParam?: number;
  title: string;
  locationId: string | null;
  locationName: string | null;
  locationNameTa: string | null;
  businessDate: string | null;
  metric?: string;
  link: { type: string; id?: string; locationId?: string; date?: string };
}

const RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** KPI tiles + branch table for one date (LLD s17 bands 2 and 3). */
  async summary(ctx: ReqCtx, dateStr: string | undefined, locationIds?: string) {
    const date = toDate(dateStr ?? todayIST(), 'date');
    const prev = addDays(date, -7);
    const filter = locationIds?.split(',').filter(Boolean);

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const branches = await tx.location.findMany({
        where: { type: 'BRANCH', status: 'ACTIVE', ...(filter?.length ? { id: { in: filter } } : {}) },
        orderBy: { code: 'asc' },
      });
      const ids = branches.map((b) => b.id);
      const live = { location_id: { in: ids }, business_date: date, status: 'ACTIVE' as const };

      const [sales, prevSales, exp, pur, was, recons, closings] = await Promise.all([
        tx.dailySales.findMany({ where: live }),
        tx.dailySales.aggregate({
          where: { location_id: { in: ids }, business_date: prev, status: 'ACTIVE' },
          _sum: { total_sales: true },
        }),
        tx.expense.groupBy({ by: ['location_id'], where: { ...live, approval_status: IN_FLIGHT }, _sum: { amount: true } }),
        tx.purchase.groupBy({ by: ['location_id'], where: { ...live, approval_status: IN_FLIGHT }, _sum: { total_amount: true } }),
        tx.wastage.groupBy({ by: ['location_id'], where: { ...live, approval_status: IN_FLIGHT }, _sum: { estimated_value: true } }),
        tx.cashReconciliation.findMany({ where: { location_id: { in: ids }, business_date: date } }),
        tx.dailyClosing.findMany({ where: { location_id: { in: ids }, business_date: date } }),
      ]);

      const rows = branches.map((b) => {
        const s = sales.find((x) => x.location_id === b.id);
        const e = exp.find((x) => x.location_id === b.id)?._sum.amount ?? ZERO;
        const p = pur.find((x) => x.location_id === b.id)?._sum.total_amount ?? ZERO;
        const w = was.find((x) => x.location_id === b.id)?._sum.estimated_value ?? ZERO;
        const r = recons.find((x) => x.location_id === b.id);
        const c = closings.find((x) => x.location_id === b.id);
        const total = s?.total_sales ?? ZERO;
        return {
          locationId: b.id,
          code: b.code,
          name: b.name,
          nameTa: b.name_ta,
          sales: total,
          expenses: e,
          net: total.minus(e),
          cash: s?.cash_sales ?? ZERO,
          upi: s?.upi_sales ?? ZERO,
          card: s?.card_sales ?? ZERO,
          purchases: p,
          wastage: w,
          cashVariance: r?.variance ?? null,
          closingStatus: c?.status ?? 'PENDING',
        };
      });

      const totalSales = sum(rows.map((r) => r.sales));
      const totalExpenses = sum(rows.map((r) => r.expenses));
      const previous = prevSales._sum.total_sales ?? ZERO;
      const variances = rows.map((r) => r.cashVariance).filter((v): v is Dec => v !== null);
      const change = previous.isZero() ? null : totalSales.minus(previous).div(previous).mul(100).toDecimalPlaces(1);

      return {
        date,
        tiles: {
          totalSales,
          totalExpenses,
          netOperating: totalSales.minus(totalExpenses), // purchases shown separately: they become stock
          cash: sum(rows.map((r) => r.cash)),
          upi: sum(rows.map((r) => r.upi)),
          card: sum(rows.map((r) => r.card)),
          totalPurchases: sum(rows.map((r) => r.purchases)),
          wastage: sum(rows.map((r) => r.wastage)),
          cashVariance: sum(variances),
          hasCashShortage: variances.some((v) => v.isNegative()),
          pendingClosings: rows.filter((r) => OPEN.includes(r.closingStatus)).length,
          branchCount: rows.length,
        },
        vsLastWeek: { salesPrevious: previous, salesChangePct: change },
        branches: rows,
      };
    });
  }

  // ------------------------------------------------------------------ charts (LLD s17 band 4)
  /**
   * One endpoint per chart, all scoped by the caller's location scope (RLS) and the same date range.
   * Money/quantities are returned as decimal strings; missing days are null so the UI can leave gaps
   * instead of drawing false zeros.
   */
  async chart(ctx: ReqCtx, code: string, fromStr?: string, toStr?: string) {
    if (!CHART_CODES.includes(code)) throw new AppException(404, 'NOT_FOUND', `Unknown chart ${code}`);
    const today = toDate(todayIST());
    const to = toStr ? toDate(toStr, 'to') : today;
    const from = fromStr ? toDate(fromStr, 'from') : addDays(to, -29);
    if (from.getTime() > to.getTime()) throw validation('INVALID_RANGE', 'from must be on or before to', 'from');
    if ((to.getTime() - from.getTime()) / 86_400_000 > 400) throw validation('INVALID_RANGE', 'Choose a range of at most 400 days', 'to');

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const branches = await tx.location.findMany({
        where: { type: 'BRANCH', status: 'ACTIVE' },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, name_ta: true },
      });
      const ids = branches.map((b) => b.id);
      const counted = { in: ['SUBMITTED', 'APPROVED'] as Array<'SUBMITTED' | 'APPROVED'> };
      const range = { gte: from, lte: to };

      switch (code) {
        case 'daily-sales-trend': {
          const rows = await tx.dailySales.findMany({
            where: { location_id: { in: ids }, status: 'ACTIVE', business_date: range },
            select: { location_id: true, business_date: true, total_sales: true },
          });
          const dates = dateList(from, to);
          const byBranch: Record<string, Array<Dec | null>> = Object.fromEntries(ids.map((id) => [id, dates.map(() => null)]));
          const total: Array<Dec | null> = dates.map(() => null);
          const index = new Map(dates.map((d, i) => [d, i]));
          for (const r of rows) {
            const i = index.get(fmtDate(r.business_date))!;
            byBranch[r.location_id][i] = r.total_sales;
            total[i] = (total[i] ?? ZERO).plus(r.total_sales);
          }
          return { from: fmtDate(from), to: fmtDate(to), dates, branches, total, byBranch };
        }

        case 'branch-sales': {
          const g = await tx.dailySales.groupBy({
            by: ['location_id'],
            where: { location_id: { in: ids }, status: 'ACTIVE', business_date: range },
            _sum: { total_sales: true },
            _count: true,
          });
          const rows = branches.map((b) => {
            const x = g.find((r) => r.location_id === b.id);
            return { locationId: b.id, code: b.code, name: b.name, nameTa: b.name_ta, sales: x?._sum.total_sales ?? ZERO, days: x?._count ?? 0 };
          });
          rows.sort((a, b) => b.sales.comparedTo(a.sales));
          return { from: fmtDate(from), to: fmtDate(to), rows };
        }

        case 'expense-categories': {
          const g = await tx.expense.groupBy({
            by: ['category_id'],
            where: { status: 'ACTIVE', approval_status: counted, business_date: range },
            _sum: { amount: true },
          });
          const cats = await tx.expenseCategory.findMany({ select: { id: true, name_en: true, name_ta: true } });
          const rows = g
            .map((r) => {
              const c = cats.find((x) => x.id === r.category_id);
              return { categoryId: r.category_id, name: c?.name_en ?? '?', nameTa: c?.name_ta ?? null, amount: r._sum.amount ?? ZERO };
            })
            .sort((a, b) => b.amount.comparedTo(a.amount));
          return { from: fmtDate(from), to: fmtDate(to), total: sum(rows.map((r) => r.amount)), rows };
        }

        case 'monthly-sales':
        case 'monthly-expenses': {
          // always the last 12 calendar months ending this month, independent of the chosen range
          const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
          const rows =
            code === 'monthly-sales'
              ? await tx.$queryRaw<Array<{ m: Date; amount: Dec }>>`
                  SELECT date_trunc('month', business_date)::date AS m, SUM(total_sales) AS amount
                  FROM daily_sales WHERE status = 'ACTIVE' AND business_date >= ${start} GROUP BY 1 ORDER BY 1`
              : await tx.$queryRaw<Array<{ m: Date; amount: Dec }>>`
                  SELECT date_trunc('month', business_date)::date AS m, SUM(amount) AS amount
                  FROM expenses WHERE status = 'ACTIVE' AND approval_status IN ('SUBMITTED','APPROVED')
                    AND business_date >= ${start} GROUP BY 1 ORDER BY 1`;
          const byMonth = new Map(rows.map((r) => [fmtDate(r.m).slice(0, 7), D(r.amount)]));
          const months = Array.from({ length: 12 }, (_, i) => {
            const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
            const key = fmtDate(d).slice(0, 7);
            return { month: key, amount: byMonth.get(key) ?? ZERO };
          });
          return { months };
        }

        case 'branch-profitability': {
          // Operating margin = (sales - operating expenses - wastage) / sales. Expenses in the NON_PL bucket
          // (e.g. staff advances) are excluded. Stock consumption and central-office costs are not allocated yet.
          const [sales, exp, was] = await Promise.all([
            tx.dailySales.groupBy({ by: ['location_id'], where: { location_id: { in: ids }, status: 'ACTIVE', business_date: range }, _sum: { total_sales: true } }),
            tx.$queryRaw<Array<{ location_id: string; amount: Dec }>>`
              SELECT e.location_id, SUM(e.amount) AS amount
              FROM expenses e JOIN expense_categories c ON c.id = e.category_id
              WHERE e.status = 'ACTIVE' AND e.approval_status IN ('SUBMITTED','APPROVED') AND c.pl_bucket <> 'NON_PL'
                AND e.business_date BETWEEN ${from} AND ${to} GROUP BY e.location_id`,
            tx.wastage.groupBy({ by: ['location_id'], where: { location_id: { in: ids }, status: 'ACTIVE', approval_status: counted, business_date: range }, _sum: { estimated_value: true } }),
          ]);
          const rows = branches.map((b) => {
            const s = sales.find((x) => x.location_id === b.id)?._sum.total_sales ?? ZERO;
            const e = D(exp.find((x) => x.location_id === b.id)?.amount ?? 0);
            const w = was.find((x) => x.location_id === b.id)?._sum.estimated_value ?? ZERO;
            const profit = s.minus(e).minus(w);
            return {
              locationId: b.id, code: b.code, name: b.name, nameTa: b.name_ta,
              sales: s, expenses: e, wastage: w, profit,
              marginPct: s.isZero() ? null : profit.div(s).mul(100).toDecimalPlaces(1),
            };
          });
          rows.sort((a, b) => (b.marginPct?.toNumber() ?? -Infinity) - (a.marginPct?.toNumber() ?? -Infinity));
          return { from: fmtDate(from), to: fmtDate(to), rows };
        }

        case 'stock-consumption': {
          // One series per item, in the item's own unit (ml and g must never share an axis): the four
          // items with the highest consumption value in the period.
          const g = await tx.inventoryTransaction.groupBy({
            by: ['item_id', 'business_date'],
            where: { txn_type: 'CONSUMPTION', business_date: range },
            _sum: { quantity: true, value: true },
          });
          const totals = new Map<string, Dec>();
          for (const r of g) totals.set(r.item_id, (totals.get(r.item_id) ?? ZERO).plus((r._sum.value ?? ZERO).abs()));
          const top = [...totals.entries()].sort((a, b) => b[1].comparedTo(a[1])).slice(0, 4).map(([id]) => id);
          const items = await tx.inventoryItem.findMany({ where: { id: { in: top } } });
          const units = await tx.unit.findMany();
          const dates = dateList(from, to);
          const index = new Map(dates.map((d, i) => [d, i]));
          return {
            from: fmtDate(from), to: fmtDate(to), dates,
            items: top.map((id) => {
              const it = items.find((x) => x.id === id)!;
              const values: Array<Dec | null> = dates.map(() => null);
              let qty = ZERO;
              for (const r of g.filter((x) => x.item_id === id)) {
                const q = (r._sum.quantity ?? ZERO).abs();
                values[index.get(fmtDate(r.business_date))!] = q;
                qty = qty.plus(q);
              }
              return {
                itemId: id, code: it.code, name: it.name_en, nameTa: it.name_ta,
                unit: units.find((u) => u.id === it.base_unit_id)?.code ?? '', total: qty, values,
              };
            }),
          };
        }

        case 'wastage-trend': {
          const [was, sales] = await Promise.all([
            tx.wastage.groupBy({ by: ['business_date'], where: { status: 'ACTIVE', approval_status: counted, business_date: range }, _sum: { estimated_value: true } }),
            tx.dailySales.groupBy({ by: ['business_date'], where: { location_id: { in: ids }, status: 'ACTIVE', business_date: range }, _sum: { total_sales: true } }),
          ]);
          const dates = dateList(from, to);
          const value: Array<Dec | null> = dates.map(() => null);
          const pctOfSales: Array<Dec | null> = dates.map(() => null);
          dates.forEach((d, i) => {
            const w = was.find((x) => fmtDate(x.business_date) === d)?._sum.estimated_value;
            const s = sales.find((x) => fmtDate(x.business_date) === d)?._sum.total_sales;
            if (s) {
              value[i] = w ?? ZERO; // a trading day with no wastage is a real zero
              pctOfSales[i] = (w ?? ZERO).div(s).mul(100).toDecimalPlaces(2);
            } else if (w) {
              value[i] = w;
            }
          });
          return { from: fmtDate(from), to: fmtDate(to), dates, value, pctOfSales, total: sum(was.map((x) => x._sum.estimated_value)) };
        }
      }
    });
  }

  /**
   * Live exception feed (LLD s13). Evaluated on read from source rows, sorted Critical -> Warning ->
   * Info, so it can never go stale. Persisted notifications with dedupe keys arrive with Phase 2 channels.
   */
  async exceptions(ctx: ReqCtx) {
    const today = toDate(todayIST());
    const from = addDays(today, -6);
    const cutoff = String(await this.settings.get('closing.cutoff_time'));
    const afterCutoff = timeIST() >= cutoff;
    const threshold = D(await this.settings.getNumber('cash.variance_threshold'));
    const pendingHours = await this.settings.getNumber('alerts.approval_pending_hours');

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const branches = await tx.location.findMany({ where: { type: 'BRANCH', status: 'ACTIVE' } });
      const ids = branches.map((b) => b.id);
      const byId = new Map(branches.map((b) => [b.id, b]));
      const [closings, recons, staleExpenses] = await Promise.all([
        tx.dailyClosing.findMany({ where: { location_id: { in: ids }, business_date: { gte: from, lte: today } } }),
        tx.cashReconciliation.findMany({
          where: { location_id: { in: ids }, business_date: { gte: from, lte: today }, NOT: { variance: null } },
        }),
        tx.expense.groupBy({
          by: ['location_id'],
          where: {
            location_id: { in: ids }, status: 'ACTIVE', approval_status: 'SUBMITTED',
            created_at: { lt: new Date(Date.now() - pendingHours * 3_600_000) },
          },
          _count: true,
        }),
      ]);

      const items: ExceptionItem[] = [];
      const name = (id: string) => byId.get(id)?.name ?? null;
      const nameTa = (id: string) => byId.get(id)?.name_ta ?? null;

      // closing pending: past days, or today once the cut-off has passed
      for (const b of branches) {
        const startsOn = toDate(fmtDate(b.opened_on ?? b.created_at));
        for (let d = from; d.getTime() <= today.getTime(); d = addDays(d, 1)) {
          if (d.getTime() < startsOn.getTime()) continue;
          const isToday = d.getTime() === today.getTime();
          if (isToday && !afterCutoff) continue;
          const c = closings.find((x) => x.location_id === b.id && x.business_date.getTime() === d.getTime());
          const status = c?.status ?? 'PENDING';
          if (!OPEN.includes(status)) continue;
          const word = status === 'REJECTED' ? 'rejected' : status === 'REOPENED' ? 'reopened' : 'pending';
          items.push({
            code: 'CLOSING_PENDING', severity: 'CRITICAL', group: `Closing ${word}`, groupKey: `CLOSING_${word.toUpperCase()}`,
            title: `Closing ${word} - ${b.name}`,
            locationId: b.id, locationName: b.name, locationNameTa: b.name_ta, businessDate: fmtDate(d),
            link: { type: 'CLOSING', id: c?.id, locationId: b.id, date: fmtDate(d) },
          });
        }
      }

      // cash variances still waiting for a decision
      for (const r of recons) {
        const v = r.variance!;
        if (v.isZero() || r.variance_approval === 'APPROVED') continue;
        const large = v.abs().greaterThan(threshold);
        if (!v.isNegative() && !large) continue;
        items.push({
          code: v.isNegative() ? 'CASH_SHORTAGE' : 'CASH_VARIANCE_LARGE',
          severity: 'CRITICAL',
          group: `Cash ${v.isNegative() ? 'shortage' : 'surplus'}`, groupKey: v.isNegative() ? 'CASH_SHORTAGE' : 'CASH_SURPLUS',
          title: `Cash ${v.isNegative() ? 'shortage' : 'surplus'} ${v.abs().toFixed(2)} - ${name(r.location_id)}`,
          locationId: r.location_id, locationName: name(r.location_id), locationNameTa: nameTa(r.location_id), businessDate: fmtDate(r.business_date),
          metric: v.toFixed(2),
          link: { type: 'CASH_RECONCILIATION', id: r.id, locationId: r.location_id, date: fmtDate(r.business_date) },
        });
      }

      for (const g of staleExpenses) {
        items.push({
          code: 'APPROVAL_PENDING', severity: 'INFO', group: `Expenses waiting over ${pendingHours}h`,
          groupKey: 'APPROVAL_PENDING', groupParam: pendingHours,
          title: `${g._count} expense${g._count === 1 ? '' : 's'} waiting over ${pendingHours}h - ${name(g.location_id)}`,
          locationId: g.location_id, locationName: name(g.location_id), locationNameTa: nameTa(g.location_id), businessDate: null, metric: String(g._count),
          link: { type: 'EXPENSE_QUEUE', locationId: g.location_id },
        });
      }

      items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.businessDate ?? '').localeCompare(a.businessDate ?? ''));

      const todays = branches.every((b) => {
        const c = closings.find((x) => x.location_id === b.id && x.business_date.getTime() === today.getTime());
        return c && (c.status === 'SUBMITTED' || c.status === 'APPROVED');
      });
      return new Envelope(items, [], { allClosed: branches.length > 0 && todays, count: items.length });
    });
  }
}
