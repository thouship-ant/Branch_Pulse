import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AttachmentsService } from '../attachments/attachments.service';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { isAdmin, ReqCtx } from '../common/auth-user';
import { CodesService } from '../common/codes.service';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { D, Dec, MONEY_PATTERN, parseMoney, parseMoneyOr0, parseQty, round2, sum, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { Envelope } from '../common/response';
import { RulesService } from '../common/rules.service';
import { SettingsService } from '../common/settings.service';
import { bucketKeys, bucketStart } from '../expenses/expense-report.service';
import { LedgerService } from '../inventory/ledger.service';

export const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT'];
const RATE_RE = /^\d{1,8}(\.\d{1,4})?$/;

export class PurchaseLineDto {
  @IsUUID() itemId: string;
  @IsString() quantity: string;
  @IsUUID() unitId: string;
  @Matches(RATE_RE) rate: string;
}

export class CreatePurchaseDto {
  @IsUUID() locationId: string;
  @IsString() businessDate: string;
  @IsUUID() supplierId: string;
  @IsOptional() @IsString() @MaxLength(40) supplierRefNo?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PurchaseLineDto) items: PurchaseLineDto[];
  @IsOptional() @Matches(MONEY_PATTERN) otherCharges?: string;
  @IsOptional() @Matches(MONEY_PATTERN) discount?: string;
  @IsEnum(PAYMENT_MODES) paymentMode: string;
  @IsOptional() @Matches(MONEY_PATTERN) paidAmount?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attachmentKeys?: string[];
  @IsOptional() @IsUUID() clientUuid?: string;
  @IsOptional() @IsString() clientCreatedAt?: string;
}

export class PurchaseActionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ListPurchasesQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() status?: string; // approval status
  @IsOptional() @IsString() settlement?: string; // 'open' = still owes something, 'settled' = paid in full
  @IsOptional() @IsEnum(PAYMENT_MODES) paymentMode?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) page?: number;
  @IsOptional() @Type(() => Number) pageSize?: number;
}

export class PurchaseSummaryQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() groupBy?: 'day' | 'week' | 'month';
}

type Warning = { code: string; message: string; field?: string };
type Line = { itemId: string; unitId: string; quantity: Dec; baseQuantity: Dec; rate: Dec; lineTotal: Dec };

/** Spread other charges less discount over the lines by value, so stock is costed at landed cost and the parts add up exactly. */
export function landedValues(lineTotals: Dec[], extra: Dec): Dec[] {
  const subtotal = sum(lineTotals);
  let left = extra;
  return lineTotals.map((lt, i) => {
    const share = i === lineTotals.length - 1 || subtotal.isZero() ? left : round2(extra.mul(lt).div(subtotal));
    left = left.minus(share);
    return lt.plus(share);
  });
}

