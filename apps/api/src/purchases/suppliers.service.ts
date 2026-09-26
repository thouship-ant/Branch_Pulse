import { Injectable } from '@nestjs/common';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { can, isOwner, ReqCtx } from '../common/auth-user';
import { CodesService } from '../common/codes.service';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { D, Dec, MONEY_PATTERN, parseMoney, parseMoneyOr0, sum, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { RulesService } from '../common/rules.service';
import { PAYMENT_MODES } from './purchases.service';
import { supplierTotals } from './supplier-reports.service';

export class CreateSupplierDto {
  @IsString() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(60) contactPerson?: string;
  @IsOptional() @IsString() @MaxLength(15) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(15) gstin?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @IsOptional() @Matches(MONEY_PATTERN) openingBalance?: string; // owed to the supplier before the app was used
  @IsOptional() @IsString() openingBalanceDate?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) itemIds?: string[]; // items this supplier supplies
}

export class UpdateSupplierDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(60) contactPerson?: string;
  @IsOptional() @IsString() @MaxLength(15) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(15) gstin?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @IsOptional() active?: boolean;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) itemIds?: string[]; // replaces the list of items supplied
}

export class SupplierPaymentDto {
  @IsUUID() locationId: string; // whose till or account the money comes from
  @IsOptional() @IsString() businessDate?: string;
  @Matches(MONEY_PATTERN) amount: string;
  @IsEnum(PAYMENT_MODES) paymentMode: string;
  @IsOptional() @IsString() @MaxLength(40) referenceNo?: string;
  @IsOptional() @IsUUID() purchaseId?: string; // pay this credit purchase; otherwise the oldest dues are settled first
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class ListSuppliersQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() status?: string; // ACTIVE | INACTIVE
  @IsOptional() @IsString() owing?: string; // 'true' = only suppliers we owe money
}

export class LedgerQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

