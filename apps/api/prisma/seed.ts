/**
 * Seed (LLD s19). Runs as the database owner (DIRECT_URL) so it is not subject to RLS.
 *
 *   npm run db:seed                 Super Admin + units + one demo company (Admin, Accountant, Stock Manager, branch managers)
 *   npm run db:seed -- --demo       + 30 days of consistent branch history for dashboards/tests
 *   SEED_MINIMAL=1 (or --minimal)   production bootstrap: units and ONE Super Admin (no company: the Super Admin creates them)
 *   SEED_PASSWORD=...               password for the Super Admin (required in production)
 *
 * Demo sign-ins (OTP is whatever OTP_FIXED_CODE says, 123456 in .env.example):
 *   Super Admin  username superadmin + password
 *   Admin        mobile 9000000001 + password Admin@1234, then OTP
 *   others       mobile + OTP (Accountant 9000000002, Stock Manager 9000000003, branch managers 9000000011..)
 *   Every user also has a role-based default password (Account@1234, StkMr@1234, Manager@1234 ...) and is asked to change it after the first sign-in.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { defaultPasswordFor } from '../src/auth/passwords';
import { ensureSuperAdminRole, provisionCompanyDefaults } from '../src/admin/company-defaults';
import { addDays, fmtDate, toDate, todayIST } from '../src/common/dates';

try {
  (process as any).loadEnvFile?.('.env');
} catch {
  /* no .env */
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DEMO = process.argv.includes('--demo');
const MINIMAL = process.env.SEED_MINIMAL === '1' || process.argv.includes('--minimal');

// ---------------------------------------------------------------- masters (tea shop template)
// Tamil display names (keep in step with migration 20260926000400_tamil_names). Have a native speaker review.
const TA: Record<string, string> = {
  'Anna Nagar': 'அண்ணா நகர்', 'T Nagar': 'தி. நகர்', Velachery: 'வேளச்சேரி', Adyar: 'அடையாறு', Tambaram: 'தாம்பரம்',
  Porur: 'போரூர்', 'Central Godown': 'மத்திய கிடங்கு', 'Head Office': 'தலைமை அலுவலகம்',
  Milk: 'பால்', 'Tea powder': 'தேயிலைத் தூள்', Coffee: 'காபி', Sugar: 'சர்க்கரை',
  'Snacks / raw materials': 'சிற்றுண்டி / மூலப்பொருட்கள்', Salary: 'சம்பளம்', 'Staff advance': 'ஊழியர் முன்பணம்',
  Rent: 'வாடகை', Electricity: 'மின்சாரம்', Gas: 'எரிவாயு', Transport: 'போக்குவரத்து', Maintenance: 'பராமரிப்பு',
  Repairs: 'பழுதுபார்ப்பு', Cleaning: 'சுத்தம்', 'Cooking oil': 'சமையல் எண்ணெய்', Packaging: 'பேக்கிங்', Miscellaneous: 'இதர',
  'Coffee powder': 'காபித் தூள்', Ginger: 'இஞ்சி', Cardamom: 'ஏலக்காய்', 'Paper cup 150 ml': 'காகிதக் குவளை 150 மி.லி',
  Glass: 'கண்ணாடி டம்ளர்', 'Water bottle 1 L': 'தண்ணீர் பாட்டில் 1 லி',
  Snacks: 'சிற்றுண்டிகள்', 'Packaging material': 'பேக்கிங் பொருட்கள்', 'Other raw materials': 'மற்ற மூலப்பொருட்கள்',
};

const LOCATIONS = [
  ['BR001', 'Anna Nagar', 'BRANCH'], ['BR002', 'T Nagar', 'BRANCH'], ['BR003', 'Velachery', 'BRANCH'],
  ['BR004', 'Adyar', 'BRANCH'], ['BR005', 'Tambaram', 'BRANCH'], ['BR006', 'Porur', 'BRANCH'],
  ['GDN01', 'Central Godown', 'GODOWN'], ['HO01', 'Head Office', 'CENTRAL_OFFICE'],
] as const;

