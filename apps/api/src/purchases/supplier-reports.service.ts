import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { notFound, validation } from '../common/app-exception';
import { can, isOwner, ReqCtx } from '../common/auth-user';
import { toDate, todayIST } from '../common/dates';
import { D, Dec, sum, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { Envelope } from '../common/response';

export class PaymentHistoryQuery {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() status?: string; // ACTIVE | REVERSED
  @IsOptional() @Type(() => Number) page?: number;
  @IsOptional() @Type(() => Number) pageSize?: number;
}

export class DuesQuery {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsIn(['overdue', 'due7', 'later', 'nodate']) bucket?: string;
}

export interface SupplierTotals {
  openingBalance: Dec;
  totalPurchases: Dec;
  totalPaid: Dec;
  outstanding: Dec;
  purchaseCount: number;
  lastPurchaseOn: Date | null;
}

/**
 * Per supplier: total purchases and total paid (approved purchases, including what was paid later against them, plus payments made
 * on account), and the ledger outstanding. Always: opening balance + total purchases - total paid = outstanding.
 */
export async function supplierTotals(tx: Tx, suppliers: Array<{ id: string; opening_balance: Dec }>): Promise<Map<string, SupplierTotals>> {
  const ids = suppliers.map((s) => s.id);
  const [purch, onAccount, ledger] = await Promise.all([
    tx.purchase.groupBy({
      by: ['supplier_id'], where: { supplier_id: { in: ids }, status: 'ACTIVE', approval_status: 'APPROVED' },
      _sum: { total_amount: true, paid_amount: true }, _count: { _all: true }, _max: { business_date: true },
    }),
    tx.supplierPayment.groupBy({ by: ['supplier_id'], where: { supplier_id: { in: ids }, status: 'ACTIVE', purchase_id: null }, _sum: { amount: true } }),
    tx.supplierLedger.groupBy({ by: ['supplier_id'], where: { supplier_id: { in: ids } }, _sum: { debit: true, credit: true } }),
  ]);
  const out = new Map<string, SupplierTotals>();
  for (const s of suppliers) {
    const p = purch.find((x) => x.supplier_id === s.id);
    const a = onAccount.find((x) => x.supplier_id === s.id);
    const l = ledger.find((x) => x.supplier_id === s.id);
    out.set(s.id, {
      openingBalance: s.opening_balance,
      totalPurchases: D(p?._sum.total_amount ?? 0),
      totalPaid: D(p?._sum.paid_amount ?? 0).plus(a?._sum.amount ?? 0),
      outstanding: D(l?._sum.debit ?? 0).minus(l?._sum.credit ?? 0),
      purchaseCount: p?._count._all ?? 0,
      lastPurchaseOn: p?._max.business_date ?? null,
    });
  }
  return out;
}

/** Profile, payment history and the due-payments report. Balances are visible to people who manage or pay suppliers only. */
@Injectable()
export class SupplierReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private seesBalance(ctx: ReqCtx) {
    return isOwner(ctx.user) || can(ctx.user, 'supplier:pay') || can(ctx.user, 'supplier:manage');
  }

  // ------------------------------------------------------------ profile
  async profile(ctx: ReqCtx, id: string) {
    const today = toDate(todayIST());
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const s = await tx.supplier.findUnique({ where: { id } });
      if (!s) throw notFound('Supplier');
      const links = await tx.supplierItem.findMany({ where: { supplier_id: id } });
      const items = await tx.inventoryItem.findMany({ where: { id: { in: links.map((l) => l.item_id) } }, orderBy: { code: 'asc' }, select: { id: true, code: true, name_en: true, name_ta: true } });
      const base = { ...s, items, itemIds: items.map((i) => i.id) };
      if (!this.seesBalance(ctx)) return { ...base, totals: null };

      const t = (await supplierTotals(tx, [s]))!.get(id)!;
      const open = await tx.purchase.findMany({ where: { supplier_id: id, status: 'ACTIVE', approval_status: 'APPROVED', credit_amount: { gt: 0 } }, select: { credit_amount: true, due_date: true } });
      const overdue = sum(open.filter((o) => o.due_date && o.due_date.getTime() < today.getTime()).map((o) => o.credit_amount));
      const dues = open.filter((o) => o.due_date && o.due_date.getTime() >= today.getTime()).map((o) => o.due_date!.getTime());
      const paymentCount = await tx.supplierPayment.count({ where: { supplier_id: id, status: 'ACTIVE' } });
      return { ...base, totals: { ...t, overdue, nextDue: dues.length ? new Date(Math.min(...dues)) : null, paymentCount } };
    });
  }

  // ------------------------------------------------------------ payment history
  async payments(ctx: ReqCtx, q: PaymentHistoryQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
    const where: Prisma.SupplierPaymentWhereInput = {
      ...(q.supplierId ? { supplier_id: q.supplierId } : {}), ...(q.locationId ? { location_id: q.locationId } : {}), ...(q.status ? { status: q.status as any } : {}),
      ...(q.from || q.to ? { business_date: { ...(q.from ? { gte: toDate(q.from, 'from') } : {}), ...(q.to ? { lte: toDate(q.to, 'to') } : {}) } } : {}),
    };
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [rows, total, agg] = await Promise.all([
        tx.supplierPayment.findMany({ where, orderBy: [{ business_date: 'desc' }, { created_at: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.supplierPayment.count({ where }),
        tx.supplierPayment.aggregate({ where: { ...where, status: 'ACTIVE' }, _sum: { amount: true } }),
      ]);
      const uniq = <T,>(xs: Array<T | null | undefined>) => [...new Set(xs.filter((x): x is T => !!x))];
      const [suppliers, locs, purchases, users] = await Promise.all([
        tx.supplier.findMany({ where: { id: { in: uniq(rows.map((r) => r.supplier_id)) } }, select: { id: true, code: true, name: true } }),
        tx.location.findMany({ where: { id: { in: uniq(rows.map((r) => r.location_id)) } }, select: { id: true, code: true, name: true } }),
        tx.purchase.findMany({ where: { id: { in: uniq(rows.map((r) => r.purchase_id)) } }, select: { id: true, code: true } }),
        tx.user.findMany({ where: { id: { in: uniq(rows.map((r) => r.created_by)) } }, select: { id: true, full_name: true } }),
      ]);
      const data = rows.map((r) => ({
        ...r,
        supplier_code: suppliers.find((s) => s.id === r.supplier_id)?.code, supplier_name: suppliers.find((s) => s.id === r.supplier_id)?.name,
        location_code: locs.find((l) => l.id === r.location_id)?.code, location_name: locs.find((l) => l.id === r.location_id)?.name,
        purchase_code: purchases.find((p) => p.id === r.purchase_id)?.code ?? null, paid_by_name: users.find((u) => u.id === r.created_by)?.full_name ?? null,
      }));
      return new Envelope(data, [], { page, pageSize, total, totalAmount: agg._sum.amount ?? ZERO });
    });
  }

  // ------------------------------------------------------------ due payments
  /** Every credit purchase still unpaid, oldest due first, bucketed (overdue / next 7 days / later / no date) and summed per supplier. */
  async dues(ctx: ReqCtx, q: DuesQuery) {
    const today = toDate(todayIST());
    const soon = new Date(today.getTime() + 7 * 86_400_000);
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [open, suppliers, locs] = await Promise.all([
        tx.purchase.findMany({
          where: {
            status: 'ACTIVE', approval_status: 'APPROVED', credit_amount: { gt: 0 },
            ...(q.supplierId ? { supplier_id: q.supplierId } : {}), ...(q.locationId ? { location_id: q.locationId } : {}),
          },
          orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { business_date: 'asc' }],
        }),
        tx.supplier.findMany({ where: q.supplierId ? { id: q.supplierId } : {}, select: { id: true, code: true, name: true, phone: true, opening_balance: true } }),
        tx.location.findMany({ select: { id: true, code: true, name: true } }),
      ]);
      const bucketOf = (due: Date | null) =>
        !due ? 'nodate' : due.getTime() < today.getTime() ? 'overdue' : due.getTime() <= soon.getTime() ? 'due7' : 'later';
      const rows = open
        .map((p) => ({
          purchaseId: p.id, code: p.code, supplierId: p.supplier_id, supplierCode: suppliers.find((s) => s.id === p.supplier_id)?.code ?? '?',
          supplierName: suppliers.find((s) => s.id === p.supplier_id)?.name ?? '?', locationId: p.location_id,
          locationCode: locs.find((l) => l.id === p.location_id)?.code ?? '?', locationName: locs.find((l) => l.id === p.location_id)?.name ?? '?',
          businessDate: p.business_date, dueDate: p.due_date, totalAmount: p.total_amount, paidAmount: p.paid_amount, creditAmount: p.credit_amount,
          supplierRefNo: p.supplier_ref_no, bucket: bucketOf(p.due_date),
          daysOverdue: p.due_date ? Math.round((today.getTime() - p.due_date.getTime()) / 86_400_000) : null,
        }))
        .filter((r) => !q.bucket || r.bucket === q.bucket);

      // per supplier, plus what is owed that no purchase explains (an opening balance, or a payment made on account)
      const totals = await supplierTotals(tx, suppliers);
      const perSupplier = suppliers
        .map((s) => {
          const mine = open.filter((p) => p.supplier_id === s.id);
          const by = (b: string) => sum(mine.filter((p) => bucketOf(p.due_date) === b).map((p) => p.credit_amount));
          const onAccount = totals.get(s.id)!.outstanding.minus(sum(mine.map((p) => p.credit_amount)));
          const acct = onAccount.greaterThan(0) ? onAccount : ZERO;
          const row = { supplierId: s.id, code: s.code, name: s.name, phone: s.phone, overdue: by('overdue'), due7: by('due7'), later: by('later'), noDate: by('nodate'), onAccount: acct, total: ZERO as Dec };
          row.total = row.overdue.plus(row.due7).plus(row.later).plus(row.noDate).plus(row.onAccount);
          return row;
        })
        .filter((r) => r.total.greaterThan(0))
        .sort((a, b) => b.overdue.comparedTo(a.overdue) || b.total.comparedTo(a.total));

      const all = (k: 'overdue' | 'due7' | 'later' | 'noDate' | 'onAccount') => sum(perSupplier.map((r) => r[k]));
      if (q.bucket && !['overdue', 'due7', 'later', 'nodate'].includes(q.bucket)) throw validation('INVALID_BUCKET', 'Unknown bucket', 'bucket');
      return {
        asOf: today,
        summary: { overdue: all('overdue'), due7: all('due7'), later: all('later'), noDate: all('noDate'), onAccount: all('onAccount'), total: sum(perSupplier.map((r) => r.total)), suppliers: perSupplier.length },
        suppliers: perSupplier,
        rows,
      };
    });
  }
}
