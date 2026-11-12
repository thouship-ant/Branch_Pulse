import { Injectable } from '@nestjs/common';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx, can, canAccessLocation } from '../common/auth-user';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { PushService } from '../push/push.service';

export class CreateBackdateDto {
  @IsUUID() locationId: string;
  @IsDateString() businessDate: string;
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class DecideBackdateDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * A day that was not closed by the cut-off (23:30) is locked for entry. The Branch Admin / Admin who missed it asks for it to be
 * opened; an Admin approves, and the entries for that day can then be made.
 */
@Injectable()
export class BackdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly push: PushService,
  ) {}

  private view(r: any, extra: Record<string, unknown> = {}) {
    return { ...r, ...extra };
  }

  /** The past days (last 14) of a branch that were never submitted, each with the state of its request, if any. */
  async eligible(ctx: ReqCtx, locationId: string) {
    if (!canAccessLocation(ctx.user, locationId)) throw new AppException(403, 'FORBIDDEN', 'This is not your branch');
    const today = toDate(todayIST());
    const from = addDays(today, -14);
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: locationId }, select: { opened_on: true } });
      const [closings, requests] = await Promise.all([
        tx.dailyClosing.findMany({ where: { location_id: locationId, business_date: { gte: from, lt: today } }, select: { business_date: true, status: true } }),
        tx.backdateRequest.findMany({ where: { location_id: locationId, business_date: { gte: from, lt: today } }, orderBy: { created_at: 'desc' } }),
      ]);
      const out: Array<{ date: string; request: unknown }> = [];
      for (let d = addDays(today, -1); d.getTime() >= from.getTime(); d = addDays(d, -1)) {
        if (loc?.opened_on && d.getTime() < loc.opened_on.getTime()) continue;
        const c = closings.find((x) => x.business_date.getTime() === d.getTime());
        if (c && c.status !== 'PENDING') continue; // submitted / approved / rejected: the normal flow covers it
        const r = requests.find((x) => x.business_date.getTime() === d.getTime());
        out.push({ date: fmtDate(d), request: r ? { id: r.id, status: r.status, reason: r.reason, decisionNote: r.decision_note } : null });
      }
      return out;
    });
  }

  async create(ctx: ReqCtx, dto: CreateBackdateDto) {
    if (!canAccessLocation(ctx.user, dto.locationId)) throw new AppException(403, 'FORBIDDEN', 'This is not your branch');
    const today = toDate(todayIST());
    const date = toDate(dto.businessDate, 'businessDate');
    if (date.getTime() >= today.getTime()) throw validation('INVALID_DATE', 'Choose a day before today', 'businessDate');
    const maxBack = Number(await this.settings.getNumber('entry.backdate_days')) + 11; // a request may reach a little beyond the usual window
    if (date.getTime() < addDays(today, -maxBack).getTime()) throw validation('DATE_OUT_OF_RANGE', 'That day is too far back', 'businessDate');
    const out = await this.prisma.runScoped(ctx.user, async (tx) => {
      const closing = await tx.dailyClosing.findUnique({ where: { location_id_business_date: { location_id: dto.locationId, business_date: date } }, select: { status: true } });
      if (closing && closing.status !== 'PENDING') throw new AppException(409, 'NOT_NEEDED', 'This day was already submitted, so no request is needed');
      const open = await tx.backdateRequest.findFirst({ where: { location_id: dto.locationId, business_date: date, status: { in: ['PENDING', 'APPROVED'] } } });
      if (open) throw new AppException(409, 'DUPLICATE', open.status === 'APPROVED' ? 'This day is already open for entry' : 'A request for this day is already waiting');
      const r = await tx.backdateRequest.create({ data: { location_id: dto.locationId, business_date: date, requested_by: ctx.user.id, reason: dto.reason.trim() } });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'BACKDATE_REQUEST', entityId: r.id, locationId: r.location_id, after: r, reason: r.reason });
      return r;
    });
    this.push.backdateRequested(ctx, out);
    return this.view(out);
  }

  /** Approvers see every request of their branches; everyone else sees their own. */
  async list(ctx: ReqCtx, status?: string) {
    const approver = can(ctx.user, 'closing:reopen');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const rows = await tx.backdateRequest.findMany({
        where: { ...(status ? { status } : {}), ...(approver ? {} : { requested_by: ctx.user.id }) },
        orderBy: [{ created_at: 'desc' }],
        take: 200,
      });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by].filter((x): x is string => !!x)))] } }, select: { id: true, username: true, full_name: true } });
      const locs = await tx.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.location_id))] } }, select: { id: true, code: true, name: true, name_ta: true } });
      return rows.map((r) => this.view(r, {
        requested_by_name: users.find((u) => u.id === r.requested_by)?.full_name, requested_by_username: users.find((u) => u.id === r.requested_by)?.username,
        decided_by_username: users.find((u) => u.id === r.decided_by)?.username,
        location_name: locs.find((l) => l.id === r.location_id)?.name, location_name_ta: locs.find((l) => l.id === r.location_id)?.name_ta, location_code: locs.find((l) => l.id === r.location_id)?.code,
      }));
    });
  }

  async decide(ctx: ReqCtx, id: string, approve: boolean, dto: DecideBackdateDto) {
    if (!approve && !dto.note?.trim()) throw validation('NOTE_REQUIRED', 'Say why the request is rejected', 'note');
    const out = await this.prisma.runScoped(ctx.user, async (tx) => {
      const r = await tx.backdateRequest.findUnique({ where: { id } });
      if (!r) throw notFound('Request');
      if (r.status !== 'PENDING') throw new AppException(409, 'INVALID_TRANSITION', `This request is already ${r.status.toLowerCase()}`);
      if (r.requested_by === ctx.user.id) {
        // nobody approves their own request - unless they are the company's only Admin, who would otherwise be stuck
        const others = await tx.user.count({ where: { id: { not: ctx.user.id }, status: 'ACTIVE', roles: { some: { role: { code: 'ADMIN', status: 'ACTIVE' } } } } });
        if (others > 0) throw new AppException(403, 'SELF_APPROVAL', 'Another Admin has to approve your own request');
      }
      const after = await tx.backdateRequest.update({
        where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decided_by: ctx.user.id, decided_at: new Date(), decision_note: dto.note?.trim() || null },
      });
      await this.audit.log(tx, ctx, { action: approve ? 'APPROVE' : 'REJECT', entityType: 'BACKDATE_REQUEST', entityId: id, locationId: r.location_id, before: r, after, reason: dto.note });
      return after;
    });
    this.push.backdateDecided(ctx, out);
    return this.view(out);
  }
}
