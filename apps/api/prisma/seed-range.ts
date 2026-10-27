/**
 * Dummy history for a date range, written the way the app writes it (sales, expenses, cash ledger, reconciliation, closing,
 * purchases with supplier ledger, wastage and stock movements). Deterministic and idempotent: a branch-day that already has
 * sales is skipped, and a day whose closing is already APPROVED is never touched.
 *
 *   npx tsx prisma/seed-range.ts                              26 Sep 2026 .. 24 Oct 2026
 *   npx tsx prisma/seed-range.ts --from 2026-09-26 --to 2026-10-24 --company CMP001   (default: the first company)
 *
 * Runs as the database owner (DIRECT_URL), so it is not subject to RLS. Requires `npm run db:seed` (company, masters, users) first.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { addDays, fmtDate, toDate } from '../src/common/dates';

try {
  (process as any).loadEnvFile?.('.env');
} catch {
  /* no .env */
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const FROM = toDate(arg('from', '2026-09-26'));
const TO = toDate(arg('to', '2026-10-24'));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

async function nextCode(prefix: string, seq: string, loc: string, date: Date) {
  const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('${seq}') AS n`);
  return `${prefix}-${loc}-${fmtDate(date).slice(2, 4)}-${String(n).padStart(6, '0')}`;
}

const WEEKDAY = [1.15, 0.9, 0.9, 0.95, 1.0, 1.1, 1.25]; // Sun..Sat
const PER_CUP: Array<[string, number]> = [['ITM001', 90], ['ITM002', 4], ['ITM004', 8], ['ITM008', 1]]; // tea recipe, per cup
const SUPPLIER_OF: Record<string, string> = { ITM001: 'SUP0001', ITM002: 'SUP0002', ITM004: 'SUP0002', ITM008: 'SUP0003' };
const WASTE_ITEMS = ['ITM001', 'ITM002', 'ITM004'];
const WASTE_REASONS = ['SPOILED', 'EXCESS_PREPARATION', 'BURNT', 'DAMAGED'] as const;

async function main() {
  const companyCode = arg('company', '');
  const company = await prisma.company.findFirstOrThrow({ where: companyCode ? { code: companyCode } : {}, orderBy: { code: 'asc' } });
  const owner = await prisma.user.findFirstOrThrow({ where: { company_id: company.id, roles: { some: { role: { code: 'ADMIN' } } } } });
  const branches = await prisma.location.findMany({ where: { company_id: company.id, type: 'BRANCH', status: 'ACTIVE' }, orderBy: { code: 'asc' } });
  const cats = await prisma.expenseCategory.findMany({ where: { company_id: company.id, parent_id: null, status: 'ACTIVE' } });
  const items = await prisma.inventoryItem.findMany({ where: { company_id: company.id } });
  const units = await prisma.unit.findMany();
  const suppliers = await prisma.supplier.findMany({ where: { company_id: company.id } });
  const item = (code: string) => items.find((i) => i.code === code)!;
  const lastDay = TO.getTime();
  let days = 0, purchases = 0, wastes = 0;

  for (const [bi, b] of branches.entries()) {
    const manager = b.manager_user_id ? await prisma.user.findUnique({ where: { id: b.manager_user_id } }) : null;
    const actor = manager ?? owner;
    const rand = rng(2000 + bi);

    // cash carried in from the last reconciliation before the range
    const prev = await prisma.cashReconciliation.findFirst({
      where: { location_id: b.id, business_date: { lt: FROM }, NOT: { actual_closing: null } }, orderBy: { business_date: 'desc' },
    });
    let opening = prev?.actual_closing ?? b.default_opening_cash ?? D(2000);

    // running stock: start from the stored balance, or open the day before the range with ~3 days' cover
    const bal = new Map<string, Prisma.Decimal>();
    const stored = await prisma.stockBalance.findMany({ where: { location_id: b.id } });
    for (const s of stored) { const it = items.find((i) => i.id === s.item_id); if (it) bal.set(it.code, s.quantity); }
    for (const i of items) if (!bal.has(i.code) && PER_CUP.some(([c]) => c === i.code)) bal.set(i.code, D(0));
    const post = async (code: string, date: Date, type: 'OPENING' | 'PURCHASE_IN' | 'CONSUMPTION' | 'WASTAGE', qty: Prisma.Decimal, unitCost: Prisma.Decimal, src: string, srcId: string) => {
      const it = item(code);
      bal.set(code, (bal.get(code) ?? D(0)).plus(qty));
      await prisma.inventoryTransaction.create({
        data: {
          location_id: b.id, item_id: it.id, business_date: date, txn_type: type, quantity: qty, unit_cost: unitCost,
          value: qty.mul(unitCost).toDecimalPlaces(2), balance_after: bal.get(code)!, source_type: src, source_id: srcId, created_by: actor.id,
        },
      });
    };
    const avgCups = D(32000).div(15); // planning figure for stock cover
    for (const [code, per] of PER_CUP) {
      if ((bal.get(code) ?? D(0)).lessThan(avgCups.mul(per).mul(2))) {
        const need = avgCups.mul(per).mul(3).minus(bal.get(code) ?? D(0)).toDecimalPlaces(3);
        await post(code, addDays(FROM, -1), 'OPENING', need, item(code).avg_cost, 'OPENING', b.id);
      }
    }

    for (let date = FROM; date.getTime() <= lastDay; date = addDays(date, 1)) {
      const isToday = date.getTime() === lastDay;
      const ds = fmtDate(date);
      if (await prisma.dailySales.findFirst({ where: { location_id: b.id, business_date: date, status: 'ACTIVE' } })) continue;
      if ((await prisma.dailyClosing.findFirst({ where: { location_id: b.id, business_date: date } }))?.status === 'APPROVED') continue;

      // a few days the branch simply has not closed yet, so the dashboard has pending closings to show
      const missed = (bi === 0 && (ds === '2026-10-23' || ds === '2026-10-21')) || (bi === 2 && ds === '2026-10-23');
      const status = isToday || missed ? 'PENDING' : bi === 1 && ds === '2026-10-23' ? 'SUBMITTED' : 'APPROVED';
      const rolls = [rand(), rand(), rand(), rand(), rand(), rand()]; // fixed draw count per day keeps the series stable
      if (missed) {
        await prisma.dailyClosing.upsert({
          where: { location_id_business_date: { location_id: b.id, business_date: date } },
          update: { status: 'PENDING' }, create: { location_id: b.id, business_date: date, status: 'PENDING' },
        });
        continue;
      }

      const locked = status === 'APPROVED';
      const total = D(Math.round((25000 + rolls[0] * 15000) * WEEKDAY[date.getUTCDay()]));
      const upi = total.mul('0.55').toDecimalPlaces(2);
      const card = b.card_enabled ? total.mul('0.03').toDecimalPlaces(2) : D(0);
      const cash = total.minus(upi).minus(card);
      const sales = await prisma.dailySales.create({
        data: {
          location_id: b.id, business_date: date, total_sales: total, cash_sales: cash, upi_sales: upi, card_sales: card,
          mismatch_amount: D(0), submitted_by: actor.id, submitted_at: date, source: 'SYSTEM', is_locked: locked,
        },
      });

      // 2-4 expenses, mostly cash
      let cashOut = D(0);
      const n = 2 + Math.floor(rolls[1] * 3);
      for (let k = 0; k < n; k++) {
        const cat = cats[Math.floor(rand() * cats.length)];
        const amount = D(Math.round(200 + rand() * 2800));
        const mode = rand() < 0.8 ? 'CASH' : 'UPI';
        const e = await prisma.expense.create({
          data: {
            code: await nextCode('EXP', 'seq_code_expense', b.code, date), location_id: b.id, business_date: date, category_id: cat.id, amount,
            payment_mode: mode, approval_status: 'APPROVED', approved_by: owner.id, approved_at: date, entered_by: actor.id, source: 'SYSTEM',
          },
        });
        if (mode === 'CASH') {
          cashOut = cashOut.plus(amount);
          await prisma.cashTransaction.create({
            data: { location_id: b.id, business_date: date, txn_type: 'EXPENSE', direction: -1, amount, source_type: 'EXPENSE', source_id: e.id, source: 'SYSTEM' },
          });
        }
      }

      // restock whatever is running low: buy ~5 days' cover, paid in cash when the till can take it, else on credit
      let cashPurchases = D(0);
      let purchaseTotal = D(0);
      for (const [code, per] of PER_CUP) {
        const perDay = total.div(15).mul(per);
        if ((bal.get(code) ?? D(0)).greaterThan(perDay.mul(2))) continue;
        const it = item(code);
        const unit = units.find((u) => u.id === it.purchase_unit_id)!;
        const factor = unit.factor_to_base;
        const qty = perDay.mul(5).div(factor).ceil();
        const baseQty = qty.mul(factor);
        const rate = (it.last_purchase_rate ?? it.avg_cost).mul(factor).toDecimalPlaces(4);
        const lineTotal = qty.mul(rate).toDecimalPlaces(2);
        const sup = suppliers.find((s) => s.code === SUPPLIER_OF[code])!;
        const canPayCash = opening.plus(cash).minus(cashOut).minus(cashPurchases).minus(lineTotal).greaterThan(3000) && rand() < 0.5;
        const p = await prisma.purchase.create({
          data: {
            code: await nextCode('PUR', 'seq_code_purchase', b.code, date), location_id: b.id, business_date: date, supplier_id: sup.id,
            supplier_ref_no: `INV-${ds.replace(/-/g, '').slice(2)}-${bi + 1}${code.slice(-1)}`, subtotal: lineTotal, total_amount: lineTotal,
            payment_mode: canPayCash ? 'CASH' : 'CREDIT', paid_amount: canPayCash ? lineTotal : D(0), credit_amount: canPayCash ? D(0) : lineTotal,
            due_date: canPayCash ? null : addDays(date, sup.payment_terms_days), approval_status: 'APPROVED', approved_by: owner.id, approved_at: date,
            entered_by: actor.id, source: 'SYSTEM',
            items: { create: [{ item_id: it.id, line_no: 1, quantity: qty, unit_id: unit.id, base_quantity: baseQty, rate, line_total: lineTotal }] },
          },
        });
        await prisma.supplierItem.createMany({ data: [{ supplier_id: sup.id, item_id: it.id }], skipDuplicates: true });
        await prisma.supplierLedger.create({
          data: {
            supplier_id: sup.id, entry_date: date, entry_type: 'PURCHASE', debit: lineTotal, credit: D(0), source_type: 'PURCHASE', source_id: p.id,
            due_date: p.due_date, location_id: b.id, narration: p.code, created_by: actor.id,
          },
        });
        if (canPayCash) {
          cashPurchases = cashPurchases.plus(lineTotal);
          await prisma.supplierLedger.create({
            data: {
              supplier_id: sup.id, entry_date: date, entry_type: 'PAYMENT', debit: D(0), credit: lineTotal, source_type: 'PURCHASE', source_id: p.id,
              location_id: b.id, narration: `Paid with ${p.code}`, created_by: actor.id,
            },
          });
          await prisma.cashTransaction.create({
            data: { location_id: b.id, business_date: date, txn_type: 'PURCHASE', direction: -1, amount: lineTotal, source_type: 'PURCHASE', source_id: p.id, source: 'SYSTEM' },
          });
        }
        await post(code, date, 'PURCHASE_IN', baseQty, lineTotal.div(baseQty).toDecimalPlaces(4), 'PURCHASE', p.id);
        purchaseTotal = purchaseTotal.plus(lineTotal);
        purchases++;
      }

      // wastage on roughly half the days (written before the closing row so an approved day does not lock it out)
      let wasteValue = D(0);
      if (rolls[2] < 0.45) {
        const it = item(WASTE_ITEMS[Math.floor(rolls[3] * WASTE_ITEMS.length)]);
        const qty = D(Math.round(300 + rolls[4] * 1700)).div(it.code === 'ITM001' ? 1 : 10).toDecimalPlaces(3);
        const w = await prisma.wastage.create({
          data: {
            code: await nextCode('WST', 'seq_code_wastage', b.code, date), location_id: b.id, business_date: date, item_id: it.id, quantity: qty,
            unit_id: it.base_unit_id, base_quantity: qty, estimated_value: qty.mul(it.avg_cost).toDecimalPlaces(2),
            reason: WASTE_REASONS[Math.floor(rolls[5] * WASTE_REASONS.length)], entered_by: actor.id, approval_status: 'APPROVED',
            approved_by: owner.id, approved_at: date, source: 'SYSTEM',
          },
        });
        wasteValue = w.estimated_value;
        await post(it.code, date, 'WASTAGE', qty.neg(), it.avg_cost, 'WASTAGE', w.id);
        wastes++;
      }

      let recon = null as Awaited<ReturnType<typeof prisma.cashReconciliation.create>> | null;
      let expected = D(0), actual = D(0), variance = D(0);
      if (!isToday) {
        // bank deposit keeps the till near 2,500 instead of growing for ever
        const beforeDeposit = opening.plus(cash).minus(cashOut).minus(cashPurchases);
        const withdrawal = beforeDeposit.greaterThan(3000) ? beforeDeposit.minus(2500).div(500).floor().mul(500) : D(0);
        if (withdrawal.greaterThan(0)) {
          await prisma.cashTransaction.create({
            data: { location_id: b.id, business_date: date, txn_type: 'DEPOSIT_TO_BANK', direction: -1, amount: withdrawal, description: 'Deposit to bank', source: 'SYSTEM' },
          });
        }
        expected = beforeDeposit.minus(withdrawal);
        const shortage = rand() < 1 / 14 ? D(Math.round(100 + rand() * 300)) : D(0); // roughly one a fortnight
        actual = expected.minus(shortage);
        variance = actual.minus(expected);
        recon = await prisma.cashReconciliation.create({
          data: {
            location_id: b.id, business_date: date, opening_cash: opening, cash_sales: cash, other_receipts: D(0), cash_expenses: cashOut,
            cash_purchases: cashPurchases, other_cash_out: D(0), withdrawals: withdrawal, expected_closing: expected, actual_closing: actual, variance,
            variance_reason: variance.isZero() ? null : 'COUNTING_ERROR',
            manager_explanation: variance.isZero() ? null : 'Change given short during the evening rush.',
            variance_approval: variance.isZero() ? null : 'APPROVED', approved_by: variance.isZero() ? null : owner.id, is_locked: locked,
          },
        });
        opening = actual;
      }

      const expTotal = (await prisma.expense.aggregate({ where: { location_id: b.id, business_date: date }, _sum: { amount: true } }))._sum.amount ?? D(0);
      const base = {
        location_id: b.id, business_date: date, status: status as any,
        ...(isToday
          ? {}
          : {
              daily_sales_id: sales.id, cash_reconciliation_id: recon!.id, total_sales: total, cash_sales: cash, upi_sales: upi, card_sales: card,
              total_expenses: expTotal, total_purchases: purchaseTotal, total_wastage_value: wasteValue, expected_cash: expected, actual_cash: actual,
              cash_variance: variance, submitted_by: actor.id, submitted_at: date,
              reviewed_by: status === 'APPROVED' ? owner.id : null, reviewed_at: status === 'APPROVED' ? date : null,
            }),
      };
      // the closing row goes in last: once APPROVED, the lock trigger freezes the day
      const closing = await prisma.dailyClosing.upsert({
        where: { location_id_business_date: { location_id: b.id, business_date: date } }, update: base, create: base,
      });
      if (!isToday) {
        await prisma.dailyClosingEvent.create({
          data: { daily_closing_id: closing.id, from_status: 'PENDING', to_status: 'SUBMITTED', actor_id: actor.id, created_at: date },
        });
        for (const [code, per] of PER_CUP) {
          const used = total.div(15).mul(per).mul(0.9 + rand() * 0.2).toDecimalPlaces(3);
          await post(code, date, 'CONSUMPTION', used.neg(), item(code).avg_cost, 'CLOSING', closing.id);
        }
      }
      days++;
    }

    // stock balances after the range
    for (const [code, qty] of bal) {
      const it = items.find((i) => i.code === code);
      if (!it) continue;
      await prisma.stockBalance.upsert({
        where: { location_id_item_id: { location_id: b.id, item_id: it.id } },
        update: { quantity: qty, avg_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2), last_txn_at: new Date() },
        create: { location_id: b.id, item_id: it.id, quantity: qty, avg_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2), last_txn_at: new Date() },
      });
    }
  }
  console.log(`Range ${fmtDate(FROM)}..${fmtDate(TO)}: ${days} branch-days, ${purchases} purchases, ${wastes} wastage entries.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
