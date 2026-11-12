/**
 * Demo data for the newer dashboard pieces, written the way the app writes it. Idempotent: a branch-day that already has the
 * extras is skipped.
 *
 *   npx tsx prisma/seed-extras.ts --company CMP000 --from 2026-09-26 --to 2026-11-08
 *
 *  - items "Groceries" and "Vegetables" (purchased on credit from a grocery supplier, consumed every day) -> Purchases > Top items
 *  - daily consumption and weekly purchases of "Snacks"                                                   -> Stock consumption chart
 *  - a daily "Allowance" salary expense (and daily wages on days that have none)                          -> Salary trend chart
 *
 * Runs as the database owner. Past days are usually APPROVED and locked, so the inserts bypass the lock triggers
 * (session_replication_role = replica). Nothing here touches cash, so closed days still reconcile.
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

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

async function nextCode(prefix: string, seq: string, loc: string, date: Date) {
  const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('${seq}') AS n`);
  return `${prefix}-${loc}-${fmtDate(date).slice(2, 4)}-${String(n).padStart(6, '0')}`;
}

// code, name, Tamil, category, base unit, purchase unit, rate per base unit, daily kg-ish use per branch (min..max, in base units)
const NEW_ITEMS = [
  { code: 'ITM014', name: 'Groceries', ta: 'மளிகைப் பொருட்கள்', category: 'GROCERIES', base: 'G', purchase: 'KG', rate: '0.06', use: [6000, 12000] },
  { code: 'ITM015', name: 'Vegetables', ta: 'காய்கறிகள்', category: 'VEGETABLES', base: 'G', purchase: 'KG', rate: '0.04', use: [4000, 9000] },
] as const;

async function main() {
  const FROM = toDate(arg('from', '2026-09-26'));
  const TO = toDate(arg('to', fmtDate(new Date())));
  const company = await prisma.company.findFirstOrThrow({ where: { code: arg('company', 'CMP000') } });
  const owner = await prisma.user.findFirstOrThrow({ where: { company_id: company.id, roles: { some: { role: { code: 'ADMIN' } } } } });
  const branches = await prisma.location.findMany({ where: { company_id: company.id, type: 'BRANCH', status: 'ACTIVE' }, orderBy: { code: 'asc' } });
  const units = new Map((await prisma.unit.findMany()).map((u) => [u.code, u]));

  // ---- masters
  for (const n of NEW_ITEMS) {
    if (await prisma.inventoryItem.findFirst({ where: { company_id: company.id, code: n.code } })) continue;
    const item = await prisma.inventoryItem.create({
      data: {
        company_id: company.id, code: n.code, name_en: n.name, name_ta: n.ta, category: n.category, base_unit_id: units.get(n.base)!.id,
        purchase_unit_id: units.get(n.purchase)!.id, is_perishable: n.category === 'VEGETABLES', last_purchase_rate: D(n.rate), avg_cost: D(n.rate),
      },
    });
    for (const b of branches) {
      await prisma.itemLocationSetting.upsert({
        where: { item_id_location_id: { item_id: item.id, location_id: b.id } }, update: {}, create: { item_id: item.id, location_id: b.id, min_stock: D(5000) },
      });
    }
  }
  let grocer = await prisma.supplier.findFirst({ where: { company_id: company.id, name: 'Grocery & vegetable supplier' } });
  if (!grocer) {
    const code = `SUP${String((await prisma.supplier.count({ where: { company_id: company.id } })) + 1).padStart(4, '0')}`;
    grocer = await prisma.supplier.create({ data: { company_id: company.id, code, name: 'Grocery & vegetable supplier', payment_terms_days: 3 } });
  }
  const snackVendor = (await prisma.supplier.findFirst({ where: { company_id: company.id, name: 'Snacks vendor' } })) ?? grocer;

  const salary = await prisma.expenseCategory.findFirstOrThrow({ where: { company_id: company.id, name_en: 'Salary', parent_id: null } });
  let allowance = await prisma.expenseCategory.findFirst({ where: { company_id: company.id, parent_id: salary.id, name_en: 'Allowance' } });
  if (!allowance) allowance = await prisma.expenseCategory.create({ data: { company_id: company.id, parent_id: salary.id, name_en: 'Allowance', name_ta: 'படி', pl_bucket: 'SALARY', sort_order: 9 } });
  const wages = await prisma.expenseCategory.findFirst({ where: { company_id: company.id, parent_id: salary.id, name_en: 'Daily wages' } });

  const items = await prisma.inventoryItem.findMany({ where: { company_id: company.id, code: { in: ['ITM011', 'ITM014', 'ITM015'] } } });
  const byCode = new Map(items.map((i) => [i.code, i]));
  const snacks = byCode.get('ITM011');

  let rows = 0;
  for (const [bi, b] of branches.entries()) {
    const manager = b.manager_user_id ? await prisma.user.findUnique({ where: { id: b.manager_user_id } }) : null;
    const actor = manager ?? owner;
    const rand = rng(7000 + bi);
    const bal = new Map<string, Prisma.Decimal>();
    for (const s of await prisma.stockBalance.findMany({ where: { location_id: b.id, item_id: { in: items.map((i) => i.id) } } })) bal.set(s.item_id, s.quantity);

    for (let date = FROM; date.getTime() <= TO.getTime(); date = addDays(date, 1)) {
      const ds = fmtDate(date);
      const dayNo = Math.round(date.getTime() / 86_400_000);
      const rolls = [rand(), rand(), rand(), rand(), rand(), rand()]; // fixed draw count per day keeps the series stable
      const done = await prisma.inventoryTransaction.count({ where: { location_id: b.id, business_date: date, item_id: byCode.get('ITM014')?.id, source_type: 'EXTRAS' } });
      if (done) continue;

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        const post = async (itemId: string, type: 'OPENING' | 'PURCHASE_IN' | 'CONSUMPTION', qty: Prisma.Decimal, cost: Prisma.Decimal, srcId: string) => {
          const after = (bal.get(itemId) ?? D(0)).plus(qty);
          bal.set(itemId, after);
          await tx.inventoryTransaction.create({
            data: {
              location_id: b.id, item_id: itemId, business_date: date, txn_type: type, quantity: qty, unit_cost: cost, value: qty.mul(cost).toDecimalPlaces(2),
              balance_after: after, source_type: 'EXTRAS', source_id: srcId, created_by: actor.id,
            },
          });
        };
        const buy = async (it: (typeof items)[number], supplier: { id: string; payment_terms_days: number }, purchaseQty: number, refTag: string) => {
          const unit = units.get(it.purchase_unit_id === units.get('KG')!.id ? 'KG' : 'PCS')!;
          const factor = unit.factor_to_base;
          const qty = D(purchaseQty);
          const baseQty = qty.mul(factor);
          const rate = (it.last_purchase_rate ?? it.avg_cost).mul(factor).toDecimalPlaces(4);
          const total = qty.mul(rate).toDecimalPlaces(2);
          const p = await tx.purchase.create({
            data: {
              code: await nextCode('PUR', 'seq_code_purchase', b.code, date), location_id: b.id, business_date: date, supplier_id: supplier.id,
              supplier_ref_no: `INV-${ds.replace(/-/g, '').slice(2)}-${bi + 1}${refTag}`, subtotal: total, total_amount: total, payment_mode: 'CREDIT', paid_amount: D(0),
              credit_amount: total, due_date: addDays(date, supplier.payment_terms_days), approval_status: 'APPROVED', approved_by: owner.id, approved_at: date,
              entered_by: actor.id, source: 'SYSTEM',
              items: { create: [{ item_id: it.id, line_no: 1, quantity: qty, unit_id: unit.id, base_quantity: baseQty, rate, line_total: total }] },
            },
          });
          await tx.supplierItem.createMany({ data: [{ supplier_id: supplier.id, item_id: it.id }], skipDuplicates: true });
          await tx.supplierLedger.create({
            data: { supplier_id: supplier.id, entry_date: date, entry_type: 'PURCHASE', debit: total, credit: D(0), source_type: 'PURCHASE', source_id: p.id, due_date: p.due_date, location_id: b.id, narration: p.code, created_by: actor.id },
          });
          await post(it.id, 'PURCHASE_IN', baseQty, total.div(baseQty).toDecimalPlaces(4), p.id);
          rows++;
        };

        // groceries and vegetables: used every day, restocked on credit every few days
        for (const [k, n] of NEW_ITEMS.entries()) {
          const it = byCode.get(n.code)!;
          const use = D(Math.round(n.use[0] + rolls[k] * (n.use[1] - n.use[0]))).mul(0.85 + bi * 0.05).round();
          const every = k === 0 ? 3 : 2;
          if ((bal.get(it.id) ?? D(0)).lessThan(use.mul(2)) || (dayNo + bi) % every === 0) await buy(it, grocer!, k === 0 ? 30 + Math.round(rolls[4] * 10) : 20 + Math.round(rolls[5] * 8), `${k + 1}`);
          await post(it.id, 'CONSUMPTION', use.neg(), it.avg_cost, b.id);
        }
        // snacks (pieces): sold every day, restocked every 3 days
        if (snacks) {
          const use = D(Math.round(45 + rolls[2] * 90)).mul(0.9 + bi * 0.04).round();
          if ((bal.get(snacks.id) ?? D(0)).lessThan(use.mul(2)) || (dayNo + bi) % 3 === 0) await buy(snacks, snackVendor!, 250, '3');
          await post(snacks.id, 'CONSUMPTION', use.neg(), snacks.avg_cost, b.id);
        }

        // salary side: a daily allowance, and daily wages when the day has no salary expense yet
        const mk = async (cat: { id: string }, sub: { id: string } | null, amount: Prisma.Decimal, note: string) => {
          await tx.expense.create({
            data: {
              code: await nextCode('EXP', 'seq_code_expense', b.code, date), location_id: b.id, business_date: date, category_id: cat.id, sub_category_id: sub?.id,
              amount, payment_mode: 'BANK_TRANSFER', description: note, approval_status: 'APPROVED', approved_by: owner.id, approved_at: date, entered_by: actor.id, source: 'SYSTEM',
            },
          });
          rows++;
        };
        const hasWages = await tx.expense.count({ where: { location_id: b.id, business_date: date, category_id: salary.id, status: 'ACTIVE' } });
        await mk(salary, allowance!, D(Math.round((150 + rolls[3] * 250) / 10) * 10), 'Daily allowance');
        if (wages && !hasWages) await mk(salary, wages, D(Math.round((1200 + rolls[1] * 1300) / 50) * 50), 'Daily wages');
      }, { timeout: 60000 });
    }

    for (const [itemId, qty] of bal) {
      const it = items.find((i) => i.id === itemId)!;
      await prisma.stockBalance.upsert({
        where: { location_id_item_id: { location_id: b.id, item_id: itemId } },
        update: { quantity: qty, avg_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2), last_txn_at: new Date() },
        create: { location_id: b.id, item_id: itemId, quantity: qty, avg_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2), last_txn_at: new Date() },
      });
    }
  }
  // ---- outside-shop orders (meetings, functions, parties) with paid / partly paid / unpaid status
  if ((await prisma.order.count({ where: { company_id: company.id } })) === 0) {
    const SAMPLE: Array<[string, string, string, number, string, number, number, string, number, string]> = [
      // customer, phone, event type, days from today, venue, people, amount, items, paid, status
      ['Sri Rama Traders', '9840011223', 'BUSINESS_MEETING', -12, 'Mount Road office', 25, 6500, 'Tea and coffee, 25 cups x 3 rounds, snacks', 6500, 'DELIVERED'],
      ['Kavitha Wedding Reception', '9841122334', 'FUNCTION', -9, 'Kalyana Mandapam, T Nagar', 300, 42000, 'Tea and coffee counter for 300 guests, snacks', 20000, 'DELIVERED'],
      ['Anand Birthday Party', '9842233445', 'PARTY', -6, 'Adyar flat 4B', 40, 8800, 'Tea, coffee, 2 snack varieties', 8800, 'DELIVERED'],
      ['Infotech Solutions', '9843344556', 'CORPORATE', -4, 'OMR campus, Tower 2', 120, 21600, 'Daily tea service for 3 days', 10000, 'DELIVERED'],
      ['Lakshmi Housewarming', '9844455667', 'FUNCTION', -2, 'Velachery', 80, 14400, 'Tea, coffee and snacks', 0, 'DELIVERED'],
      ['Rotary Club Meeting', '9845566778', 'BUSINESS_MEETING', 1, 'Club hall, Anna Nagar', 60, 9000, 'Tea, coffee and snacks for 60', 3000, 'PLANNED'],
      ['Madras Exports', '9846677889', 'CORPORATE', 2, 'Guindy', 45, 7200, 'Tea and snacks, 45 people', 0, 'PLANNED'],
      ['Priya Engagement', '9847788990', 'FUNCTION', 4, 'Tambaram hall', 200, 30000, 'Tea and coffee counter, snacks', 15000, 'PLANNED'],
      ['School Annual Day', '9848899001', 'FUNCTION', 6, 'Chrompet', 350, 52500, 'Tea, coffee and snacks for 350', 52500, 'PLANNED'],
      ['Builders Association', '9849900112', 'BUSINESS_MEETING', 9, 'Porur', 30, 4800, 'Tea and coffee, 2 rounds', 0, 'PLANNED'],
      ['Ravi Anniversary Party', '9840123456', 'PARTY', 12, 'Adyar', 70, 12600, 'Tea, coffee and snacks', 5000, 'PLANNED'],
      ['Tech Meetup', '9841234567', 'BUSINESS_MEETING', -1, 'T Nagar co-working', 50, 7500, 'Tea and snacks, cancelled by the customer', 0, 'CANCELLED'],
    ];
    const today = toDate(fmtDate(new Date()));
    let n = 0;
    for (const [i, [customer, phone, type, off, venue, people, amount, itemsText, paid, status]] of SAMPLE.entries()) {
      const b = branches[i % branches.length];
      const date = addDays(today, off);
      const [{ n: seq }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('seq_code_order') AS n`);
      const amt = D(amount), pd = D(paid);
      await prisma.order.create({
        data: {
          company_id: company.id, code: `ORD-${b.code}-${fmtDate(date).slice(2, 4)}-${String(seq).padStart(6, '0')}`, location_id: b.id, customer_name: customer, customer_phone: phone,
          event_type: type, event_date: date, event_time: ['09:00', '11:30', '16:00', '18:30'][i % 4], venue, items_summary: itemsText, people_count: people, amount: amt, paid_amount: pd,
          payment_status: pd.lte(0) ? 'UNPAID' : pd.gte(amt) ? 'PAID' : 'PARTIAL', status, entered_by: owner.id, created_by: owner.id, updated_by: owner.id,
          ...(paid > 0 ? { payments: { create: paid === amount ? [{ paid_on: addDays(date, -1), amount: pd, mode: 'UPI', reference: 'Full payment', created_by: owner.id }] : [
            { paid_on: addDays(date, -5), amount: D(Math.round(paid / 2)), mode: 'CASH', reference: 'Advance', created_by: owner.id },
            { paid_on: addDays(date, -1), amount: pd.minus(Math.round(paid / 2)), mode: 'UPI', created_by: owner.id }] } } : {}),
        },
      });
      n++;
    }
    console.log(`Orders: ${n} sample orders`);
  }

  console.log(`Extras ${fmtDate(FROM)}..${fmtDate(TO)}: ${rows} purchases / expenses written for ${branches.length} branches.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
