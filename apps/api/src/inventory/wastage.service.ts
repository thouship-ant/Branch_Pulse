import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AttachmentsService } from '../attachments/attachments.service';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { isAdmin, ReqCtx } from '../common/auth-user';
import { CodesService } from '../common/codes.service';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { D, Dec, parseQty, round2, sum, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { Envelope } from '../common/response';
import { RulesService } from '../common/rules.service';
import { SettingsService } from '../common/settings.service';
import { bucketKeys, bucketStart } from '../expenses/expense-report.service';
import { LedgerService } from './ledger.service';

export const WASTAGE_REASONS = ['SPOILED', 'EXPIRED', 'BURNT', 'DAMAGED', 'EXCESS_PREPARATION', 'STAFF_CONSUMPTION', 'COMPLIMENTARY', 'OTHER'];

export class CreateWastageDto {
  @IsUUID() locationId: string;
  @IsString() businessDate: string;
  @IsUUID() itemId: string;
  @IsString() quantity: string;
  @IsUUID() unitId: string;
  @IsEnum(WASTAGE_REASONS) reason: string;
  @IsOptional() @IsString() @MaxLength(300) reasonNote?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attachmentKeys?: string[];
  @IsOptional() @IsUUID() clientUuid?: string;
  @IsOptional() @IsString() clientCreatedAt?: string;
}
export class WastageActionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class ListWastageQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) page?: number;
  @IsOptional() @Type(() => Number) pageSize?: number;
}
export class WastageSummaryQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() groupBy?: 'day' | 'week' | 'month';
}

/**
 * Wastage: what was thrown away, why, and what it cost. Stock is reduced the moment it is entered (the goods are gone).
 * Approval only decides whether the loss is accepted: a rejected or cancelled entry gives the stock back to the books, so a
 * loss nobody accepts shows up as a shortage at the next physical count.
 */
