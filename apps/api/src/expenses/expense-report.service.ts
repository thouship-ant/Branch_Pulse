import { Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { validation } from '../common/app-exception';
import { ReqCtx } from '../common/auth-user';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { D, Dec, sum, ZERO } from '../common/money';
import { PrismaService } from '../common/prisma.service';

export class ExpenseSummaryQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsIn(['day', 'week', 'month']) groupBy?: 'day' | 'week' | 'month';
}

const MAX_DAYS = 800;
const TREND_CATEGORIES = 5;

/** First day of the bucket a date falls in: the day itself, its Monday, or the 1st of its month. */
export function bucketStart(d: Date, groupBy: 'day' | 'week' | 'month'): string {
  if (groupBy === 'day') return fmtDate(d);
  if (groupBy === 'month') return `${fmtDate(d).slice(0, 7)}-01`;
  return fmtDate(addDays(d, -((d.getUTCDay() + 6) % 7)));
}

/** Every bucket key from `from` to `to`, so quiet days/weeks/months show as zero instead of vanishing. */
export function bucketKeys(from: Date, to: Date, groupBy: 'day' | 'week' | 'month'): string[] {
  const keys: string[] = [];
  let cur = toDate(bucketStart(from, groupBy));
  const last = toDate(bucketStart(to, groupBy));
  while (cur.getTime() <= last.getTime()) {
    keys.push(fmtDate(cur));
    cur = groupBy === 'day' ? addDays(cur, 1)
      : groupBy === 'week' ? addDays(cur, 7)
      : new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return keys;
}

/**
 * Owner expense analytics: totals with a previous-period comparison, daily / weekly / monthly buckets, branch-wise and
 * category-wise splits (with sub-categories), payment-mode split and a trend for the biggest categories.
 * Rejected and cancelled entries are left out; submitted (not yet approved) entries count and are also shown separately.
 * Runs under the caller's location scope: an owner sees every branch, a manager only their own.
 */
@Injectable()
export class ExpenseReportService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ctx: ReqCtx, q: ExpenseSummaryQuery) {
    const to = q.to ? toDate(q.to, 'to') : toDate(todayIST());
    const from = q.from ? toDate(q.from, 'from') : addDays(to, -29);
    if (from.getTime() > to.getTime()) throw validation('INVALID_RANGE', 'from must be on or before to', 'from');
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > MAX_DAYS) throw validation('INVALID_RANGE', `Choose a range of at most ${MAX_DAYS} days`, 'to');
    const groupBy = q.groupBy ?? (days > 120 ? 'month' : days > 45 ? 'week' : 'day');
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));

    const where = (a: Date, b: Date) => ({
      status: 'ACTIVE' as const,
      approval_status: { in: ['SUBMITTED', 'APPROVED'] as Array<'SUBMITTED' | 'APPROVED'> },
      business_date: { gte: a, lte: b },
      ...(q.locationId ? { location_id: q.locationId } : {}),
      ...(q.categoryId ? { category_id: q.categoryId } : {}),
    });

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [rows, prev, cats, locs] = await Promise.all([
        tx.expense.groupBy({
          by: ['business_date', 'location_id', 'category_id', 'sub_category_id', 'payment_mode', 'approval_status'],
          where: where(from, to),
          _sum: { amount: true },
          _count: { _all: true },
        }),
        tx.expense.aggregate({ where: where(prevFrom, prevTo), _sum: { amount: true }, _count: { _all: true } }),
        tx.expenseCategory.findMany({ select: { id: true, name_en: true, name_ta: true, parent_id: true } }),
        tx.location.findMany({ select: { id: true, code: true, name: true, name_ta: true } }),
      ]);

      const cat = new Map(cats.map((c) => [c.id, c]));
      const loc = new Map(locs.map((l) => [l.id, l]));
      const amount = (r: (typeof rows)[number]): Dec => D(r._sum.amount ?? 0);

      const keys = bucketKeys(from, to, groupBy);
      const byBucket = new Map<string, { amount: Dec; count: number }>(keys.map((k) => [k, { amount: ZERO, count: 0 }]));
      const byBranch = new Map<string, { amount: Dec; count: number }>();
      const byCat = new Map<string, { amount: Dec; count: number; subs: Map<string, { amount: Dec; count: number }> }>();
      const byMode = new Map<string, { amount: Dec; count: number }>();
      const catTrend = new Map<string, Map<string, Dec>>(); // category -> bucket -> amount
      let pendingAmount = ZERO;
      let pendingCount = 0;

      for (const r of rows) {
        const a = amount(r);
        const n = r._count._all;
        const key = bucketStart(r.business_date, groupBy);
        const b = byBucket.get(key)!;
        b.amount = b.amount.plus(a); b.count += n;

        const br = byBranch.get(r.location_id) ?? { amount: ZERO, count: 0 };
        br.amount = br.amount.plus(a); br.count += n; byBranch.set(r.location_id, br);

        const c = byCat.get(r.category_id) ?? { amount: ZERO, count: 0, subs: new Map() };
        c.amount = c.amount.plus(a); c.count += n;
        const subKey = r.sub_category_id ?? '';
        const s = c.subs.get(subKey) ?? { amount: ZERO, count: 0 };
        s.amount = s.amount.plus(a); s.count += n; c.subs.set(subKey, s);
        byCat.set(r.category_id, c);

        const m = byMode.get(r.payment_mode) ?? { amount: ZERO, count: 0 };
        m.amount = m.amount.plus(a); m.count += n; byMode.set(r.payment_mode, m);

        const t = catTrend.get(r.category_id) ?? new Map<string, Dec>();
        t.set(key, (t.get(key) ?? ZERO).plus(a)); catTrend.set(r.category_id, t);

        if (r.approval_status === 'SUBMITTED') { pendingAmount = pendingAmount.plus(a); pendingCount += n; }
      }

      const total = sum([...byBucket.values()].map((b) => b.amount));
      const count = [...byBucket.values()].reduce((s, b) => s + b.count, 0);
      const prevTotal = D(prev._sum.amount ?? 0);
      const share = (v: Dec) => (total.isZero() ? null : v.div(total).mul(100).toDecimalPlaces(1).toNumber());

      const branches = [...byBranch.entries()]
        .map(([id, v]) => {
          const l = loc.get(id);
          return { locationId: id, code: l?.code ?? '?', name: l?.name ?? '?', nameTa: l?.name_ta ?? null, amount: v.amount, count: v.count, sharePct: share(v.amount) };
        })
        .sort((a, b) => b.amount.comparedTo(a.amount));

      const categories = [...byCat.entries()]
        .map(([id, v]) => {
          const c = cat.get(id);
          const subs = [...v.subs.entries()]
            .map(([sid, sv]) => {
              const sc = sid ? cat.get(sid) : null;
              return { subCategoryId: sid || null, name: sc?.name_en ?? null, nameTa: sc?.name_ta ?? null, amount: sv.amount, count: sv.count };
            })
            .sort((a, b) => b.amount.comparedTo(a.amount));
          return { categoryId: id, name: c?.name_en ?? '?', nameTa: c?.name_ta ?? null, amount: v.amount, count: v.count, sharePct: share(v.amount), subs };
        })
        .sort((a, b) => b.amount.comparedTo(a.amount));

      const top = categories.slice(0, TREND_CATEGORIES);
      return {
        from: fmtDate(from), to: fmtDate(to), days, groupBy,
        totals: {
          total, count, averagePerDay: total.div(days).toDecimalPlaces(2),
          previousTotal: prevTotal, previousCount: prev._count._all,
          changePct: prevTotal.isZero() ? null : total.minus(prevTotal).div(prevTotal).mul(100).toDecimalPlaces(1).toNumber(),
          pendingApproval: { amount: pendingAmount, count: pendingCount },
        },
        buckets: keys.map((k) => ({ start: k, amount: byBucket.get(k)!.amount, count: byBucket.get(k)!.count })),
        branches,
        categories,
        paymentModes: [...byMode.entries()].map(([mode, v]) => ({ mode, amount: v.amount, count: v.count, sharePct: share(v.amount) })).sort((a, b) => b.amount.comparedTo(a.amount)),
        categoryTrend: {
          keys,
          series: top.map((c) => ({
            categoryId: c.categoryId, name: c.name, nameTa: c.nameTa,
            values: keys.map((k) => catTrend.get(c.categoryId)?.get(k) ?? ZERO),
          })),
        },
      };
    });
  }
}