/**
 * Purchase management (no billing): a purchase records what was bought, from whom, what was paid now and what is left on credit.
 * Approval is what moves stock: it posts PURCHASE_IN to the location's inventory (weighted-average cost) and the purchase and
 * any payment to the supplier ledger. Cash paid leaves the till when the purchase is entered, like an expense.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly settings: SettingsService,
    private readonly codes: CodesService,
    private readonly attachments: AttachmentsService,
    private readonly ledger: LedgerService,
  ) {}

  // ------------------------------------------------------------ create
  async create(ctx: ReqCtx, dto: CreatePurchaseDto): Promise<Envelope<unknown>> {
    const date = await this.rules.assertBusinessDate(ctx.user, dto.businessDate);
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw validation('ITEMS_REQUIRED', 'Add at least one item', 'items');
    if (dto.items.length > 50) throw validation('TOO_MANY_ITEMS', 'At most 50 items per purchase', 'items');
    if (!PAYMENT_MODES.includes(dto.paymentMode)) throw validation('INVALID_MODE', 'Choose a payment mode', 'paymentMode');
    const other = parseMoneyOr0(dto.otherCharges, 'otherCharges');
    const discount = parseMoneyOr0(dto.discount, 'discount');

    return this.prisma.runScoped(ctx.user, async (tx) => {
      if (dto.clientUuid) {
        const dup = await tx.purchase.findUnique({ where: { client_uuid: dto.clientUuid } });
        if (dup) return new Envelope(dup, []);
      }
      const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw notFound('Location');
      if (loc.type === 'CENTRAL_OFFICE') throw validation('INVALID_LOCATION', 'Purchases are received at a branch or the central warehouse', 'locationId');
      await this.rules.assertDayEditable(tx, ctx.user, dto.locationId, date);
      const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier || supplier.status !== 'ACTIVE') throw validation('INVALID_SUPPLIER', 'Choose an active supplier', 'supplierId');

      // lines: item + unit must belong together; the base quantity is what stock moves by
      const items = await tx.inventoryItem.findMany({ where: { id: { in: dto.items.map((l) => l.itemId) } } });
      const units = await tx.unit.findMany();
      const lines: Line[] = dto.items.map((l, i) => {
        const item = items.find((x) => x.id === l.itemId);
        if (!item || item.status !== 'ACTIVE') throw validation('INVALID_ITEM', 'Choose an active item', `items.${i}.itemId`);
        const unit = units.find((u) => u.id === l.unitId);
        if (!unit || (unit.id !== item.base_unit_id && unit.base_unit_id !== item.base_unit_id)) {
          throw validation('INVALID_UNIT', `${item.name_en}: this unit does not match the item's unit`, `items.${i}.unitId`);
        }
        const quantity = parseQty(l.quantity, `items.${i}.quantity`);
        if (typeof l.rate !== 'string' || !RATE_RE.test(l.rate)) throw validation('INVALID_AMOUNT', 'Rate: up to 4 decimals', `items.${i}.rate`);
        const rate = D(l.rate);
        return {
          itemId: item.id, unitId: unit.id, quantity, rate,
          baseQuantity: quantity.mul(unit.factor_to_base).toDecimalPlaces(3),
          lineTotal: round2(quantity.mul(rate)),
        };
      });
      const subtotal = sum(lines.map((l) => l.lineTotal));
      if (discount.greaterThan(subtotal.plus(other))) throw validation('INVALID_AMOUNT', 'Discount is more than the purchase', 'discount');
      const total = subtotal.plus(other).minus(discount);
      if (total.lessThanOrEqualTo(0)) throw validation('INVALID_AMOUNT', 'The purchase total must be above zero', 'items');

      // payment: cash / credit / part payment. Credit = what is left after the amount paid now.
      let paid: Dec;
      if (dto.paymentMode === 'CREDIT') {
        paid = parseMoneyOr0(dto.paidAmount, 'paidAmount');
        if (paid.greaterThan(0)) throw validation('PAID_WITH_CREDIT', 'For a part payment choose how it was paid (cash, UPI ...); credit is the rest', 'paymentMode');
      } else {
        paid = dto.paidAmount === undefined || dto.paidAmount === null || dto.paidAmount === '' ? total : parseMoney(dto.paidAmount, 'paidAmount', { allowZero: false });
        if (paid.greaterThan(total)) throw validation('OVERPAID', 'The amount paid is more than the total', 'paidAmount');
      }
      const credit = total.minus(paid);
      let due: Date | null = null;
      if (credit.greaterThan(0)) {
        due = dto.dueDate ? toDate(dto.dueDate, 'dueDate') : supplier.payment_terms_days > 0 ? new Date(date.getTime() + supplier.payment_terms_days * 86_400_000) : null;
        if (!due) throw validation('DUE_DATE_REQUIRED', 'Give the date the credit is due', 'dueDate');
        if (due.getTime() < date.getTime()) throw validation('INVALID_DATE', 'The due date cannot be before the purchase date', 'dueDate');
      }

      const warnings = await this.softWarnings(tx, dto, items, lines, supplier.id);
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'PURCHASE');
      const auto = this.rules.withinLimit(limit, total);

      const code = await this.codes.next(tx, 'purchase', dto.locationId);
      const row = await tx.purchase.create({
        data: {
          code, location_id: dto.locationId, business_date: date, supplier_id: supplier.id, supplier_ref_no: dto.supplierRefNo?.trim() || null,
          subtotal, other_charges: other, discount, total_amount: total, payment_mode: dto.paymentMode as any,
          paid_amount: paid, credit_amount: credit, due_date: due, remarks: dto.remarks?.trim() || null,
          approval_status: auto ? 'APPROVED' : 'SUBMITTED', approved_by: auto ? ctx.user.id : null, approved_at: auto ? new Date() : null,
          entered_by: ctx.user.id, client_uuid: dto.clientUuid, client_created_at: dto.clientCreatedAt ? new Date(dto.clientCreatedAt) : undefined,
          source: ctx.source, created_by: ctx.user.id, updated_by: ctx.user.id,
          items: {
            create: lines.map((l, i) => ({
              item_id: l.itemId, line_no: i + 1, quantity: l.quantity, unit_id: l.unitId, base_quantity: l.baseQuantity, rate: l.rate, line_total: l.lineTotal,
            })),
          },
        },
        include: { items: true },
      });

      // cash paid leaves the till now, whether or not the purchase is approved yet
      if (dto.paymentMode === 'CASH' && paid.greaterThan(0)) {
        await tx.cashTransaction.create({
          data: {
            location_id: row.location_id, business_date: date, txn_type: 'PURCHASE', direction: -1, amount: paid,
            source_type: 'PURCHASE', source_id: row.id, description: row.code, source: ctx.source, created_by: ctx.user.id, updated_by: ctx.user.id,
          },
        });
      }
      if (dto.attachmentKeys?.length) {
        await this.attachments.register(tx, ctx, { entityType: 'PURCHASE', entityId: row.id, locationId: row.location_id, keys: dto.attachmentKeys });
      }
      if (auto) await this.postApproved(tx, ctx, row);
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'PURCHASE', entityId: row.id, entityCode: row.code, locationId: row.location_id, after: row });
      return new Envelope(row, warnings);
    });
  }

  /** Soft checks: the purchase still saves. Unusual rate, no invoice attached, same supplier reference used before. */
  private async softWarnings(
    tx: Tx, dto: CreatePurchaseDto, items: Array<{ id: string; name_en: string; last_purchase_rate: Dec | null }>, lines: Line[], supplierId: string,
  ): Promise<Warning[]> {
    const warnings: Warning[] = [];
    const pct = D(await this.settings.getNumber('purchase.rate_deviation_pct'));
    lines.forEach((l, i) => {
      const item = items.find((x) => x.id === l.itemId)!;
      if (!item.last_purchase_rate || item.last_purchase_rate.isZero() || l.baseQuantity.isZero()) return;
      // compare price per base unit: rate per purchase unit / units-in-base
      const perBase = l.rate.mul(l.quantity).div(l.baseQuantity);
      const diff = perBase.minus(item.last_purchase_rate).div(item.last_purchase_rate).mul(100);
      if (diff.abs().greaterThan(pct)) {
        warnings.push({
          code: 'RATE_DEVIATION', field: `items.${i}.rate`,
          message: `${item.name_en}: rate is ${diff.abs().toFixed(0)}% ${diff.isPositive() ? 'above' : 'below'} the last purchase rate`,
        });
      }
    });
    if (!dto.attachmentKeys?.length) warnings.push({ code: 'NO_INVOICE', message: 'No invoice or receipt photo attached', field: 'attachmentKeys' });
    if (dto.supplierRefNo?.trim()) {
      const dup = await tx.purchase.findFirst({ where: { supplier_id: supplierId, supplier_ref_no: dto.supplierRefNo.trim(), status: 'ACTIVE', approval_status: { in: ['SUBMITTED', 'APPROVED'] } } });
      if (dup) warnings.push({ code: 'DUPLICATE_REF', message: `Supplier reference ${dto.supplierRefNo.trim()} was already used on ${dup.code}`, field: 'supplierRefNo' });
    }
    return warnings;
  }

  // ------------------------------------------------------------ posting on approval
  /** Stock in at landed cost, then the supplier ledger: the purchase (owed) and whatever was paid with it. */
  private async postApproved(tx: Tx, ctx: ReqCtx, p: { id: string; code: string; location_id: string; business_date: Date; supplier_id: string; total_amount: Dec; subtotal: Dec; other_charges: Dec; discount: Dec; paid_amount: Dec; due_date: Date | null; items: Array<{ item_id: string; unit_id: string; quantity: Dec; base_quantity: Dec; rate: Dec; line_total: Dec }> }) {
    const values = landedValues(p.items.map((i) => i.line_total), p.other_charges.minus(p.discount));
    for (const [idx, it] of p.items.entries()) {
      const value = values[idx];
      const unitCost = it.base_quantity.isZero() ? ZERO : value.div(it.base_quantity).toDecimalPlaces(4);
      const balance = await this.moveStock(tx, p.location_id, it.item_id, it.base_quantity, value, unitCost);
      await tx.inventoryTransaction.create({
        data: {
          location_id: p.location_id, item_id: it.item_id, business_date: p.business_date, txn_type: 'PURCHASE_IN', quantity: it.base_quantity,
          unit_cost: unitCost, value, balance_after: balance, source_type: 'PURCHASE', source_id: p.id, created_by: ctx.user.id,
        },
      });
      // price per base unit of the item, before other charges: what the next purchase is compared with
      await tx.inventoryItem.update({
        where: { id: it.item_id },
        data: { last_purchase_rate: it.line_total.div(it.base_quantity).toDecimalPlaces(4), updated_by: ctx.user.id },
      });
    }
    // what was bought from them is what they supply
    await tx.supplierItem.createMany({ data: p.items.map((i) => ({ supplier_id: p.supplier_id, item_id: i.item_id })), skipDuplicates: true });
    await tx.supplierLedger.create({
      data: {
        supplier_id: p.supplier_id, entry_date: p.business_date, entry_type: 'PURCHASE', debit: p.total_amount, credit: ZERO,
        source_type: 'PURCHASE', source_id: p.id, due_date: p.due_date, location_id: p.location_id, narration: p.code, created_by: ctx.user.id,
      },
    });
    if (p.paid_amount.greaterThan(0)) {
      await tx.supplierLedger.create({
        data: {
          supplier_id: p.supplier_id, entry_date: p.business_date, entry_type: 'PAYMENT', debit: ZERO, credit: p.paid_amount,
          source_type: 'PURCHASE', source_id: p.id, location_id: p.location_id, narration: `Paid with ${p.code}`, created_by: ctx.user.id,
        },
      });
    }
  }

  /** Atomic stock movement with weighted-average cost. Returns the balance after. */
  moveStock(tx: Tx, locationId: string, itemId: string, qty: Dec, value: Dec, unitCost: Dec): Promise<Dec> {
    return this.ledger.moveStock(tx, locationId, itemId, qty, value, unitCost);
  }

  // ------------------------------------------------------------ workflow
  async approve(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const p = await this.loadFor(tx, id, ['SUBMITTED'], 'approve');
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'PURCHASE');
      if (!this.rules.withinLimit(limit, p.total_amount)) {
        throw new AppException(403, 'APPROVAL_LIMIT_EXCEEDED', 'This amount is above your approval limit; ask the owner');
      }
      const after = await tx.purchase.update({
        where: { id },
        data: { approval_status: 'APPROVED', approved_by: ctx.user.id, approved_at: new Date(), rejection_reason: null, updated_by: ctx.user.id, version: { increment: 1 } },
        include: { items: true },
      });
      await this.postApproved(tx, ctx, after);
      await this.audit.log(tx, ctx, { action: 'APPROVE', entityType: 'PURCHASE', entityId: id, entityCode: p.code, locationId: p.location_id, before: p, after });
      return after;
    });
  }

  async reject(ctx: ReqCtx, id: string, dto: PurchaseActionDto) {
    if (!dto.reason?.trim()) throw validation('REASON_REQUIRED', 'Give a reason for rejecting', 'reason');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const p = await this.loadFor(tx, id, ['SUBMITTED'], 'reject');
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'PURCHASE');
      if (!this.rules.withinLimit(limit, p.total_amount)) {
        throw new AppException(403, 'APPROVAL_LIMIT_EXCEEDED', 'This amount is above your approval limit; ask the owner');
      }
      const after = await tx.purchase.update({
        where: { id },
        data: { approval_status: 'REJECTED', rejection_reason: dto.reason, approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } },
      });
      // a rejected purchase never left the till and never reached stock or the supplier
      await tx.cashTransaction.updateMany({ where: { source_type: 'PURCHASE', source_id: id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, ctx, { action: 'REJECT', entityType: 'PURCHASE', entityId: id, entityCode: p.code, locationId: p.location_id, before: p, after, reason: dto.reason });
      return after;
    });
  }

  /** SUBMITTED / REJECTED -> CANCELLED by the person who entered it, or the owner. */
  async cancel(ctx: ReqCtx, id: string, dto: PurchaseActionDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const p = await this.loadFor(tx, id, ['SUBMITTED', 'REJECTED'], 'cancel');
      if (p.entered_by !== ctx.user.id && !isAdmin(ctx.user)) {
        throw new AppException(403, 'FORBIDDEN', 'Only the person who entered it, or the owner, can cancel this purchase');
      }
      const after = await tx.purchase.update({
        where: { id },
        data: { approval_status: 'CANCELLED', status: 'CANCELLED', updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await tx.cashTransaction.updateMany({ where: { source_type: 'PURCHASE', source_id: id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, ctx, { action: 'CANCEL', entityType: 'PURCHASE', entityId: id, entityCode: p.code, locationId: p.location_id, before: p, after, reason: dto.reason });
      return after;
    });
  }

  /**
   * APPROVED -> REVERSED. Never a delete: stock and the supplier ledger get mirror entries dated today, cash paid goes back
   * into the till. Refused while stock has already been used, or while payments are still recorded against it.
   */
  async reverse(ctx: ReqCtx, id: string, dto: PurchaseActionDto) {
    if (!dto.reason?.trim()) throw validation('REASON_REQUIRED', 'Give a reason for reversing', 'reason');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const p = await this.loadFor(tx, id, ['APPROVED'], 'reverse');
      const later = await tx.supplierPayment.count({ where: { purchase_id: id, status: 'ACTIVE' } });
      if (later > 0) throw new AppException(409, 'HAS_PAYMENTS', 'Payments were made against this purchase; reverse those payments first');
      const today = toDate(todayIST());
      const originals = await tx.inventoryTransaction.findMany({ where: { source_type: 'PURCHASE', source_id: id, txn_type: 'PURCHASE_IN' } });

      for (const o of originals) {
        const bal = await tx.stockBalance.findUnique({ where: { location_id_item_id: { location_id: o.location_id, item_id: o.item_id } } });
        if (!bal || bal.quantity.lessThan(o.quantity)) {
          throw new AppException(409, 'STOCK_INSUFFICIENT', 'Some of this stock has already been used, so the purchase cannot be reversed');
        }
      }
      for (const o of originals) {
        const balance = await this.moveStock(tx, o.location_id, o.item_id, o.quantity.neg(), o.value.neg(), o.unit_cost);
        await tx.inventoryTransaction.create({
          data: {
            location_id: o.location_id, item_id: o.item_id, business_date: today, txn_type: 'REVERSAL', quantity: o.quantity.neg(), unit_cost: o.unit_cost,
            value: o.value.neg(), balance_after: balance, source_type: 'PURCHASE_REVERSAL', source_id: id, reversal_of_id: o.id, created_by: ctx.user.id,
          },
        });
      }
      await tx.supplierLedger.create({
        data: { supplier_id: p.supplier_id, entry_date: today, entry_type: 'REVERSAL', debit: ZERO, credit: p.total_amount, source_type: 'PURCHASE_REVERSAL', source_id: id, location_id: p.location_id, narration: `Reversal of ${p.code}`, created_by: ctx.user.id },
      });
      if (p.paid_amount.greaterThan(0)) {
        await tx.supplierLedger.create({
          data: { supplier_id: p.supplier_id, entry_date: today, entry_type: 'REVERSAL', debit: p.paid_amount, credit: ZERO, source_type: 'PURCHASE_REVERSAL', source_id: id, location_id: p.location_id, narration: `Payment returned for ${p.code}`, created_by: ctx.user.id },
        });
      }
      const cash = await tx.cashTransaction.findFirst({ where: { source_type: 'PURCHASE', source_id: id, status: 'ACTIVE' } });
      if (cash) {
        await tx.cashTransaction.create({
          data: {
            location_id: cash.location_id, business_date: today, txn_type: 'ADJUSTMENT', direction: 1, amount: cash.amount, source_type: 'PURCHASE_REVERSAL',
            source_id: id, reversal_of_id: cash.id, description: `Reversal of ${p.code}`, source: ctx.source, created_by: ctx.user.id, updated_by: ctx.user.id,
          },
        });
      }
      const after = await tx.purchase.update({ where: { id }, data: { status: 'REVERSED', updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'REVERSE', entityType: 'PURCHASE', entityId: id, entityCode: p.code, locationId: p.location_id, before: p, after, reason: dto.reason });
      return after;
    });
  }

  private async loadFor(tx: Tx, id: string, allowed: string[], verb: string) {
    const p = await tx.purchase.findUnique({ where: { id } });
    if (!p) throw notFound('Purchase');
    if (p.status !== 'ACTIVE' || !allowed.includes(p.approval_status)) {
      throw new AppException(409, 'INVALID_TRANSITION', `Cannot ${verb} a purchase that is ${p.status === 'ACTIVE' ? p.approval_status : p.status}`);
    }
    return p;
  }

  // ------------------------------------------------------------ read
  async list(ctx: ReqCtx, q: ListPurchasesQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
    const search = q.q?.trim();
    const where: Prisma.PurchaseWhereInput = {
      ...(q.locationId ? { location_id: q.locationId } : {}),
      ...(q.supplierId ? { supplier_id: q.supplierId } : {}),
      ...(q.paymentMode ? { payment_mode: q.paymentMode as any } : {}),
      ...(q.status ? { approval_status: q.status as any } : {}),
      ...(q.settlement === 'open' ? { credit_amount: { gt: 0 } } : q.settlement === 'settled' ? { credit_amount: 0 } : {}),
      ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { supplier_ref_no: { contains: search, mode: 'insensitive' } }, { remarks: { contains: search, mode: 'insensitive' } }] } : {}),
      ...(q.from || q.to ? { business_date: { ...(q.from ? { gte: toDate(q.from, 'from') } : {}), ...(q.to ? { lte: toDate(q.to, 'to') } : {}) } } : {}),
    };
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [rows, total, agg] = await Promise.all([
        tx.purchase.findMany({ where, include: { items: { orderBy: { line_no: 'asc' } } }, orderBy: [{ business_date: 'desc' }, { created_at: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.purchase.count({ where }),
        tx.purchase.aggregate({ where: { ...where, status: 'ACTIVE', approval_status: { in: ['SUBMITTED', 'APPROVED'] } }, _sum: { total_amount: true, paid_amount: true, credit_amount: true } }),
      ]);
      const data = await this.decorate(tx, rows);
      return new Envelope(data, [], {
        page, pageSize, total,
        totalAmount: agg._sum.total_amount ?? ZERO, totalPaid: agg._sum.paid_amount ?? ZERO, totalCredit: agg._sum.credit_amount ?? ZERO,
      });
    });
  }

  async get(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const p = await tx.purchase.findUnique({ where: { id }, include: { items: { orderBy: { line_no: 'asc' } } } });
      if (!p) throw notFound('Purchase');
      const [[row], atts, payments] = await Promise.all([
        this.decorate(tx, [p]),
        tx.attachment.findMany({ where: { entity_type: 'PURCHASE', entity_id: id, status: 'ACTIVE' }, select: { id: true, file_name: true, mime_type: true, size_bytes: true } }),
        tx.supplierPayment.findMany({ where: { purchase_id: id }, orderBy: { created_at: 'asc' } }),
      ]);
      return { ...row, attachments: atts, payments };
    });
  }

  /** Names for suppliers, locations, items, units and people, so screens never show bare IDs. */
  private async decorate(tx: Tx, rows: Array<Prisma.PurchaseGetPayload<{ include: { items: true } }>>) {
    const ids = <T,>(xs: Array<T | null | undefined>) => [...new Set(xs.filter((x): x is T => !!x))];
    const [suppliers, locs, items, units, users, atts] = await Promise.all([
      tx.supplier.findMany({ where: { id: { in: ids(rows.map((r) => r.supplier_id)) } }, select: { id: true, code: true, name: true } }),
      tx.location.findMany({ where: { id: { in: ids(rows.map((r) => r.location_id)) } }, select: { id: true, code: true, name: true, name_ta: true, type: true } }),
      tx.inventoryItem.findMany({ where: { id: { in: ids(rows.flatMap((r) => r.items.map((i) => i.item_id))) } }, select: { id: true, code: true, name_en: true, name_ta: true } }),
      tx.unit.findMany({ select: { id: true, code: true } }),
      tx.user.findMany({ where: { id: { in: ids(rows.flatMap((r) => [r.entered_by, r.approved_by])) } }, select: { id: true, full_name: true } }),
      tx.attachment.groupBy({ by: ['entity_id'], where: { entity_type: 'PURCHASE', entity_id: { in: rows.map((r) => r.id) }, status: 'ACTIVE' }, _count: { _all: true } }),
    ]);
    const sp = new Map(suppliers.map((x) => [x.id, x]));
    const lc = new Map(locs.map((x) => [x.id, x]));
    const it = new Map(items.map((x) => [x.id, x]));
    const un = new Map(units.map((x) => [x.id, x.code]));
    const us = new Map(users.map((x) => [x.id, x.full_name]));
    const at = new Map(atts.map((x) => [x.entity_id, x._count._all]));
    return rows.map((r) => ({
      ...r,
      supplier_code: sp.get(r.supplier_id)?.code, supplier_name: sp.get(r.supplier_id)?.name,
      location_code: lc.get(r.location_id)?.code, location_name: lc.get(r.location_id)?.name, location_name_ta: lc.get(r.location_id)?.name_ta, location_type: lc.get(r.location_id)?.type,
      entered_by_name: us.get(r.entered_by) ?? null, approved_by_name: r.approved_by ? us.get(r.approved_by) ?? null : null,
      receipt_count: at.get(r.id) ?? 0,
      items: r.items.map((i) => ({ ...i, item_code: it.get(i.item_id)?.code, item_name: it.get(i.item_id)?.name_en, item_name_ta: it.get(i.item_id)?.name_ta, unit_code: un.get(i.unit_id) })),
    }));
  }

  // ------------------------------------------------------------ owner summary
  async summary(ctx: ReqCtx, q: PurchaseSummaryQuery) {
    const today = toDate(todayIST());
    const to = q.to ? toDate(q.to, 'to') : today;
    const from = q.from ? toDate(q.from, 'from') : addDays(to, -29);
    if (from.getTime() > to.getTime()) throw validation('INVALID_RANGE', 'from must be on or before to', 'from');
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 800) throw validation('INVALID_RANGE', 'Choose a range of at most 800 days', 'to');
    const groupBy = q.groupBy && ['day', 'week', 'month'].includes(q.groupBy) ? q.groupBy : days > 120 ? 'month' : days > 45 ? 'week' : 'day';

    const where: Prisma.PurchaseWhereInput = {
      status: 'ACTIVE', approval_status: { in: ['SUBMITTED', 'APPROVED'] }, business_date: { gte: from, lte: to },
      ...(q.locationId ? { location_id: q.locationId } : {}), ...(q.supplierId ? { supplier_id: q.supplierId } : {}),
    };
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [rows, itemRows, ledger, open, suppliers, locs, items] = await Promise.all([
        tx.purchase.groupBy({
          by: ['business_date', 'location_id', 'supplier_id', 'payment_mode', 'approval_status'], where,
          _sum: { total_amount: true, paid_amount: true, credit_amount: true }, _count: { _all: true },
        }),
        tx.purchaseItem.groupBy({ by: ['item_id'], where: { purchase: where }, _sum: { line_total: true, base_quantity: true } }),
        tx.supplierLedger.groupBy({ by: ['supplier_id'], where: q.supplierId ? { supplier_id: q.supplierId } : {}, _sum: { debit: true, credit: true } }),
        tx.purchase.findMany({
          where: { status: 'ACTIVE', approval_status: 'APPROVED', credit_amount: { gt: 0 }, ...(q.locationId ? { location_id: q.locationId } : {}), ...(q.supplierId ? { supplier_id: q.supplierId } : {}) },
          select: { supplier_id: true, credit_amount: true, due_date: true },
        }),
        tx.supplier.findMany({ select: { id: true, code: true, name: true } }),
        tx.location.findMany({ select: { id: true, code: true, name: true, name_ta: true } }),
        tx.inventoryItem.findMany({ select: { id: true, code: true, name_en: true, name_ta: true } }),
      ]);
      const keys = bucketKeys(from, to, groupBy);
      const byBucket = new Map<string, { total: Dec; count: number }>(keys.map((k) => [k, { total: ZERO, count: 0 }]));
      const byLoc = new Map<string, { total: Dec; count: number }>();
      const bySup = new Map<string, { total: Dec; paid: Dec; credit: Dec; count: number }>();
      const byMode = new Map<string, { total: Dec; count: number }>();
      let total = ZERO, paid = ZERO, credit = ZERO, count = 0, pendingAmount = ZERO, pendingCount = 0;
      for (const r of rows) {
        const t = D(r._sum.total_amount ?? 0), pd = D(r._sum.paid_amount ?? 0), cr = D(r._sum.credit_amount ?? 0), n = r._count._all;
        total = total.plus(t); paid = paid.plus(pd); credit = credit.plus(cr); count += n;
        const b = byBucket.get(bucketStart(r.business_date, groupBy))!; b.total = b.total.plus(t); b.count += n;
        const l = byLoc.get(r.location_id) ?? { total: ZERO, count: 0 }; l.total = l.total.plus(t); l.count += n; byLoc.set(r.location_id, l);
        const s = bySup.get(r.supplier_id) ?? { total: ZERO, paid: ZERO, credit: ZERO, count: 0 }; s.total = s.total.plus(t); s.paid = s.paid.plus(pd); s.credit = s.credit.plus(cr); s.count += n; bySup.set(r.supplier_id, s);
        const m = byMode.get(r.payment_mode) ?? { total: ZERO, count: 0 }; m.total = m.total.plus(t); m.count += n; byMode.set(r.payment_mode, m);
        if (r.approval_status === 'SUBMITTED') { pendingAmount = pendingAmount.plus(t); pendingCount += n; }
      }
      const share = (v: Dec) => (total.isZero() ? null : v.div(total).mul(100).toDecimalPlaces(1).toNumber());
      const sname = new Map(suppliers.map((s) => [s.id, s]));
      const lname = new Map(locs.map((l) => [l.id, l]));
      const iname = new Map(items.map((i) => [i.id, i]));

      // what is still owed to suppliers (all time, not just this range) and how much of it is late
      const soon = new Date(today.getTime() + 7 * 86_400_000);
      let overdue = ZERO, dueSoon = ZERO;
      for (const o of open) {
        if (!o.due_date) continue;
        if (o.due_date.getTime() < today.getTime()) overdue = overdue.plus(o.credit_amount);
        else if (o.due_date.getTime() <= soon.getTime()) dueSoon = dueSoon.plus(o.credit_amount);
      }
      const balances = ledger.map((l) => ({ supplierId: l.supplier_id, balance: D(l._sum.debit ?? 0).minus(l._sum.credit ?? 0) })).filter((b) => b.balance.greaterThan(0));

      return {
        from: fmtDate(from), to: fmtDate(to), days, groupBy,
        totals: { total, paid, credit, count, pendingApproval: { amount: pendingAmount, count: pendingCount } },
        outstanding: { total: sum(balances.map((b) => b.balance)), suppliers: balances.length, overdue, dueSoon },
        buckets: keys.map((k) => ({ start: k, amount: byBucket.get(k)!.total, count: byBucket.get(k)!.count })),
        locations: [...byLoc.entries()].map(([id, v]) => ({ locationId: id, code: lname.get(id)?.code ?? '?', name: lname.get(id)?.name ?? '?', nameTa: lname.get(id)?.name_ta ?? null, amount: v.total, count: v.count, sharePct: share(v.total) })).sort((a, b) => b.amount.comparedTo(a.amount)),
        suppliers: [...bySup.entries()].map(([id, v]) => ({ supplierId: id, code: sname.get(id)?.code ?? '?', name: sname.get(id)?.name ?? '?', amount: v.total, paid: v.paid, credit: v.credit, count: v.count, sharePct: share(v.total) })).sort((a, b) => b.amount.comparedTo(a.amount)),
        paymentModes: [...byMode.entries()].map(([mode, v]) => ({ mode, amount: v.total, count: v.count, sharePct: share(v.total) })).sort((a, b) => b.amount.comparedTo(a.amount)),
        items: itemRows.map((r) => ({ itemId: r.item_id, code: iname.get(r.item_id)?.code ?? '?', name: iname.get(r.item_id)?.name_en ?? '?', nameTa: iname.get(r.item_id)?.name_ta ?? null, amount: D(r._sum.line_total ?? 0), baseQuantity: D(r._sum.base_quantity ?? 0) })).sort((a, b) => b.amount.comparedTo(a.amount)).slice(0, 10),
      };
    });
  }
}