const UNITS: Array<[string, string, string | null, string]> = [
  ['ML', 'Millilitre', null, '1'], ['L', 'Litre', 'ML', '1000'],
  ['G', 'Gram', null, '1'], ['KG', 'Kilogram', 'G', '1000'],
  ['PCS', 'Piece', null, '1'], ['PKT', 'Packet (50 pcs)', 'PCS', '50'],
];

// code, name, base unit, purchase unit, last rate per base unit, daily count, min stock per branch
const ITEMS: Array<[string, string, string, string, string, string, boolean, string]> = [
  ['ITM001', 'Milk', 'DAIRY', 'ML', '0.056', 'L', true, '20000'],
  ['ITM002', 'Tea powder', 'BEVERAGE_BASE', 'G', '0.50', 'KG', true, '1000'],
  ['ITM003', 'Coffee powder', 'BEVERAGE_BASE', 'G', '0.90', 'KG', true, '500'],
  ['ITM004', 'Sugar', 'GRAIN', 'G', '0.045', 'KG', false, '5000'],
  ['ITM005', 'Ginger', 'SPICE', 'G', '0.12', 'KG', false, '500'],
  ['ITM006', 'Cardamom', 'SPICE', 'G', '2.80', 'KG', false, '100'],
  ['ITM007', 'Cooking oil', 'FUEL', 'ML', '0.14', 'L', false, '2000'],
  ['ITM008', 'Paper cup 150 ml', 'PACKAGING', 'PCS', '1.20', 'PKT', false, '500'],
  ['ITM009', 'Glass', 'CONSUMABLE', 'PCS', '25.00', 'PCS', false, '20'],
  ['ITM010', 'Water bottle 1 L', 'CONSUMABLE', 'PCS', '12.00', 'PCS', false, '24'],
  ['ITM011', 'Snacks', 'SNACKS', 'PCS', '8.00', 'PCS', false, '40'],
  ['ITM012', 'Packaging material', 'PACKAGING', 'PCS', '3.00', 'PCS', false, '100'],
  ['ITM013', 'Other raw materials', 'RAW_MATERIAL', 'G', '0.10', 'KG', false, '1000'],
];

const SUPPLIERS: Array<[string, string, number]> = [
  ['SUP0001', 'Dairy supplier', 1], ['SUP0002', 'Tea wholesaler', 15],
  ['SUP0003', 'Packaging supplier', 30], ['SUP0004', 'Snacks vendor', 7],
];

async function seedUnits() {
  for (const [code, name, base, factor] of UNITS) {
    const baseUnit = base ? await prisma.unit.findUnique({ where: { code: base } }) : null;
    await prisma.unit.upsert({
      where: { code }, update: {},
      create: { code, name, base_unit_id: baseUnit?.id ?? null, factor_to_base: D(factor) },
    });
  }
  return new Map((await prisma.unit.findMany()).map((u) => [u.code, u.id]));
}

