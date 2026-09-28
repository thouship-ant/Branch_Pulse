import { Injectable } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { can, isOwner, ReqCtx } from '../common/auth-user';
import { CodesService } from '../common/codes.service';
import { toDate, todayIST } from '../common/dates';
import { parseMoney } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { RulesService } from '../common/rules.service';

export class RequestAdvanceDto {
  @IsUUID() employeeId: string;
  @IsString() amount: string;
  @IsString() @MaxLength(500) reason: string;
  @IsOptional() @IsString() monthlyRecovery?: string;
  @IsOptional() @IsString() requestDate?: string;
}
export class AdvanceActionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class PayAdvanceDto {
  @IsString() paymentMode: string;
  @IsOptional() @IsString() paidOn?: string;
}
export class RepayAdvanceDto {
  @IsString() amount: string;
  @IsOptional() @IsString() repaidOn?: string;
}
export class ListAdvanceQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsString() status?: string;
}

/** Employee → advance request → manager approval → owner/accountant approval → payment; recovered later from salary or cash. */
@Injectable()
export class AdvanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly codes: CodesService,
  ) {}

  async request(ctx: ReqCtx, dto: RequestAdvanceDto) {
    const amount = parseMoney(dto.amount, 'amount', { allowZero: false });
    const monthlyRecovery = dto.monthlyRecovery ? parseMoney(dto.monthlyRecovery, 'monthlyRecovery', { allowZero: false }) : null;
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const emp = await tx.employee.findUnique({ where: { id: dto.employeeId } });
      if (!emp || emp.status !== 'ACTIVE') throw validation('INVALID_EMPLOYEE', 'Choose an active employee', 'employeeId');
      const date = await this.rules.assertBusinessDate(ctx.user, dto.requestDate ?? todayIST(), 'requestDate');
      const row = await tx.employeeAdvance.create({
        data: {
          code: await this.codes.next(tx, 'advance', emp.location_id), employee_id: emp.id, location_id: emp.location_id,
          request_date: date, amount, reason: dto.reason.trim(), monthly_recovery: monthlyRecovery, requested_by: ctx.user.id,
          created_by: ctx.user.id, updated_by: ctx.user.id,
        },
      });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'EMPLOYEE_ADVANCE', entityId: row.id, entityCode: row.code, locationId: row.location_id, after: row });
      return row;
    });
  }

  private async loadFor(tx: Tx, id: string, allowed: string[], verb: string) {
    const a = await tx.employeeAdvance.findUnique({ where: { id } });
    if (!a) throw notFound('Advance');
    if (!allowed.includes(a.status)) throw new AppException(409, 'INVALID_TRANSITION', `Cannot ${verb} an advance that is ${a.status}`);
    return a;
  }

  async managerApprove(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await this.loadFor(tx, id, ['REQUESTED'], 'approve');
      const after = await tx.employeeAdvance.update({
        where: { id }, data: { status: 'MANAGER_APPROVED', manager_approved_by: ctx.user.id, manager_approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.audit.log(tx, ctx, { action: 'APPROVE', entityType: 'EMPLOYEE_ADVANCE', entityId: id, entityCode: before.code, locationId: before.location_id, before, after });
      return after;
    });
  }

  async finalApprove(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await this.loadFor(tx, id, ['MANAGER_APPROVED'], 'approve');
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'ADVANCE');
      if (!this.rules.withinLimit(limit, before.amount)) throw new AppException(403, 'APPROVAL_LIMIT_EXCEEDED', 'This amount is above your approval limit; ask the owner');
      const after = await tx.employeeAdvance.update({
        where: { id }, data: { status: 'APPROVED', final_approved_by: ctx.user.id, final_approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.audit.log(tx, ctx, { action: 'APPROVE', entityType: 'EMPLOYEE_ADVANCE', entityId: id, entityCode: before.code, locationId: before.location_id, before, after });
      return after;
    });
  }

  /** Either approval stage can reject: the manager (before their own approval) or the owner/accountant (before final approval). */
  async reject(ctx: ReqCtx, id: string, dto: AdvanceActionDto) {
    const reason = dto.reason?.trim();
    if (!reason) throw validation('REASON_REQUIRED', 'Give a reason for rejecting', 'reason');
    if (!can(ctx.user, 'advance:manager_approve') && !can(ctx.user, 'advance:approve')) {
      throw new AppException(403, 'FORBIDDEN', 'You do not have permission for this action');
    }
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await this.loadFor(tx, id, ['REQUESTED', 'MANAGER_APPROVED'], 'reject');
      const after = await tx.employeeAdvance.update({
        where: { id }, data: { status: 'REJECTED', rejection_reason: reason, updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.audit.log(tx, ctx, { action: 'REJECT', entityType: 'EMPLOYEE_ADVANCE', entityId: id, entityCode: before.code, locationId: before.location_id, before, after, reason });
      return after;
    });
  }

  async cancel(ctx: ReqCtx, id: string, dto: AdvanceActionDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await this.loadFor(tx, id, ['REQUESTED'], 'cancel');
      if (before.requested_by !== ctx.user.id && !isOwner(ctx.user)) throw new AppException(403, 'FORBIDDEN', 'Only the person who requested it, or the owner, can cancel this');
      const after = await tx.employeeAdvance.update({ where: { id }, data: { status: 'CANCELLED', updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'CANCEL', entityType: 'EMPLOYEE_ADVANCE', entityId: id, entityCode: before.code, locationId: before.location_id, before, after, reason: dto.reason });
      return after;
    });
  }

  /** Disburses the full approved amount; a cash payment also leaves the till so the day's reconciliation isn't short. */
  async pay(ctx: ReqCtx, id: string, dto: PayAdvanceDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await this.loadFor(tx, id, ['APPROVED'], 'pay');
      const date = await this.rules.assertBusinessDate(ctx.user, dto.paidOn ?? todayIST(), 'paidOn');
      await this.rules.assertDayEditable(tx, ctx.user, before.location_id, date);
      const after = await tx.employeeAdvance.update({
        where: { id },
        data: {
          status: 'PAID', paid_amount: before.amount, remaining_amount: before.amount, paid_on: date, payment_mode: dto.paymentMode as any,
          updated_by: ctx.user.id, version: { increment: 1 },
        },
      });
      if (dto.paymentMode === 'CASH') {
        await tx.cashTransaction.create({
          data: {
            location_id: before.location_id, business_date: date, txn_type: 'ADVANCE_PAYMENT', direction: -1, amount: before.amount,
            source_type: 'EMPLOYEE_ADVANCE', source_id: id, description: before.code, source: ctx.source,
            created_by: ctx.user.id, updated_by: ctx.user.id,
          },
        });
      }
      await this.audit.log(tx, ctx, { action: 'STATUS_CHANGE', entityType: 'EMPLOYEE_ADVANCE', entityId: id, entityCode: before.code, locationId: before.location_id, before, after });
      return after;
    });
  }

  /** A direct cash repayment outside payroll (e.g. the employee pays it back before the next salary run). */
  async repay(ctx: ReqCtx, id: string, dto: RepayAdvanceDto) {
    const amount = parseMoney(dto.amount, 'amount', { allowZero: false });
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await this.loadFor(tx, id, ['PAID'], 'record a repayment for');
      if (amount.greaterThan(before.remaining_amount)) throw validation('OVERPAID', 'More than what is still owed', 'amount');
      const recovered = before.recovered_amount.plus(amount);
      const remaining = before.remaining_amount.minus(amount);
      const after = await tx.employeeAdvance.update({
        where: { id },
        data: { recovered_amount: recovered, remaining_amount: remaining, status: remaining.lessThanOrEqualTo(0) ? 'CLOSED' : undefined, updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await tx.advanceRepayment.create({
        data: { advance_id: id, repaid_on: toDate(dto.repaidOn ?? todayIST(), 'repaidOn'), amount, mode: 'CASH', created_by: ctx.user.id, updated_by: ctx.user.id },
      });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'EMPLOYEE_ADVANCE', entityId: id, entityCode: before.code, locationId: before.location_id, before, after });
      return after;
    });
  }

  async list(ctx: ReqCtx, q: ListAdvanceQuery) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const rows = await tx.employeeAdvance.findMany({
        where: {
          ...(q.locationId ? { location_id: q.locationId } : {}), ...(q.employeeId ? { employee_id: q.employeeId } : {}), ...(q.status ? { status: q.status as any } : {}),
        },
        orderBy: [{ request_date: 'desc' }, { created_at: 'desc' }],
      });
      const emps = await tx.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employee_id))] } }, select: { id: true, code: true, full_name: true } });
      return rows.map((r) => ({ ...r, employeeCode: emps.find((e) => e.id === r.employee_id)?.code, employeeName: emps.find((e) => e.id === r.employee_id)?.full_name }));
    });
  }

  async get(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const row = await tx.employeeAdvance.findUnique({ where: { id }, include: { repayments: { orderBy: { repaid_on: 'asc' } } } });
      if (!row) throw notFound('Advance');
      return row;
    });
  }
}
