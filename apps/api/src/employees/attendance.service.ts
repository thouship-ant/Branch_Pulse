import { Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { notFound, validation } from '../common/app-exception';
import { ReqCtx } from '../common/auth-user';
import { toDate } from '../common/dates';
import { D, Dec, parseQty, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { RulesService } from '../common/rules.service';

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'WEEK_OFF', 'HOLIDAY'];

export class MarkAttendanceLineDto {
  @IsUUID() employeeId: string;
  @IsEnum(ATTENDANCE_STATUSES) status: string;
  @IsOptional() @IsString() overtimeHours?: string;
  @IsOptional() @IsString() @MaxLength(300) remarks?: string;
}
export class MarkAttendanceDto {
  @IsUUID() locationId: string;
  @IsString() businessDate: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => MarkAttendanceLineDto) items: MarkAttendanceLineDto[];
}
export class RosterQuery {
  @IsUUID() locationId: string;
  @IsString() date: string;
}
export class AttendanceHistoryQuery {
  @IsUUID() employeeId: string;
  @IsString() from: string;
  @IsString() to: string;
}

export interface MonthTotals {
  workingDays: Dec; presentDays: Dec; leaveDays: Dec; overtimeHours: Dec;
  byStatus: Record<string, number>;
}

/** Daily attendance: present / absent / leave / half-day / week-off / holiday, plus overtime hours on any of them. */
@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService, private readonly rules: RulesService) {}

  /** Every active employee at the branch, with today's mark if there is one, for a checklist-style roster. */
  async roster(ctx: ReqCtx, q: RosterQuery) {
    const date = toDate(q.date, 'date');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [employees, marks] = await Promise.all([
        tx.employee.findMany({ where: { location_id: q.locationId, status: 'ACTIVE' }, orderBy: { code: 'asc' } }),
        tx.attendance.findMany({ where: { location_id: q.locationId, business_date: date } }),
      ]);
      return employees.map((e) => {
        const m = marks.find((x) => x.employee_id === e.id);
        return {
          employeeId: e.id, code: e.code, fullName: e.full_name, jobRole: e.job_role,
          status: m?.status ?? null, overtimeHours: m?.overtime_hours ?? null, remarks: m?.remarks ?? null, markedId: m?.id ?? null,
        };
      });
    });
  }

  /** Marks (or corrects) a whole branch's day in one go: one upsert per employee, keyed by (employee, day). */
  async mark(ctx: ReqCtx, dto: MarkAttendanceDto) {
    const date = await this.rules.assertBusinessDate(ctx.user, dto.businessDate);
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw notFound('Location');
      const ids = dto.items.map((i) => i.employeeId);
      const employees = await tx.employee.findMany({ where: { id: { in: ids }, location_id: dto.locationId, status: 'ACTIVE' } });
      if (employees.length !== new Set(ids).size) throw validation('INVALID_EMPLOYEE', 'One of these employees is not active at this branch', 'items');
      const rows = [];
      for (const line of dto.items) {
        const overtimeHours = line.overtimeHours ? parseQty(line.overtimeHours, 'overtimeHours', { allowZero: true }) : ZERO;
        const row = await tx.attendance.upsert({
          where: { employee_id_business_date: { employee_id: line.employeeId, business_date: date } },
          create: {
            employee_id: line.employeeId, location_id: dto.locationId, business_date: date, status: line.status as any,
            overtime_hours: overtimeHours, remarks: line.remarks?.trim() || null, marked_by: ctx.user.id, source: ctx.source,
            created_by: ctx.user.id, updated_by: ctx.user.id,
          },
          update: {
            status: line.status as any, overtime_hours: overtimeHours, remarks: line.remarks?.trim() || null,
            marked_by: ctx.user.id, updated_by: ctx.user.id, version: { increment: 1 },
          },
        });
        rows.push(row);
      }
      return rows;
    });
  }

  async history(ctx: ReqCtx, q: AttendanceHistoryQuery) {
    const from = toDate(q.from, 'from');
    const to = toDate(q.to, 'to');
    return this.prisma.runScoped(ctx.user, (tx) =>
      tx.attendance.findMany({ where: { employee_id: q.employeeId, business_date: { gte: from, lte: to } }, orderBy: { business_date: 'asc' } }),
    );
  }

  /** Present/half-day/leave/overtime totals for one employee over a date range - the input salary computation needs. */
  async monthTotals(tx: Tx, employeeId: string, from: Date, to: Date): Promise<MonthTotals> {
    const rows = await tx.attendance.findMany({ where: { employee_id: employeeId, business_date: { gte: from, lte: to } } });
    const byStatus: Record<string, number> = {};
    let overtimeHours = D(0);
    for (const r of rows) { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; overtimeHours = overtimeHours.plus(r.overtime_hours); }
    const calendarDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    const workingDays = D(calendarDays - (byStatus.WEEK_OFF ?? 0) - (byStatus.HOLIDAY ?? 0));
    const presentDays = D((byStatus.PRESENT ?? 0) + (byStatus.HALF_DAY ?? 0) * 0.5);
    const leaveDays = D(byStatus.LEAVE ?? 0);
    return { workingDays, presentDays, leaveDays, overtimeHours, byStatus };
  }
}
