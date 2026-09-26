import { Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { validation } from '../common/app-exception';
import { ReqCtx } from '../common/auth-user';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { Dec, D, sum, ZERO } from '../common/money';
import { PrismaService } from '../common/prisma.service';
import { varianceLabel } from './daily.rules';

export class VarianceReportQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsIn(['all', 'shortage', 'surplus']) type?: 'all' | 'shortage' | 'surplus';
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']) status?: string;
}

/**
 * Cash Variance Report (LLD s18 CSH02 + CSH03): every day whose counted cash did not match expected cash, with
 * the reason, the manager's explanation, who approved it, and a per-branch summary. Runs under the caller's
 * location scope, so an owner sees all branches and a manager only their own.
 */
@Injectable()
export class VarianceReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(ctx: ReqCtx, q: VarianceReportQuery) {
    const to = q.to ? toDate(q.to, 'to') : toDate(todayIST());
    const from = q.from ? toDate(q.from, 'from') : addDays(to, -29);
    if (from.getTime() > to.getTime()) throw validation('INVALID_RANGE', 'from must be on or before to', 'from');
    if ((to.getTime() - from.getTime()) / 86_400_000 > 400) throw validation('INVALID_RANGE', 'Choose a range of at most 400 days', 'to');

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const branches = await tx.location.findMany({
        where: { type: 'BRANCH', ...(q.locationId ? { id: q.locationId } : {}) },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, name_ta: true },
      });
      const ids = branches.map((b) => b.id);
      const recons = await tx.cashReconciliation.findMany({
        where: { location_id: { in: ids }, business_date: { gte: from, lte: to }, actual_closing: { not: null } },
        orderBy: [{ business_date: 'desc' }, { location_id: 'asc' }],
      });
      const [photos, closings, approvers] = await Promise.all([
        recons.length
          ? tx.attachment.groupBy({ by: ['entity_id'], where: { entity_type: 'CASH_RECONCILIATION', entity_id: { in: recons.map((r) => r.id) }, status: 'ACTIVE' }, _count: true })
          : [],
        tx.dailyClosing.findMany({ where: { location_id: { in: ids }, business_date: { gte: from, lte: to } }, select: { location_id: true, business_date: true, status: true } }),
        this.prisma.user.findMany({ where: { id: { in: [...new Set(recons.map((r) => r.approved_by).filter((x): x is string => !!x))] } }, select: { id: true, full_name: true } }),
      ]);
      const branch = (id: string) => branches.find((b) => b.id === id)!;

      // ---- detail rows: only days with a difference, filtered
      const wantType = q.type ?? 'all';
      const rows = recons
        .filter((r) => r.variance && !r.variance.isZero())
        .filter((r) => (wantType === 'shortage' ? r.variance!.isNegative() : wantType === 'surplus' ? r.variance!.greaterThan(0) : true))
        .filter((r) => !q.status || r.variance_approval === q.status)
        .map((r) => {
          const b = branch(r.location_id);
          return {
            id: r.id, locationId: r.location_id, code: b.code, name: b.name, nameTa: b.name_ta,
            businessDate: r.business_date, expectedClosing: r.expected_closing, actualClosing: r.actual_closing,
            variance: r.variance, varianceLabel: varianceLabel(r.variance),
            reason: r.variance_reason, managerExplanation: r.manager_explanation,
            approvalStatus: r.variance_approval ?? 'DRAFT',
            approvedBy: approvers.find((u) => u.id === r.approved_by)?.full_name ?? null, approvedAt: r.approved_at,
            photoCount: photos.find((p) => p.entity_id === r.id)?._count ?? 0,
            closingStatus: closings.find((c) => c.location_id === r.location_id && c.business_date.getTime() === r.business_date.getTime())?.status ?? null,
          };
        });

      // ---- summary of the rows shown
      const shortages = rows.filter((r) => r.variance!.isNegative());
      const surpluses = rows.filter((r) => !r.variance!.isNegative());
      const count = (s: string) => rows.filter((r) => r.approvalStatus === s).length;

      // ---- per-branch summary (CSH03): every counted day, so "days reconciled" is meaningful
      const byBranch = branches.map((b) => {
        const mine = recons.filter((r) => r.location_id === b.id);
        const diffs = mine.map((r) => r.variance as Dec).filter((v) => v && !v.isZero());
        const neg = diffs.filter((v) => v.isNegative());
        return {
          locationId: b.id, code: b.code, name: b.name, nameTa: b.name_ta,
          daysReconciled: mine.length,
          cashSales: sum(mine.map((r) => r.cash_sales)),
          netVariance: sum(diffs),
          shortageDays: neg.length,
          surplusDays: diffs.length - neg.length,
          largestShortage: neg.length ? neg.reduce((m, v) => (v.lessThan(m) ? v : m), D(0)) : null,
        };
      });

      return {
        from: fmtDate(from), to: fmtDate(to),
        rows,
        summary: {
          count: rows.length,
          shortageCount: shortages.length, shortageTotal: sum(shortages.map((r) => r.variance)),
          surplusCount: surpluses.length, surplusTotal: sum(surpluses.map((r) => r.variance)),
          net: sum(rows.map((r) => r.variance)),
          byStatus: { draft: count('DRAFT'), submitted: count('SUBMITTED'), approved: count('APPROVED'), rejected: count('REJECTED') },
          largestShortage: shortages.length ? shortages.reduce((m, r) => (r.variance!.lessThan(m) ? r.variance! : m), ZERO) : null,
        },
        byBranch,
      };
    });
  }
}