@Injectable()
export class WastageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly settings: SettingsService,
    private readonly codes: CodesService,
    private readonly attachments: AttachmentsService,
    private readonly ledger: LedgerService,
  ) {}

  async create(ctx: ReqCtx, dto: CreateWastageDto): Promise<Envelope<unknown>> {
    const date = await this.rules.assertBusinessDate(ctx.user, dto.businessDate);
    const qty = parseQty(dto.quantity, 'quantity');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      if (dto.clientUuid) {
        const dup = await tx.wastage.findUnique({ where: { client_uuid: dto.clientUuid } });
        if (dup) return new Envelope(dup, []);
      }
      const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw notFound('Location');
      if (loc.type === 'CENTRAL_OFFICE') throw validation('INVALID_LOCATION', 'Wastage is recorded at a branch or the central warehouse', 'locationId');
      await this.rules.assertDayEditable(tx, ctx.user, dto.locationId, date);
      const item = await tx.inventoryItem.findUnique({ where: { id: dto.itemId } });
      if (!item || item.status !== 'ACTIVE') throw validation('INVALID_ITEM', 'Choose an active item', 'itemId');
      const unit = await tx.unit.findUnique({ where: { id: dto.unitId } });
      if (!unit || (unit.id !== item.base_unit_id && unit.base_unit_id !== item.base_unit_id)) throw validation('INVALID_UNIT', 'This unit does not match the item', 'unitId');
      const base = qty.mul(unit.factor_to_base).toDecimalPlaces(3);
      const cost = await this.ledger.unitCost(tx, dto.locationId, item.id);
      const value = round2(base.mul(cost));

      // a photo is expected for anything of value; a high single loss is flagged
      const photoAbove = D(await this.settings.getNumber('wastage.photo_above'));
      if (value.greaterThan(photoAbove) && !dto.attachmentKeys?.length) throw validation('PHOTO_REQUIRED', `A photo is required for wastage above ${photoAbove.toFixed(0)}`, 'attachmentKeys');
      const warnings: Array<{ code: string; message: string; field?: string }> = [];
      if (value.greaterThan(D(await this.settings.getNumber('wastage.high_single_entry')))) warnings.push({ code: 'HIGH_WASTAGE', message: `High wastage entry: ${item.name_en} worth ${value.toFixed(0)}` });

      const limit = await this.rules.approvalLimit(tx, ctx.user, 'WASTAGE');
      const auto = this.rules.withinLimit(limit, value);
      const row = await tx.wastage.create({
        data: {
          code: await this.codes.next(tx, 'wastage', dto.locationId), location_id: dto.locationId, business_date: date, item_id: item.id, quantity: qty, unit_id: unit.id, base_quantity: base,
          estimated_value: value, reason: dto.reason as any, reason_note: dto.reasonNote?.trim() || null, entered_by: ctx.user.id,
          approval_status: auto ? 'APPROVED' : 'SUBMITTED', approved_by: auto ? ctx.user.id : null, approved_at: auto ? new Date() : null,
          client_uuid: dto.clientUuid, client_created_at: dto.clientCreatedAt ? new Date(dto.clientCreatedAt) : undefined, source: ctx.source, created_by: ctx.user.id, updated_by: ctx.user.id,
        },
      });
      const { balance } = await this.ledger.post(tx, ctx, { locationId: dto.locationId, itemId: item.id, date, type: 'WASTAGE', quantity: base.neg(), unitCost: cost, sourceType: 'WASTAGE', sourceId: row.id });
      if (balance.isNegative()) warnings.push({ code: 'NEGATIVE_STOCK', message: `${item.name_en}: more was written off than the books show in stock` });
      if (dto.attachmentKeys?.length) await this.attachments.register(tx, ctx, { entityType: 'WASTAGE', entityId: row.id, locationId: row.location_id, keys: dto.attachmentKeys });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'WASTAGE', entityId: row.id, entityCode: row.code, locationId: row.location_id, after: row });
      return new Envelope(row, warnings);
    });
  }

  /** Give the stock back to the books (used when an entry is rejected or cancelled). */
  private async giveBack(tx: Tx, ctx: ReqCtx, w: { id: string; location_id: string; item_id: string; base_quantity: Dec }) {
    const original = await tx.inventoryTransaction.findFirst({ where: { source_type: 'WASTAGE', source_id: w.id, txn_type: 'WASTAGE' } });
    if (!original) return;
    await this.ledger.post(tx, ctx, {
      locationId: w.location_id, itemId: w.item_id, date: original.business_date, type: 'WASTAGE', quantity: w.base_quantity, unitCost: original.unit_cost,
      sourceType: 'WASTAGE_REVERSAL', sourceId: w.id, reversalOfId: original.id,
    });
  }

  private async loadFor(tx: Tx, id: string, allowed: string[], verb: string) {
    const w = await tx.wastage.findUnique({ where: { id } });
    if (!w) throw notFound('Wastage');
    if (w.status !== 'ACTIVE' || !allowed.includes(w.approval_status)) throw new AppException(409, 'INVALID_TRANSITION', `Cannot ${verb} wastage that is ${w.status === 'ACTIVE' ? w.approval_status : w.status}`);
    return w;
  }

  async approve(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const w = await this.loadFor(tx, id, ['SUBMITTED'], 'approve');
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'WASTAGE');
      if (!this.rules.withinLimit(limit, w.estimated_value)) throw new AppException(403, 'APPROVAL_LIMIT_EXCEEDED', 'This amount is above your approval limit; ask the owner');
      const after = await tx.wastage.update({ where: { id }, data: { approval_status: 'APPROVED', approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'APPROVE', entityType: 'WASTAGE', entityId: id, entityCode: w.code, locationId: w.location_id, before: w, after });
      return after;
    });
  }

  async reject(ctx: ReqCtx, id: string, dto: WastageActionDto) {
    if (!dto.reason?.trim()) throw validation('REASON_REQUIRED', 'Give a reason for rejecting', 'reason');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const w = await this.loadFor(tx, id, ['SUBMITTED'], 'reject');
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'WASTAGE');
      if (!this.rules.withinLimit(limit, w.estimated_value)) throw new AppException(403, 'APPROVAL_LIMIT_EXCEEDED', 'This amount is above your approval limit; ask the owner');
      const after = await tx.wastage.update({ where: { id }, data: { approval_status: 'REJECTED', rejection_reason: dto.reason, approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.giveBack(tx, ctx, w);
      await this.audit.log(tx, ctx, { action: 'REJECT', entityType: 'WASTAGE', entityId: id, entityCode: w.code, locationId: w.location_id, before: w, after, reason: dto.reason });
      return after;
    });
  }

  async cancel(ctx: ReqCtx, id: string, dto: WastageActionDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const w = await this.loadFor(tx, id, ['SUBMITTED'], 'cancel');
      if (w.entered_by !== ctx.user.id && !isAdmin(ctx.user)) throw new AppException(403, 'FORBIDDEN', 'Only the person who entered it, or the owner, can cancel this entry');
      const after = await tx.wastage.update({ where: { id }, data: { approval_status: 'CANCELLED', status: 'CANCELLED', updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.giveBack(tx, ctx, w);
      await this.audit.log(tx, ctx, { action: 'CANCEL', entityType: 'WASTAGE', entityId: id, entityCode: w.code, locationId: w.location_id, before: w, after, reason: dto.reason });
      return after;
    });
  }

  // ------------------------------------------------------------ read
  async list(ctx: ReqCtx, q: ListWastageQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
    const where: Prisma.WastageWhereInput = {
      ...(q.locationId ? { location_id: q.locationId } : {}), ...(q.itemId ? { item_id: q.itemId } : {}), ...(q.reason ? { reason: q.reason as any } : {}), ...(q.status ? { approval_status: q.status as any } : {}),
      ...(q.from || q.to ? { business_date: { ...(q.from ? { gte: toDate(q.from, 'from') } : {}), ...(q.to ? { lte: toDate(q.to, 'to') } : {}) } } : {}),
    };
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [rows, total, agg] = await Promise.all([
        tx.wastage.findMany({ where, orderBy: [{ business_date: 'desc' }, { created_at: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.wastage.count({ where }),
        tx.wastage.aggregate({ where: { ...where, status: 'ACTIVE', approval_status: { in: ['SUBMITTED', 'APPROVED'] } }, _sum: { estimated_value: true } }),
      ]);
      const uniq = <T,>(xs: Array<T | null | undefined>) => [...new Set(xs.filter((x): x is T => !!x))];
      const [items, units, locs, users, atts] = await Promise.all([
        tx.inventoryItem.findMany({ where: { id: { in: uniq(rows.map((r) => r.item_id)) } }, select: { id: true, code: true, name_en: true, name_ta: true } }),
        tx.unit.findMany(),
        tx.location.findMany({ where: { id: { in: uniq(rows.map((r) => r.location_id)) } }, select: { id: true, code: true, name: true, name_ta: true } }),
        tx.user.findMany({ where: { id: { in: uniq(rows.flatMap((r) => [r.entered_by, r.approved_by])) } }, select: { id: true, full_name: true } }),
        tx.attachment.groupBy({ by: ['entity_id'], where: { entity_type: 'WASTAGE', entity_id: { in: rows.map((r) => r.id) }, status: 'ACTIVE' }, _count: { _all: true } }),
      ]);
      const data = rows.map((r) => ({
        ...r, item_code: items.find((i) => i.id === r.item_id)?.code, item_name: items.find((i) => i.id === r.item_id)?.name_en, item_name_ta: items.find((i) => i.id === r.item_id)?.name_ta,
        unit_code: units.find((u) => u.id === r.unit_id)?.code, location_code: locs.find((l) => l.id === r.location_id)?.code, location_name: locs.find((l) => l.id === r.location_id)?.name,
        location_name_ta: locs.find((l) => l.id === r.location_id)?.name_ta, entered_by_name: users.find((u) => u.id === r.entered_by)?.full_name ?? null,
        approved_by_name: r.approved_by ? users.find((u) => u.id === r.approved_by)?.full_name ?? null : null, receipt_count: atts.find((a) => a.entity_id === r.id)?._count._all ?? 0,
      }));
      return new Envelope(data, [], { page, pageSize, total, totalValue: agg._sum.estimated_value ?? ZERO });
    });
  }

  /** Wastage in a period: total value, by reason / item / branch, and over time. Rejected and cancelled entries are not counted. */
  async summary(ctx: ReqCtx, q: WastageSummaryQuery) {
    const to = q.to ? toDate(q.to, 'to') : toDate(todayIST());
    const from = q.from ? toDate(q.from, 'from') : addDays(to, -29);
    if (from.getTime() > to.getTime()) throw validation('INVALID_RANGE', 'from must be on or before to', 'from');
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 800) throw validation('INVALID_RANGE', 'Choose a range of at most 800 days', 'to');
    const groupBy = q.groupBy && ['day', 'week', 'month'].includes(q.groupBy) ? q.groupBy : days > 120 ? 'month' : days > 45 ? 'week' : 'day';
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const rows = await tx.wastage.groupBy({
        by: ['business_date', 'location_id', 'item_id', 'reason', 'approval_status'],
        where: { status: 'ACTIVE', approval_status: { in: ['SUBMITTED', 'APPROVED'] }, business_date: { gte: from, lte: to }, ...(q.locationId ? { location_id: q.locationId } : {}) },
        _sum: { estimated_value: true }, _count: { _all: true },
      });
      const [items, locs] = await Promise.all([tx.inventoryItem.findMany({ select: { id: true, code: true, name_en: true, name_ta: true } }), tx.location.findMany({ select: { id: true, code: true, name: true, name_ta: true } })]);
      const keys = bucketKeys(from, to, groupBy);
      const bucket = new Map(keys.map((k) => [k, { value: ZERO, count: 0 }]));
      const by = { reason: new Map<string, Dec>(), item: new Map<string, Dec>(), location: new Map<string, Dec>() };
      let total = ZERO, count = 0, pending = ZERO;
      for (const r of rows) {
        const v = D(r._sum.estimated_value ?? 0);
        total = total.plus(v); count += r._count._all;
        const b = bucket.get(bucketStart(r.business_date, groupBy))!; b.value = b.value.plus(v); b.count += r._count._all;
        by.reason.set(r.reason, (by.reason.get(r.reason) ?? ZERO).plus(v));
        by.item.set(r.item_id, (by.item.get(r.item_id) ?? ZERO).plus(v));
        by.location.set(r.location_id, (by.location.get(r.location_id) ?? ZERO).plus(v));
        if (r.approval_status === 'SUBMITTED') pending = pending.plus(v);
      }
      const share = (v: Dec) => (total.isZero() ? null : v.div(total).mul(100).toDecimalPlaces(1).toNumber());
      const rank = (m: Map<string, Dec>) => [...m.entries()].sort((a, b) => b[1].comparedTo(a[1]));
      return {
        from: fmtDate(from), to: fmtDate(to), days, groupBy, totals: { value: total, count, pendingValue: pending },
        buckets: keys.map((k) => ({ start: k, value: bucket.get(k)!.value, count: bucket.get(k)!.count })),
        byReason: rank(by.reason).map(([reason, v]) => ({ reason, value: v, sharePct: share(v) })),
        byItem: rank(by.item).map(([id, v]) => ({ itemId: id, code: items.find((i) => i.id === id)?.code, name: items.find((i) => i.id === id)?.name_en, nameTa: items.find((i) => i.id === id)?.name_ta, value: v, sharePct: share(v) })),
        byLocation: rank(by.location).map(([id, v]) => ({ locationId: id, code: locs.find((l) => l.id === id)?.code, name: locs.find((l) => l.id === id)?.name, nameTa: locs.find((l) => l.id === id)?.name_ta, value: v, sharePct: share(v) })),
      };
    });
  }
}
void sum;