async function main() {
  const password = process.env.SEED_PASSWORD ?? (process.env.NODE_ENV === 'production' ? undefined : 'ChangeMe@123');
  if (!password) throw new Error('SEED_PASSWORD is required in production');
  if (MINIMAL && password === 'ChangeMe@123') throw new Error('Set a real SEED_PASSWORD for a production seed');
  const passwordHash = await argon2.hash(password);

  // ---- the Super Admin: signs in with username + password only; creates companies
  const superRoleId = await ensureSuperAdminRole(prisma);
  if (!(await prisma.user.findUnique({ where: { username: 'superadmin' } }))) {
    await prisma.user.create({
      data: { username: 'superadmin', full_name: 'Super Admin', password_hash: passwordHash, company_id: null, roles: { create: [{ role_id: superRoleId }] } },
    });
  }
  const unitId = await seedUnits();

  // Production bootstrap: no demo company. The Super Admin signs in and creates each company (with its Admin).
  if (MINIMAL) {
    console.log("Minimal seed done: units and Super Admin 'superadmin'.");
    console.log('Sign in as superadmin with SEED_PASSWORD, change it straight away, then create your first company.');
    return;
  }

  // ---- one demo company (the company created by the multi-company migration when it moved existing data, else a new one)
  let company = await prisma.company.findFirst({ orderBy: { code: 'asc' } });
  if (!company) {
    const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('seq_code_company') AS n`);
    company = await prisma.company.create({ data: { code: `CMP${String(n).padStart(3, '0')}`, name: 'Demo Tea Shop', address: 'Anna Nagar, Chennai' } });
  }
  const companyId = company.id;
  const roleId = await provisionCompanyDefaults(prisma, companyId, company.name);

  // ---- locations
  const openedOn = DEMO ? toDate(fmtDate(addDays(toDate(todayIST()), -45))) : null;
  for (const [code, name, type] of LOCATIONS) {
    const found = await prisma.location.findFirst({ where: { company_id: companyId, code } });
    if (!found) {
      await prisma.location.create({
        data: { company_id: companyId, code, name, name_ta: TA[name], type, default_opening_cash: type === 'BRANCH' ? D(2000) : D(0), opened_on: type === 'BRANCH' ? openedOn : null },
      });
    }
  }
  const locs = await prisma.location.findMany({ where: { company_id: companyId } });
  const locId = new Map(locs.map((l) => [l.code, l.id]));
  const branches = locs.filter((l) => l.type === 'BRANCH').sort((a, b) => a.code.localeCompare(b.code));

  // ---- items, suppliers
  for (const [code, name, category, base, rate, purchaseUnit, daily, min] of ITEMS) {
    let item = await prisma.inventoryItem.findFirst({ where: { company_id: companyId, code } });
    if (!item) {
      item = await prisma.inventoryItem.create({
        data: {
          company_id: companyId, code, name_en: name, name_ta: TA[name], category, base_unit_id: unitId.get(base)!, purchase_unit_id: unitId.get(purchaseUnit)!,
          is_perishable: code === 'ITM001', daily_count_required: daily, last_purchase_rate: D(rate), avg_cost: D(rate),
        },
      });
    }
    for (const b of [...branches, locs.find((l) => l.code === 'GDN01')!]) {
      await prisma.itemLocationSetting.upsert({
        where: { item_id_location_id: { item_id: item.id, location_id: b.id } },
        update: {}, create: { item_id: item.id, location_id: b.id, min_stock: b.type === 'BRANCH' ? D(min) : D(0) },
      });
    }
  }
  for (const [code, name, terms] of SUPPLIERS) {
    if (!(await prisma.supplier.findFirst({ where: { company_id: companyId, code } }))) {
      await prisma.supplier.create({ data: { company_id: companyId, code, name, payment_terms_days: terms } });
    }
  }

  // ---- recipes (tea shop: Tea = 8.60, LLD 9.5)
  const itemId = new Map((await prisma.inventoryItem.findMany({ where: { company_id: companyId } })).map((i) => [i.code, i.id]));
  const RECIPES: Array<[string, string, string, Array<[string, string, string]>]> = [
    ['RCP001', 'Tea', '15', [['ITM001', '90', 'ML'], ['ITM002', '4', 'G'], ['ITM004', '8', 'G'], ['ITM008', '1', 'PCS']]],
    ['RCP002', 'Coffee', '20', [['ITM001', '90', 'ML'], ['ITM003', '5', 'G'], ['ITM004', '10', 'G'], ['ITM008', '1', 'PCS']]],
  ];
  for (const [code, name, price, lines] of RECIPES) {
    if (await prisma.recipe.findFirst({ where: { company_id: companyId, code } })) continue;
    await prisma.recipe.create({
      data: {
        company_id: companyId, code, name_en: name, selling_price: D(price), effective_from: toDate(todayIST()),
        items: { create: lines.map(([ic, q, u]) => ({ item_id: itemId.get(ic)!, quantity: D(q), unit_id: unitId.get(u)!, base_quantity: D(q) })) },
      },
    });
  }

  // ---- users: the mobile number is the sign-in name. Admin also has a password (then OTP); the others use OTP only.
  const users: Array<{ mobile: string; name: string; role: string; locations: string[] }> = [
    { mobile: '9000000001', name: 'Admin', role: 'ADMIN', locations: [] },
    { mobile: '9000000002', name: 'Accountant', role: 'ACCOUNTANT', locations: [] },
    { mobile: '9000000003', name: 'Stock Manager', role: 'STOCK_MANAGER', locations: ['GDN01', ...branches.map((b) => b.code)] },
    ...branches.map((b, i) => ({ mobile: `90000000${String(11 + i).padStart(2, '0')}`, name: `${b.name} Manager`, role: 'BRANCH_MANAGER', locations: [b.code] })),
  ];
  for (const u of users) {
    const existing = await prisma.user.findFirst({ where: { OR: [{ mobile: u.mobile }, { username: u.mobile }] } });
    if (existing) continue;
    await prisma.user.create({
      data: {
        company_id: companyId, username: u.mobile, mobile: u.mobile, full_name: u.name, password_hash: await argon2.hash(defaultPasswordFor([u.role])), must_change_password: true,
        roles: { create: [{ role_id: roleId.get(u.role)! }] },
        locations: { create: u.locations.map((c) => ({ location_id: locId.get(c)! })) },
      },
    });
  }
  for (const [i, b] of branches.entries()) {
    const m = await prisma.user.findFirst({ where: { mobile: `90000000${String(11 + i).padStart(2, '0')}` } });
    if (m && !b.manager_user_id) await prisma.location.update({ where: { id: b.id }, data: { manager_user_id: m.id } });
  }

  console.log(`Seeded ${company.name} (${company.code}): ${users.length} users. Super Admin 'superadmin', Admin mobile 9000000001 (password Admin@1234).`);
  if (!process.env.SEED_PASSWORD) console.log('Password for superadmin (dev only): ChangeMe@123. OTP: see OTP_FIXED_CODE in .env (123456 in .env.example).');

  if (DEMO) {
    await seedDemoHistory(companyId, branches);
    await seedDemoStockExtras(companyId, branches);
  }
}

// ---------------------------------------------------------------- demo history generator
// Deterministic pseudo-random so demo data is reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

async function nextCode(prefix: string, seq: string, loc: string) {
  const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('${seq}') AS n`);
  return `${prefix}-${loc}-${todayIST().slice(2, 4)}-${String(n).padStart(6, '0')}`;
}

