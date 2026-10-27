import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AppException, forbiddenLocation, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { can, canAccessLocation, isAdmin, ReqCtx } from '../common/auth-user';
import { CodesService } from '../common/codes.service';
import { toDate } from '../common/dates';
import { D, Dec, parseQty, round2, sum, ZERO } from '../common/money';
import { PrismaService, SYSTEM_SCOPE, Tx } from '../common/prisma.service';
import { RulesService } from '../common/rules.service';
import { LedgerService } from './ledger.service';

export class TransferLineDto {
  @IsUUID() itemId: string;
  @IsString() quantity: string;
  @IsUUID() unitId: string;
}
export class CreateTransferDto {
  @IsUUID() fromLocationId: string;
  @IsUUID() toLocationId: string;
  @IsString() businessDate: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => TransferLineDto) items: TransferLineDto[];
  @IsOptional() @IsString() @MaxLength(40) vehicleRef?: string;
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}
export class ReceiveLineDto {
  @IsUUID() itemId: string;
  @IsString() receivedQty: string; // in the item's stock unit; at most what was sent
  @IsOptional() @IsString() @MaxLength(40) reason?: string;
}
export class ReceiveTransferDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) items?: ReceiveLineDto[]; // omitted = everything arrived
}
export class TransferActionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class ListTransfersQuery {
  @IsOptional() @IsUUID() locationId?: string; // sent from or received at
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

/**
 * Stock transfers between the warehouse and branches: requested -> approved -> dispatched (stock leaves the sender) -> received
 * (stock reaches the receiver; anything short is recorded as lost in transit with a reason). Both ends see the same document.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly codes: CodesService,
    private readonly ledger: LedgerService,
  ) {}

  async create(ctx: ReqCtx, dto: CreateTransferDto) {
    const date = await this.rules.assertBusinessDate(ctx.user, dto.businessDate);
    if (dto.fromLocationId === dto.toLocationId) throw validation('SAME_LOCATION', 'Choose two different places', 'toLocationId');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      for (const [field, id] of [['fromLocationId', dto.fromLocationId], ['toLocationId', dto.toLocationId]] as const) {
        const l = await tx.location.findUnique({ where: { id } });
        if (!l || l.status !== 'ACTIVE') throw notFound('Location');
        if (l.type === 'CENTRAL_OFFICE') throw validation('INVALID_LOCATION', 'Stock moves between branches and the warehouse', field);
      }
      const items = await tx.inventoryItem.findMany({ where: { id: { in: dto.items.map((i) => i.itemId) }, status: 'ACTIVE' } });
      const units = await tx.unit.findMany();
      const lines = new Map<string, Dec>();
      for (const [i, l] of dto.items.entries()) {
        const item = items.find((x) => x.id === l.itemId);
        if (!item) throw validation('INVALID_ITEM', 'Choose active items', `items.${i}.itemId`);
        const unit = units.find((u) => u.id === l.unitId);
        if (!unit || (unit.id !== item.base_unit_id && unit.base_unit_id !== item.base_unit_id)) throw validation('INVALID_UNIT', `${item.name_en}: this unit does not match the item`, `items.${i}.unitId`);
        const base = parseQty(l.quantity, `items.${i}.quantity`).mul(unit.factor_to_base).toDecimalPlaces(3);
        lines.set(item.id, (lines.get(item.id) ?? ZERO).plus(base));
      }
      const approved = can(ctx.user, 'transfer:approve');
      const row = await tx.stockTransfer.create({
        data: {
          code: await this.codes.next(tx, 'transfer'), from_location_id: dto.fromLocationId, to_location_id: dto.toLocationId, business_date: date,
          status: approved ? 'APPROVED' : 'PENDING_APPROVAL', requested_by: ctx.user.id, approved_by: approved ? ctx.user.id : null, approved_at: approved ? new Date() : null,
          vehicle_ref: dto.vehicleRef?.trim() || null, remarks: dto.remarks?.trim() || null, created_by: ctx.user.id, updated_by: ctx.user.id,
          items: { create: [...lines.entries()].map(([item_id, sent_qty]) => ({ item_id, sent_qty })) },
        },
        include: { items: true },
      });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'STOCK_TRANSFER', entityId: row.id, entityCode: row.code, locationId: row.from_location_id, after: row });
      return row;
    });
  }

  private async load(tx: Tx, id: string) {
    const t = await tx.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!t) throw notFound('Transfer');
    return t;
  }
  private assertStatus(t: { status: string }, allowed: string[], verb: string) {
    if (!allowed.includes(t.status)) throw new AppException(409, 'INVALID_TRANSITION', `Cannot ${verb} a transfer that is ${t.status.toLowerCase().replace(/_/g, ' ')}`);
  }

  async approve(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const t = await this.load(tx, id);
      this.assertStatus(t, ['PENDING_APPROVAL'], 'approve');
      const after = await tx.stockTransfer.update({ where: { id }, data: { status: 'APPROVED', approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'APPROVE', entityType: 'STOCK_TRANSFER', entityId: id, entityCode: t.code, locationId: t.from_location_id, before: { status: t.status }, after: { status: after.status } });
      return after;
    });
  }

  /** The stock leaves the sender now (TRANSFER_OUT at its average cost) and is on the way to the receiver. */
  async dispatch(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const t = await this.load(tx, id);
      this.assertStatus(t, ['APPROVED'], 'dispatch');
      if (!canAccessLocation(ctx.user, t.from_location_id)) throw forbiddenLocation();
      const date = toDate(t.business_date.toISOString().slice(0, 10));
      for (const it of t.items) {
        const bal = await tx.stockBalance.findUnique({ where: { location_id_item_id: { location_id: t.from_location_id, item_id: it.item_id } } });
        if (!bal || bal.quantity.lessThan(it.sent_qty)) {
          const item = await tx.inventoryItem.findUnique({ where: { id: it.item_id }, select: { name_en: true } });
          throw new AppException(409, 'STOCK_INSUFFICIENT', `Not enough ${item?.name_en ?? 'stock'} to send`);
        }
      }
      for (const it of t.items) {
        const cost = await this.ledger.unitCost(tx, t.from_location_id, it.item_id);
        await this.ledger.post(tx, ctx, { locationId: t.from_location_id, itemId: it.item_id, date, type: 'TRANSFER_OUT', quantity: it.sent_qty.neg(), unitCost: cost, sourceType: 'TRANSFER', sourceId: t.id, counterpartyLocationId: t.to_location_id });
        await tx.stockTransferItem.update({ where: { id: it.id }, data: { unit_cost: cost } });
        await tx.$executeRaw`
          INSERT INTO stock_balances (location_id, item_id, quantity, avg_cost, value, in_transit_in, version)
          VALUES (${t.to_location_id}::uuid, ${it.item_id}::uuid, 0, 0, 0, ${it.sent_qty.toString()}::numeric, 1)
          ON CONFLICT (location_id, item_id) DO UPDATE SET in_transit_in = stock_balances.in_transit_in + EXCLUDED.in_transit_in`;
      }
      const after = await tx.stockTransfer.update({ where: { id }, data: { status: 'DISPATCHED', dispatched_by: ctx.user.id, dispatched_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'STATUS_CHANGE', entityType: 'STOCK_TRANSFER', entityId: id, entityCode: t.code, locationId: t.from_location_id, before: { status: t.status }, after: { status: after.status } });
      return after;
    });
  }

  /** The receiver confirms what arrived. Anything short needs a reason and counts as lost in transit. */
  async receive(ctx: ReqCtx, id: string, dto: ReceiveTransferDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const t = await this.load(tx, id);
      this.assertStatus(t, ['DISPATCHED'], 'receive');
      if (!canAccessLocation(ctx.user, t.to_location_id)) throw forbiddenLocation();
      const date = toDate(t.business_date.toISOString().slice(0, 10));
      const asked = new Map((dto.items ?? []).map((l, i) => [l.itemId, { qty: parseQty(l.receivedQty, `items.${i}.receivedQty`, { allowZero: true }), reason: l.reason?.trim() }]));
      for (const k of asked.keys()) if (!t.items.some((i) => i.item_id === k)) throw validation('INVALID_ITEM', 'That item is not on this transfer', 'items');
      let short = false;
      for (const it of t.items) {
        const got = asked.get(it.item_id);
        const qty = got ? got.qty : it.sent_qty;
        if (qty.greaterThan(it.sent_qty)) throw validation('RECEIVED_MORE', 'More than was sent cannot be received; record the extra as a purchase', 'items');
        const lost = it.sent_qty.minus(qty);
        if (lost.greaterThan(0)) {
          short = true;
          if (!got?.reason) throw validation('REASON_REQUIRED', 'Give a reason for the quantity that did not arrive', 'items');
        }
        const cost = it.unit_cost ?? ZERO;
        if (qty.greaterThan(0)) {
          await this.ledger.post(tx, ctx, { locationId: t.to_location_id, itemId: it.item_id, date, type: 'TRANSFER_IN', quantity: qty, unitCost: cost, sourceType: 'TRANSFER', sourceId: t.id, counterpartyLocationId: t.from_location_id });
        }
        await tx.stockTransferItem.update({ where: { id: it.id }, data: { received_qty: qty, variance_reason: lost.greaterThan(0) ? got?.reason ?? null : null } });
        await tx.$executeRaw`UPDATE stock_balances SET in_transit_in = greatest(in_transit_in - ${it.sent_qty.toString()}::numeric, 0) WHERE location_id = ${t.to_location_id}::uuid AND item_id = ${it.item_id}::uuid`;
      }
      const after = await tx.stockTransfer.update({ where: { id }, data: { status: short ? 'PARTIALLY_RECEIVED' : 'RECEIVED', received_by: ctx.user.id, received_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'STATUS_CHANGE', entityType: 'STOCK_TRANSFER', entityId: id, entityCode: t.code, locationId: t.to_location_id, before: { status: t.status }, after: { status: after.status } });
      return after;
    });
  }

  /** Before dispatch only: nothing has moved yet. */
  async cancel(ctx: ReqCtx, id: string, dto: TransferActionDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const t = await this.load(tx, id);
      this.assertStatus(t, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'], 'cancel');
      if (t.requested_by !== ctx.user.id && !can(ctx.user, 'transfer:approve') && !isAdmin(ctx.user)) throw new AppException(403, 'FORBIDDEN', 'Only the requester or an approver can cancel this transfer');
      const after = await tx.stockTransfer.update({ where: { id }, data: { status: 'CANCELLED', remarks: dto.reason ? `${t.remarks ? `${t.remarks} · ` : ''}Cancelled: ${dto.reason}` : t.remarks, updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'CANCEL', entityType: 'STOCK_TRANSFER', entityId: id, entityCode: t.code, locationId: t.from_location_id, before: { status: t.status }, after: { status: after.status }, reason: dto.reason });
      return after;
    });
  }

  // ------------------------------------------------------------ read
  async list(ctx: ReqCtx, q: ListTransfersQuery) {
    const where: Prisma.StockTransferWhereInput = {
      ...(q.locationId ? { OR: [{ from_location_id: q.locationId }, { to_location_id: q.locationId }] } : {}), ...(q.status ? { status: q.status as any } : {}),
      ...(q.from || q.to ? { business_date: { ...(q.from ? { gte: toDate(q.from, 'from') } : {}), ...(q.to ? { lte: toDate(q.to, 'to') } : {}) } } : {}),
    };
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const rows = await tx.stockTransfer.findMany({ where, include: { items: true }, orderBy: [{ business_date: 'desc' }, { created_at: 'desc' }], take: 100 });
      return this.decorate(tx, rows);
    });
  }

  async get(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => (await this.decorate(tx, [await this.load(tx, id)]))[0]);
  }

  private async decorate(tx: Tx, rows: Array<Prisma.StockTransferGetPayload<{ include: { items: true } }>>) {
    const uniq = <T,>(xs: Array<T | null | undefined>) => [...new Set(xs.filter((x): x is T => !!x))];
    // both ends of a transfer are named for everyone who can see it, even when the other end is outside their own location scope
    const locs = await this.prisma.runScoped(SYSTEM_SCOPE, (sys) =>
      sys.location.findMany({ where: { id: { in: uniq(rows.flatMap((r) => [r.from_location_id, r.to_location_id])) } }, select: { id: true, code: true, name: true, name_ta: true } }));
    const [items, units, users] = await Promise.all([
      tx.inventoryItem.findMany({ where: { id: { in: uniq(rows.flatMap((r) => r.items.map((i) => i.item_id))) } }, select: { id: true, code: true, name_en: true, name_ta: true, base_unit_id: true, purchase_unit_id: true } }),
      tx.unit.findMany(),
      tx.user.findMany({ where: { id: { in: uniq(rows.flatMap((r) => [r.requested_by, r.approved_by, r.dispatched_by, r.received_by])) } }, select: { id: true, full_name: true } }),
    ]);
    const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.full_name ?? null : null);
    return rows.map((r) => ({
      ...r,
      from_location_code: locs.find((l) => l.id === r.from_location_id)?.code, from_location_name: locs.find((l) => l.id === r.from_location_id)?.name, from_location_name_ta: locs.find((l) => l.id === r.from_location_id)?.name_ta,
      to_location_code: locs.find((l) => l.id === r.to_location_id)?.code, to_location_name: locs.find((l) => l.id === r.to_location_id)?.name, to_location_name_ta: locs.find((l) => l.id === r.to_location_id)?.name_ta,
      requested_by_name: name(r.requested_by), approved_by_name: name(r.approved_by), dispatched_by_name: name(r.dispatched_by), received_by_name: name(r.received_by),
      lost_value: round2(sum(r.items.map((i) => (i.received_qty === null ? ZERO : i.sent_qty.minus(i.received_qty).mul(i.unit_cost ?? ZERO))))),
      items: r.items.map((i) => {
        const item = items.find((x) => x.id === i.item_id);
        const pu = units.find((u) => u.id === item?.purchase_unit_id);
        const convertible = pu && (pu.id === item?.base_unit_id || pu.base_unit_id === item?.base_unit_id);
        return {
          ...i, item_code: item?.code, item_name: item?.name_en, item_name_ta: item?.name_ta, unit_code: units.find((u) => u.id === item?.base_unit_id)?.code,
          display_unit: convertible ? pu!.code : units.find((u) => u.id === item?.base_unit_id)?.code, display_factor: convertible ? pu!.factor_to_base : D(1),
        };
      }),
    }));
  }
}
