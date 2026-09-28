import { Injectable } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { toDate, todayIST } from '../common/dates';
import { Dec, parseMoney, round2, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { AttendanceService } from './attendance.service';

const min = (a: Dec, b: Dec): Dec => (a.lessThan(b) ? a : b);

export class ComputeSalaryDto {
  @IsString() employeeId: string;
  @IsString() month: string; // YYYY-MM
}
export class ComputeLocationSalaryDto {
  @IsString() locationId: string;
  @IsString() month: string;
}
export class AdjustSalaryDto {
  @IsOptional() @IsString() allowances?: string;
  @IsOptional() @IsString() otherDeductions?: string;
}
export class PaySalaryDto {
  @IsString() amount: string;
  @IsString() paymentMode: string;
  @IsOptional() @IsString() paidOn?: string;
}
export class ListSalaryQuery {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() month?: string;
}

function monthRange(month: string): { from: Date; to: Date; periodMonth: Date } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw validation('INVALID_DATE', 'month must be YYYY-MM', 'month');
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return { from, to, periodMonth: from };
}

/** Monthly payroll: basic + overtime - advance recovery - deductions = payable, then approve and pay. */
@Injectable()
export class SalaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
  ) {}

  /** What of this employee's outstanding advances would be recovered this month, and how much in total. */
  private async previewRecovery(tx: Tx, employeeId: string): Promise<{ total: Dec; lines: Array<{ id: string; amount: Dec }> }> {
    const advances = await tx.employeeAdvance.findMany({ where: { employee_id: employeeId, status: 'PAID' } });
    const lines = advances
      .filter((a) => a.remaining_amount.greaterThan(0))
      .map((a) => ({ id: a.id, amount: min(a.monthly_recovery ?? a.remaining_amount, a.remaining_amount) }));
    return { total: lines.reduce((s, l) => s.plus(l.amount), ZERO), lines };
  }

  /** Basic + overtime - advance recovery - deductions, for one employee, one calendar month. Safe to re-run while still a draft. */
  async compute(ctx: ReqCtx, dto: ComputeSalaryDto) {
    const { from, to, periodMonth } = monthRange(dto.month);
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const emp = await tx.employee.findUnique({ where: { id: dto.employeeId } });
      if (!emp || emp.status !== 'ACTIVE') throw validation('INVALID_EMPLOYEE', 'Choose an active employee', 'employeeId');
      const existing = await tx.salary.findUnique({ where: { employee_id_period_month: { employee_id: dto.employeeId, period_month: periodMonth } } });
      if (existing && existing.approval_status !== 'DRAFT') throw new AppException(409, 'ALREADY_APPROVED', 'This month is already approved or paid; it cannot be recomputed');

      const totals = await this.attendance.monthTotals(tx, dto.employeeId, from, to);
      const basicEarned = emp.salary_type === 'DAILY'
        ? round2(emp.base_salary.mul(totals.presentDays))
        : totals.workingDays.greaterThan(0) ? round2(emp.base_salary.mul(totals.presentDays).div(totals.workingDays)) : ZERO;
      const overtimeAmount = round2(totals.overtimeHours.mul(emp.overtime_rate_per_hour));
      const recovery = await this.previewRecovery(tx, dto.employeeId);
      const otherDeductions = existing?.other_deductions ?? ZERO;
      const allowances = existing?.allowances ?? ZERO;
      const payable = round2(basicEarned.plus(overtimeAmount).plus(allowances).minus(recovery.total).minus(otherDeductions));

      const data = {
        employee_id: dto.employeeId, location_id: emp.location_id, period_month: periodMonth,
        working_days: totals.workingDays, present_days: totals.presentDays, leave_days: totals.leaveDays, overtime_hours: totals.overtimeHours,
        basic_earned: basicEarned, overtime_amount: overtimeAmount, allowances, advance_recovery: recovery.total, other_deductions: otherDeductions,
        payable: payable.isNegative() ? ZERO : payable, updated_by: ctx.user.id,
      };
      const row = existing
        ? await tx.salary.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.salary.create({ data: { ...data, created_by: ctx.user.id } });
      await this.audit.log(tx, ctx, { action: existing ? 'UPDATE' : 'CREATE', entityType: 'SALARY', entityId: row.id, locationId: emp.location_id, after: row });
      return row;
    });
  }

  async computeForLocation(ctx: ReqCtx, dto: ComputeLocationSalaryDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const employees = await tx.employee.findMany({ where: { location_id: dto.locationId, status: 'ACTIVE' } });
      const rows = [];
      for (const e of employees) rows.push(await this.compute(ctx, { employeeId: e.id, month: dto.month }));
      return rows;
    });
  }

  /** Manual top-ups or deductions on top of what attendance computed (e.g. a bonus, a fine); recomputes payable. */
  async adjust(ctx: ReqCtx, id: string, dto: AdjustSalaryDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.salary.findUnique({ where: { id } });
      if (!before) throw notFound('Salary');
      if (before.approval_status !== 'DRAFT') throw new AppException(409, 'ALREADY_APPROVED', 'Already approved or paid');
      const allowances = dto.allowances !== undefined ? parseMoney(dto.allowances, 'allowances', { allowZero: true }) : before.allowances;
      const otherDeductions = dto.otherDeductions !== undefined ? parseMoney(dto.otherDeductions, 'otherDeductions', { allowZero: true }) : before.other_deductions;
      const payable = round2(before.basic_earned.plus(before.overtime_amount).plus(allowances).minus(before.advance_recovery).minus(otherDeductions));
      const after = await tx.salary.update({
        where: { id },
        data: { allowances, other_deductions: otherDeductions, payable: payable.isNegative() ? ZERO : payable, updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'SALARY', entityId: id, locationId: before.location_id, before, after });
      return after;
    });
  }

  async approve(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.salary.findUnique({ where: { id } });
      if (!before) throw notFound('Salary');
      if (before.approval_status !== 'DRAFT') throw new AppException(409, 'INVALID_TRANSITION', `Cannot approve salary that is ${before.approval_status}`);
      const after = await tx.salary.update({ where: { id }, data: { approval_status: 'APPROVED', approved_by: ctx.user.id, updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'APPROVE', entityType: 'SALARY', entityId: id, locationId: before.location_id, before, after });
      return after;
    });
  }

  /** Pays all or part of an approved month, and - only once fully paid - actually recovers the previewed advance amount. */
  async pay(ctx: ReqCtx, id: string, dto: PaySalaryDto) {
    const amount = parseMoney(dto.amount, 'amount', { allowZero: false });
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.salary.findUnique({ where: { id } });
      if (!before) throw notFound('Salary');
      if (before.approval_status !== 'APPROVED') throw new AppException(409, 'INVALID_TRANSITION', 'Approve this month before paying it');
      const paidAmount = before.paid_amount.plus(amount);
      if (paidAmount.greaterThan(before.payable)) throw validation('OVERPAID', 'This is more than the payable amount', 'amount');
      const fullyPaid = paidAmount.greaterThanOrEqualTo(before.payable);
      const after = await tx.salary.update({
        where: { id },
        data: {
          paid_amount: paidAmount, payment_status: fullyPaid ? 'PAID' : 'PARTIAL', paid_on: toDate(dto.paidOn ?? todayIST()),
          payment_mode: dto.paymentMode as any, updated_by: ctx.user.id, version: { increment: 1 },
        },
      });
      if (fullyPaid && before.advance_recovery.greaterThan(0)) await this.settleRecovery(tx, ctx, before.employee_id, id, before.advance_recovery);
      await this.audit.log(tx, ctx, { action: 'STATUS_CHANGE', entityType: 'SALARY', entityId: id, locationId: before.location_id, before, after });
      return after;
    });
  }

  private async settleRecovery(tx: Tx, ctx: ReqCtx, employeeId: string, salaryId: string, budget: Dec) {
    const { lines } = await this.previewRecovery(tx, employeeId);
    let left = budget;
    for (const l of lines) {
      if (left.lessThanOrEqualTo(0)) break;
      const amt = min(l.amount, left);
      left = left.minus(amt);
      const adv = await tx.employeeAdvance.findUnique({ where: { id: l.id } });
      if (!adv) continue;
      const recovered = adv.recovered_amount.plus(amt);
      const remaining = adv.paid_amount.minus(recovered);
      await tx.employeeAdvance.update({
        where: { id: l.id },
        data: { recovered_amount: recovered, remaining_amount: remaining, status: remaining.lessThanOrEqualTo(0) ? 'CLOSED' : undefined, updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await tx.advanceRepayment.create({ data: { advance_id: l.id, salary_id: salaryId, repaid_on: toDate(todayIST()), amount: amt, mode: 'SALARY', created_by: ctx.user.id, updated_by: ctx.user.id } });
    }
  }

  async list(ctx: ReqCtx, q: ListSalaryQuery) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const rows = await tx.salary.findMany({
        where: {
          ...(q.locationId ? { location_id: q.locationId } : {}), ...(q.employeeId ? { employee_id: q.employeeId } : {}),
          ...(q.month ? { period_month: monthRange(q.month).periodMonth } : {}),
        },
        orderBy: [{ period_month: 'desc' }, { created_at: 'desc' }],
      });
      const emps = await tx.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employee_id))] } }, select: { id: true, code: true, full_name: true } });
      return rows.map((r) => ({ ...r, employeeCode: emps.find((e) => e.id === r.employee_id)?.code, employeeName: emps.find((e) => e.id === r.employee_id)?.full_name }));
    });
  }

  async get(ctx: ReqCtx, id: string) {
    const row = await this.prisma.runScoped(ctx.user, (tx) => tx.salary.findUnique({ where: { id } }));
    if (!row) throw notFound('Salary');
    return row;
  }
}
