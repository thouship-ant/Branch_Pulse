import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Envelope } from '../common/response';
import { ReqCtx } from '../common/auth-user';
import { addDays, fmtDate, timeIST, toDate, todayIST } from '../common/dates';
import { D, ZERO, sum } from '../common/money';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';

type Dec = Prisma.Decimal;
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