async function seedDemoHistory(companyId: string, branches: Array<{ id: string; code: string; card_enabled: boolean; manager_user_id: string | null }>) {
  const days = 30;
  const today = toDate(todayIST());
  const cats = await prisma.expenseCategory.findMany({ where: { company_id: companyId, parent_id: null, status: 'ACTIVE' } });
  const owner = await prisma.user.findFirstOrThrow({ where: { company_id: companyId, roles: { some: { role: { code: 'ADMIN' } } } } });
  const weekdayFactor = [1.15, 0.9, 0.9, 0.95, 1.0, 1.1, 1.25]; // Sun..Sat
  let created = 0;

  for (const [bi, b] of branches.entries()) {
    if (await prisma.dailySales.count({ where: { location_id: b.id } })) continue; // already seeded
    const manager = await prisma.user.findFirstOrThrow({ where: { mobile: `90000000${String(11 + bi).padStart(2, '0')}` } });
    const rand = rng(1000 + bi);
    let opening = D(2000);

    for (let back = days; back >= 1; back--) {
      const date = addDays(today, -back);
      const total = D(Math.round((25000 + rand() * 15000) * weekdayFactor[date.getUTCDay()]));
      const upi = total.mul('0.55').toDecimalPlaces(2);
      const card = b.card_enabled ? total.mul('0.03').toDecimalPlaces(2) : D(0);
      const cash = total.minus(upi).minus(card);

      // yesterday: leave one branch PENDING and one SUBMITTED so the exception list has something to show
      const yesterday = back === 1;
      const status = yesterday ? (bi === 0 ? 'PENDING' : bi === 1 ? 'SUBMITTED' : 'APPROVED') : 'APPROVED';
      const locked = status === 'APPROVED';

      const sales = await prisma.dailySales.create({
        data: {
          location_id: b.id, business_date: date, total_sales: total, cash_sales: cash, upi_sales: upi, card_sales: card,
          mismatch_amount: D(0), submitted_by: manager.id, submitted_at: date, source: 'SYSTEM', is_locked: locked,
        },
      });

      // 2-4 expenses a day, mostly cash
      let cashOut = D(0);
      const n = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const cat = cats[Math.floor(rand() * cats.length)];
        const amount = D(Math.round(200 + rand() * 2800));
        const mode = rand() < 0.8 ? 'CASH' : 'UPI';
        const e = await prisma.expense.create({
          data: {
            code: await nextCode('EXP', 'seq_code_expense', b.code), location_id: b.id, business_date: date, category_id: cat.id,
            amount, payment_mode: mode, approval_status: 'APPROVED', approved_by: owner.id, approved_at: date,
            entered_by: manager.id, source: 'SYSTEM',
          },
        });
        if (mode === 'CASH') {
          cashOut = cashOut.plus(amount);
          await prisma.cashTransaction.create({
            data: {
              location_id: b.id, business_date: date, txn_type: 'EXPENSE', direction: -1, amount,
              source_type: 'EXPENSE', source_id: e.id, source: 'SYSTEM',
            },
          });
        }
      }

      const expected = opening.plus(cash).minus(cashOut);
      // roughly one shortage a fortnight per branch
      const shortage = rand() < 1 / 14 ? D(Math.round(100 + rand() * 300)) : D(0);
      const actual = expected.minus(shortage);
      const variance = actual.minus(expected);
      const recon = await prisma.cashReconciliation.create({
        data: {
          location_id: b.id, business_date: date, opening_cash: opening, cash_sales: cash, other_receipts: D(0),
          cash_expenses: cashOut, cash_purchases: D(0), other_cash_out: D(0), withdrawals: D(0),
          expected_closing: expected, actual_closing: actual, variance,
          variance_reason: variance.isZero() ? null : 'COUNTING_ERROR',
          manager_explanation: variance.isZero() ? null : 'Change given short during the evening rush.',
          variance_approval: variance.isZero() ? null : 'APPROVED', approved_by: variance.isZero() ? null : owner.id,
          is_locked: locked,
        },
      });
      opening = actual;

      const expTotal = (await prisma.expense.aggregate({ where: { location_id: b.id, business_date: date }, _sum: { amount: true } }))._sum.amount ?? D(0);

      const base = {
        location_id: b.id, business_date: date, status: status as any,
        ...(status === 'PENDING'
          ? {}
          : {
              daily_sales_id: sales.id, cash_reconciliation_id: recon.id, total_sales: total, cash_sales: cash, upi_sales: upi,
              card_sales: card, total_expenses: expTotal, total_purchases: D(0), total_wastage_value: D(0),
              expected_cash: expected, actual_cash: actual, cash_variance: variance,
              submitted_by: manager.id, submitted_at: date,
              reviewed_by: status === 'APPROVED' ? owner.id : null, reviewed_at: status === 'APPROVED' ? date : null,
            }),
      };
      // closing row goes in last: once APPROVED, the lock trigger freezes the day
      const closing = await prisma.dailyClosing.upsert({
        where: { location_id_business_date: { location_id: b.id, business_date: date } }, update: base, create: base,
      });
      if (status !== 'PENDING') {
        await prisma.dailyClosingEvent.create({
          data: { daily_closing_id: closing.id, from_status: 'PENDING', to_status: 'SUBMITTED', actor_id: manager.id, created_at: date },
        });
      }
      created++;
    }
  }
  console.log(`Demo history: ${created} branch-days generated over ${days} days.`);
}