/**
 * Suppliers and what is owed to them. The supplier ledger is the single source of truth: an approved purchase adds what we
 * owe (and any amount paid with it), a payment reduces it, a reversal mirrors. Outstanding = debits - credits.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodesService,
    private readonly rules: RulesService,
  ) {}

  private seesBalance(ctx: ReqCtx) {
    return isOwner(ctx.user) || can(ctx.user, 'supplier:pay') || can(ctx.user, 'supplier:manage');
  }

  // ------------------------------------------------------------ master data
  async list(ctx: ReqCtx, q: ListSuppliersQuery) {
    const search = q.q?.trim();
    const today = toDate(todayIST());
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const suppliers = await tx.supplier.findMany({
        where: {
          ...(q.status ? { status: q.status as any } : {}),
          ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } : {}),
        },
        orderBy: { code: 'asc' },
      });
      const links = await tx.supplierItem.groupBy({ by: ['supplier_id'], _count: { _all: true } });
      const withItems = suppliers.map((s) => ({ ...s, itemCount: links.find((l) => l.supplier_id === s.id)?._count._all ?? 0 }));
      if (!this.seesBalance(ctx)) return withItems.map((s) => ({ ...s, outstanding: null, totalPurchases: null, totalPaid: null, overdue: null, nextDue: null, lastPurchaseOn: null }));

      const [totals, open] = await Promise.all([
        supplierTotals(tx, suppliers),
        tx.purchase.findMany({ where: { status: 'ACTIVE', approval_status: 'APPROVED', credit_amount: { gt: 0 } }, select: { supplier_id: true, credit_amount: true, due_date: true } }),
      ]);
      const rows = withItems.map((s) => {
        const t = totals.get(s.id)!;
        const mine = open.filter((o) => o.supplier_id === s.id);
        const overdue = sum(mine.filter((o) => o.due_date && o.due_date.getTime() < today.getTime()).map((o) => o.credit_amount));
        const dues = mine.filter((o) => o.due_date && o.due_date.getTime() >= today.getTime()).map((o) => o.due_date!.getTime());
        return {
          ...s, outstanding: t.outstanding, totalPurchases: t.totalPurchases, totalPaid: t.totalPaid, overdue, nextDue: dues.length ? new Date(Math.min(...dues)) : null,
          lastPurchaseOn: t.lastPurchaseOn,
        };
      });
      return q.owing === 'true' ? rows.filter((r) => r.outstanding.greaterThan(0)) : rows;
    });
  }

  /** Replace the list of items a supplier supplies (each must be an active item). */
  private async setItems(tx: Tx, supplierId: string, itemIds: string[]) {
    const ids = [...new Set(itemIds)];
    if (ids.length) {
      const found = await tx.inventoryItem.count({ where: { id: { in: ids }, status: 'ACTIVE' } });
      if (found !== ids.length) throw validation('INVALID_ITEM', 'Some of the items are not active items', 'itemIds');
    }
    await tx.supplierItem.deleteMany({ where: { supplier_id: supplierId } });
    if (ids.length) await tx.supplierItem.createMany({ data: ids.map((item_id) => ({ supplier_id: supplierId, item_id })) });
  }

  private async nextCode(tx: Tx): Promise<string> {
    const all = await tx.supplier.findMany({ select: { code: true } });
    const max = all.reduce((m, s) => Math.max(m, Number(/^SUP(\d+)$/.exec(s.code)?.[1] ?? 0)), 0);
    return `SUP${String(max + 1).padStart(4, '0')}`;
  }

  async create(ctx: ReqCtx, dto: CreateSupplierDto) {
    const name = dto.name?.trim();
    if (!name) throw validation('NAME_REQUIRED', 'Enter the supplier name', 'name');
    const opening = parseMoneyOr0(dto.openingBalance, 'openingBalance');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      if (await tx.supplier.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) {
        throw new AppException(409, 'DUPLICATE_SUPPLIER', 'A supplier with this name already exists');
      }
      const openingDate = dto.openingBalanceDate ? toDate(dto.openingBalanceDate, 'openingBalanceDate') : toDate(todayIST());
      const s = await tx.supplier.create({
        data: {
          code: await this.nextCode(tx), name, contact_person: dto.contactPerson?.trim() || null, phone: dto.phone?.trim() || null,
          address: dto.address?.trim() || null, gstin: dto.gstin?.trim().toUpperCase() || null, payment_terms_days: dto.paymentTermsDays ?? 0,
          opening_balance: opening, opening_balance_date: opening.greaterThan(0) ? openingDate : null, created_by: ctx.user.id, updated_by: ctx.user.id,
        },
      });
      if (opening.greaterThan(0)) {
        await tx.supplierLedger.create({
          data: { supplier_id: s.id, entry_date: openingDate, entry_type: 'OPENING', debit: opening, credit: ZERO, source_type: 'SUPPLIER', source_id: s.id, narration: 'Opening balance', created_by: ctx.user.id },
        });
      }
      if (dto.itemIds) await this.setItems(tx, s.id, dto.itemIds);
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'SUPPLIER', entityId: s.id, entityCode: s.code, after: { ...s, item_ids: dto.itemIds ?? [] } });
      return s;
    });
  }

  async update(ctx: ReqCtx, id: string, dto: UpdateSupplierDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.supplier.findUnique({ where: { id } });
      if (!before) throw notFound('Supplier');
      const name = dto.name?.trim();
      if (name && name.toLowerCase() !== before.name.toLowerCase() && (await tx.supplier.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, NOT: { id } } }))) {
        throw new AppException(409, 'DUPLICATE_SUPPLIER', 'A supplier with this name already exists');
      }
      const after = await tx.supplier.update({
        where: { id },
        data: {
          name: name || undefined, contact_person: dto.contactPerson?.trim(), phone: dto.phone?.trim(), address: dto.address?.trim(),
          gstin: dto.gstin === undefined ? undefined : dto.gstin.trim().toUpperCase() || null, payment_terms_days: dto.paymentTermsDays,
          status: dto.active === undefined ? undefined : dto.active ? 'ACTIVE' : 'INACTIVE', updated_by: ctx.user.id, version: { increment: 1 },
        },
      });
      if (dto.itemIds) await this.setItems(tx, id, dto.itemIds);
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'SUPPLIER', entityId: id, entityCode: after.code, before, after });
      return after;
    });
  }

  // ------------------------------------------------------------ statement
  /** Every ledger entry in the range with a running balance, plus the credit purchases still open. */
  async statement(ctx: ReqCtx, id: string, q: LedgerQuery) {
    const to = q.to ? toDate(q.to, 'to') : toDate(todayIST());
    const from = q.from ? toDate(q.from, 'from') : addDays(to, -89);
    if (from.getTime() > to.getTime()) throw validation('INVALID_RANGE', 'from must be on or before to', 'from');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id } });
      if (!supplier) throw notFound('Supplier');
      const [before, entries, open, locs] = await Promise.all([
        tx.supplierLedger.aggregate({ where: { supplier_id: id, entry_date: { lt: from } }, _sum: { debit: true, credit: true } }),
        tx.supplierLedger.findMany({ where: { supplier_id: id, entry_date: { gte: from, lte: to } }, orderBy: [{ entry_date: 'asc' }, { created_at: 'asc' }] }),
        tx.purchase.findMany({
          where: { supplier_id: id, status: 'ACTIVE', approval_status: 'APPROVED', credit_amount: { gt: 0 } }, orderBy: [{ due_date: 'asc' }, { business_date: 'asc' }],
          select: { id: true, code: true, business_date: true, due_date: true, total_amount: true, paid_amount: true, credit_amount: true, location_id: true, supplier_ref_no: true },
        }),
        tx.location.findMany({ select: { id: true, code: true, name: true } }),
      ]);
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.created_by))] } }, select: { id: true, full_name: true } });
      const opening = D(before._sum.debit ?? 0).minus(before._sum.credit ?? 0);
      let running = opening;
      const rows = entries.map((e) => {
        running = running.plus(e.debit).minus(e.credit);
        return { ...e, balance: running, createdByName: users.find((u) => u.id === e.created_by)?.full_name ?? null, locationCode: locs.find((l) => l.id === e.location_id)?.code ?? null };
      });
      const today = toDate(todayIST());
      const outstanding = seesTotal(await tx.supplierLedger.aggregate({ where: { supplier_id: id }, _sum: { debit: true, credit: true } }));
      return {
        supplier, from: fmtDate(from), to: fmtDate(to), openingBalance: opening, closingBalance: running, outstanding,
        totals: { debit: sum(entries.map((e) => e.debit)), credit: sum(entries.map((e) => e.credit)) },
        entries: rows,
        openPurchases: open.map((o) => ({ ...o, locationCode: locs.find((l) => l.id === o.location_id)?.code ?? null, overdue: !!o.due_date && o.due_date.getTime() < today.getTime() })),
      };
    });
  }

  // ------------------------------------------------------------ payments
  /**
   * Pay a supplier. With a purchase given, that credit is paid (part or full); otherwise the oldest dues are settled first and any
   * remainder (e.g. an opening balance) is recorded on account. Cash payments leave the paying location's till.
   */
  async pay(ctx: ReqCtx, supplierId: string, dto: SupplierPaymentDto) {
    const amount = parseMoney(dto.amount, 'amount', { allowZero: false });
    if (!PAYMENT_MODES.includes(dto.paymentMode) || dto.paymentMode === 'CREDIT') throw validation('INVALID_MODE', 'Choose how it was paid (cash, UPI, bank ...)', 'paymentMode');
    const date = await this.rules.assertBusinessDate(ctx.user, dto.businessDate ?? todayIST());

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw notFound('Supplier');
      const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw notFound('Location');
      if (dto.paymentMode === 'CASH') await this.rules.assertDayEditable(tx, ctx.user, dto.locationId, date);

      const led = await tx.supplierLedger.aggregate({ where: { supplier_id: supplierId }, _sum: { debit: true, credit: true } });
      const owed = D(led._sum.debit ?? 0).minus(led._sum.credit ?? 0);
      if (amount.greaterThan(owed)) throw new AppException(422, 'OVERPAYMENT', `Only ${owed.toFixed(2)} is outstanding to ${supplier.name}`);

      // where the money goes
      type Alloc = { purchaseId: string | null; amount: Dec };
      const allocs: Alloc[] = [];
      if (dto.purchaseId) {
        const p = await tx.purchase.findUnique({ where: { id: dto.purchaseId } });
        if (!p || p.supplier_id !== supplierId || p.status !== 'ACTIVE' || p.approval_status !== 'APPROVED' || !p.credit_amount.greaterThan(0)) {
          throw validation('INVALID_PURCHASE', 'That purchase has nothing left to pay for this supplier', 'purchaseId');
        }
        if (amount.greaterThan(p.credit_amount)) throw validation('OVERPAYMENT', `Only ${p.credit_amount.toFixed(2)} is left on ${p.code}`, 'amount');
        allocs.push({ purchaseId: p.id, amount });
      } else {
        let left = amount;
        const dues = await tx.purchase.findMany({
          where: { supplier_id: supplierId, status: 'ACTIVE', approval_status: 'APPROVED', credit_amount: { gt: 0 } },
          orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { business_date: 'asc' }],
        });
        for (const d of dues) {
          if (left.lessThanOrEqualTo(0)) break;
          const part = left.lessThan(d.credit_amount) ? left : d.credit_amount;
          allocs.push({ purchaseId: d.id, amount: part });
          left = left.minus(part);
        }
        if (left.greaterThan(0)) allocs.push({ purchaseId: null, amount: left });
      }

      const rows = [];
      for (const a of allocs) {
        const code = await this.codes.next(tx, 'supplierPayment', dto.locationId);
        const row = await tx.supplierPayment.create({
          data: {
            code, supplier_id: supplierId, location_id: dto.locationId, business_date: date, amount: a.amount, payment_mode: dto.paymentMode as any,
            reference_no: dto.referenceNo?.trim() || null, purchase_id: a.purchaseId, remarks: dto.remarks?.trim() || null, created_by: ctx.user.id, updated_by: ctx.user.id,
          },
        });
        if (a.purchaseId) {
          await tx.purchase.update({ where: { id: a.purchaseId }, data: { paid_amount: { increment: a.amount }, credit_amount: { decrement: a.amount }, updated_by: ctx.user.id, version: { increment: 1 } } });
        }
        await tx.supplierLedger.create({
          data: {
            supplier_id: supplierId, entry_date: date, entry_type: 'PAYMENT', debit: ZERO, credit: a.amount, source_type: 'SUPPLIER_PAYMENT', source_id: row.id,
            location_id: dto.locationId, narration: `${row.code}${dto.referenceNo ? ` · ${dto.referenceNo.trim()}` : ''}`, created_by: ctx.user.id,
          },
        });
        if (dto.paymentMode === 'CASH') {
          await tx.cashTransaction.create({
            data: {
              location_id: dto.locationId, business_date: date, txn_type: 'SUPPLIER_PAYMENT', direction: -1, amount: a.amount, source_type: 'SUPPLIER_PAYMENT',
              source_id: row.id, description: `${supplier.name} · ${row.code}`, source: ctx.source, created_by: ctx.user.id, updated_by: ctx.user.id,
            },
          });
        }
        await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'SUPPLIER_PAYMENT', entityId: row.id, entityCode: row.code, locationId: dto.locationId, after: row });
        rows.push(row);
      }
      return { payments: rows, paid: amount, outstandingAfter: owed.minus(amount) };
    });
  }

  /** ACTIVE -> REVERSED: the dues come back, the ledger gets a mirror entry, cash goes back into the till (dated today). */
  async reversePayment(ctx: ReqCtx, paymentId: string, reason?: string) {
    if (!reason?.trim()) throw validation('REASON_REQUIRED', 'Give a reason for reversing', 'reason');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const pay = await tx.supplierPayment.findUnique({ where: { id: paymentId } });
      if (!pay) throw notFound('Payment');
      if (pay.status !== 'ACTIVE') throw new AppException(409, 'INVALID_TRANSITION', `Cannot reverse a payment that is ${pay.status}`);
      const today = toDate(todayIST());
      if (pay.purchase_id) {
        await tx.purchase.update({ where: { id: pay.purchase_id }, data: { paid_amount: { decrement: pay.amount }, credit_amount: { increment: pay.amount }, updated_by: ctx.user.id, version: { increment: 1 } } });
      }
      await tx.supplierLedger.create({
        data: { supplier_id: pay.supplier_id, entry_date: today, entry_type: 'REVERSAL', debit: pay.amount, credit: ZERO, source_type: 'SUPPLIER_PAYMENT_REVERSAL', source_id: pay.id, location_id: pay.location_id, narration: `Reversal of ${pay.code}`, created_by: ctx.user.id },
      });
      const cash = await tx.cashTransaction.findFirst({ where: { source_type: 'SUPPLIER_PAYMENT', source_id: pay.id, status: 'ACTIVE' } });
      if (cash) {
        await tx.cashTransaction.create({
          data: {
            location_id: cash.location_id, business_date: today, txn_type: 'ADJUSTMENT', direction: 1, amount: cash.amount, source_type: 'SUPPLIER_PAYMENT_REVERSAL',
            source_id: pay.id, reversal_of_id: cash.id, description: `Reversal of ${pay.code}`, source: ctx.source, created_by: ctx.user.id, updated_by: ctx.user.id,
          },
        });
      }
      const after = await tx.supplierPayment.update({ where: { id: paymentId }, data: { status: 'REVERSED', updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'REVERSE', entityType: 'SUPPLIER_PAYMENT', entityId: paymentId, entityCode: pay.code, locationId: pay.location_id, before: pay, after, reason });
      return after;
    });
  }
}

const seesTotal = (a: { _sum: { debit: Dec | null; credit: Dec | null } }): Dec => D(a._sum.debit ?? 0).minus(a._sum.credit ?? 0);