/**
 * Demo-only stock history, written the way the real module writes it (ledger rows + balances) so the reconciliation, the variance
 * report and the wastage charts all have data: opening stock 31 days ago, consumption from each day's sales (tea recipe: 90 ml milk,
 * 4 g tea powder, 8 g sugar, 1 cup per ~15 rupees), some wastage, and an approved physical count each day for the last 12 days with
 * small shortages and excesses. The godown gets an opening stock too.
 */
async function seedDemoStockExtras(companyId: string, branches: Array<{ id: string; code: string }>) {
  if (await prisma.wastage.count()) return; // idempotent
  const owner = await prisma.user.findFirstOrThrow({ where: { company_id: companyId, roles: { some: { role: { code: 'ADMIN' } } } } });
  const items = await prisma.inventoryItem.findMany({ where: { company_id: companyId } });
  const item = (code: string) => items.find((i) => i.code === code)!;
  const today = toDate(todayIST());
  const openingDay = addDays(today, -31);
  const perCup: Array<[string, number]> = [['ITM001', 90], ['ITM002', 4], ['ITM004', 8], ['ITM008', 1]];
  const wasteItems = ['ITM001', 'ITM002', 'ITM004'];
  const reasons = ['SPOILED', 'EXCESS_PREPARATION', 'BURNT', 'DAMAGED'] as const;
  const countReasons = ['MEASUREMENT', 'SPILLAGE', 'UNRECORDED_USE', 'COUNTING_ERROR'];
  let w = 0, c = 0, k = 0;

  // approved days are locked by trigger; the seed runs as the owner, so lift the locks only for these inserts
  for (const t of ['wastage', 'stock_counts']) await prisma.$executeRawUnsafe(`ALTER TABLE ${t} DISABLE TRIGGER t_lock_${t}`);
  try {
    for (const [bi, b] of branches.entries()) {
      const manager = await prisma.user.findFirstOrThrow({ where: { mobile: `90000000${String(11 + bi).padStart(2, '0')}` } });
      const rand = rng(5000 + bi);
      const sales = await prisma.dailySales.findMany({ where: { location_id: b.id } });
      const avgCups = sales.length ? sales.reduce((a, r) => a.plus(r.total_sales), D(0)).div(sales.length).div(15) : D(300);
      const bal = new Map<string, Prisma.Decimal>();
      const post = async (code: string, date: Date, type: 'OPENING' | 'CONSUMPTION' | 'WASTAGE' | 'COUNT_ADJUSTMENT', qty: Prisma.Decimal, src: string, srcId: string, by: string) => {
        const it = item(code);
        bal.set(code, (bal.get(code) ?? D(0)).plus(qty));
        await prisma.inventoryTransaction.create({
          data: {
            location_id: b.id, item_id: it.id, business_date: date, txn_type: type, quantity: qty, unit_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2),
            balance_after: bal.get(code)!, source_type: src, source_id: srcId, created_by: by,
          },
        });
      };
      for (const [code, per] of perCup) await post(code, openingDay, 'OPENING', avgCups.mul(per).mul(45).toDecimalPlaces(3), 'OPENING', b.id, owner.id);

      for (let back = 30; back >= 1; back--) {
        const date = addDays(today, -back);
        const day = sales.find((s) => s.business_date.getTime() === date.getTime());
        const closing = await prisma.dailyClosing.findFirst({ where: { location_id: b.id, business_date: date } });
        if (!day || !closing) continue;
        const cups = day.total_sales.div(15);
        for (const [code, per] of perCup) {
          await post(code, date, 'CONSUMPTION', cups.mul(per).mul(0.9 + rand() * 0.2).toDecimalPlaces(3).neg(), 'CLOSING', closing.id, manager.id);
          c++;
        }
        if (rand() < 0.45) {
          const it = item(wasteItems[Math.floor(rand() * wasteItems.length)]);
          const qty = D(Math.round(300 + rand() * 1700)).div(it.code === 'ITM001' ? 1 : 10);
          const row = await prisma.wastage.create({
            data: {
              code: await nextCode('WST', 'seq_code_wastage', b.code), location_id: b.id, business_date: date, item_id: it.id,
              quantity: qty, unit_id: it.base_unit_id, base_quantity: qty, estimated_value: qty.mul(it.avg_cost).toDecimalPlaces(2),
              reason: reasons[Math.floor(rand() * reasons.length)], entered_by: manager.id, approval_status: 'APPROVED',
              approved_by: owner.id, approved_at: date, source: 'SYSTEM',
            },
          });
          await post(it.code, date, 'WASTAGE', qty.neg(), 'WASTAGE', row.id, manager.id);
          w++;
        }

        // an approved physical count at the end of each of the last 12 days
        if (back <= 12) {
          const count = await prisma.stockCount.create({
            data: { location_id: b.id, business_date: date, count_type: 'CLOSING', status: 'APPROVED', counted_by: manager.id, approved_by: owner.id, approved_at: date, created_by: manager.id },
          });
          for (const [code] of perCup) {
            const it = item(code);
            const expected = bal.get(code)!;
            const physical = expected.mul(1 + (rand() * 0.08 - 0.055)).toDecimalPlaces(3); // between -5.5% and +2.5%
            const variance = physical.minus(expected);
            const significant = expected.greaterThan(0) && variance.abs().div(expected).mul(100).greaterThan(5);
            await prisma.stockCountItem.create({
              data: {
                stock_count_id: count.id, item_id: it.id, expected_qty: expected, physical_qty: physical, variance_qty: variance, variance_value: variance.mul(it.avg_cost).toDecimalPlaces(2),
                is_significant: significant, reason: variance.isZero() ? null : countReasons[Math.floor(rand() * countReasons.length)],
                explanation: significant ? 'Counted twice at closing; difference confirmed by the manager.' : null,
              },
            });
            if (!variance.isZero()) await post(code, date, 'COUNT_ADJUSTMENT', variance, 'STOCK_COUNT', count.id, owner.id);
            k++;
          }
        }
      }
      for (const [code, qty] of bal) {
        const it = item(code);
        await prisma.stockBalance.upsert({
          where: { location_id_item_id: { location_id: b.id, item_id: it.id } },
          update: { quantity: qty, avg_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2), last_counted_on: addDays(today, -1) },
          create: { location_id: b.id, item_id: it.id, quantity: qty, avg_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2), last_counted_on: addDays(today, -1) },
        });
      }
    }

    // the central warehouse holds a stock too, so transfers to branches can be tried straight away
    const godown = await prisma.location.findFirst({ where: { company_id: companyId, code: 'GDN01' } });
    if (godown) {
      for (const it of items) {
        const qty = D(it.code === 'ITM001' ? 200000 : it.code === 'ITM002' || it.code === 'ITM004' ? 60000 : it.code === 'ITM013' ? 30000 : 3000);
        await prisma.inventoryTransaction.create({
          data: { location_id: godown.id, item_id: it.id, business_date: openingDay, txn_type: 'OPENING', quantity: qty, unit_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2), balance_after: qty, source_type: 'OPENING', source_id: godown.id, created_by: owner.id },
        });
        await prisma.stockBalance.upsert({
          where: { location_id_item_id: { location_id: godown.id, item_id: it.id } },
          update: { quantity: qty, avg_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2) },
          create: { location_id: godown.id, item_id: it.id, quantity: qty, avg_cost: it.avg_cost, value: qty.mul(it.avg_cost).toDecimalPlaces(2) },
        });
      }
    }
  } finally {
    for (const t of ['wastage', 'stock_counts']) await prisma.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE TRIGGER t_lock_${t}`);
  }
  console.log(`Demo stock: ${w} wastage entries, ${c} consumption rows, ${k} counted lines.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
