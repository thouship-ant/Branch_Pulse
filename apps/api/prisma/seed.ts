/**
 * Seed (LLD s19). Runs as the database owner (DIRECT_URL) so it is not subject to RLS.
 *
 *   npm run db:seed                 masters, roles, permissions, users
 *   npm run db:seed -- --demo       + 30 days of consistent branch history for dashboards/tests
 *   SEED_MINIMAL=1 (or --minimal)   production bootstrap: roles, permissions, limits, units, categories, one owner
 *   SEED_PASSWORD=...               password for every seeded user (required in production)
 */
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
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

// ---------------------------------------------------------------- permissions & roles (LLD s12)
const PERMISSIONS: Record<string, string[]> = {
  user: ['manage'], role: ['manage'], location: ['view', 'manage'], settings: ['manage'],
  sales: ['view', 'enter'], cash: ['view', 'enter', 'approve'],
  closing: ['view', 'submit', 'approve', 'reopen'],
  expense: ['view', 'create', 'edit', 'approve', 'reverse'],
  purchase: ['view', 'create', 'approve'], supplier: ['view', 'manage', 'pay'],
  item: ['manage'], stock: ['view'],
  transfer: ['view', 'create', 'dispatch', 'approve', 'receive'],
  count: ['view', 'enter', 'submit', 'approve'], wastage: ['view', 'create', 'approve'],
  recipe: ['view', 'manage'], staff: ['view', 'manage'], attendance: ['view', 'mark'],
  salary: ['manage', 'approve', 'pay'], advance: ['request', 'manager_approve', 'approve', 'pay'],
  dashboard: ['view'], alert: ['view', 'manage'], pl: ['view'], report: ['view', 'export'], audit: ['view'],
};
const ALL_PERMS = Object.entries(PERMISSIONS).flatMap(([m, acts]) => acts.map((a) => `${m}:${a}`));

const ROLES: Array<{ code: string; name: string; scope: 'ALL' | 'ASSIGNED'; perms: string[] }> = [
  { code: 'OWNER', name: 'Owner', scope: 'ALL', perms: ALL_PERMS },
  {
    code: 'ACCOUNTANT', name: 'Accountant', scope: 'ALL',
    perms: [
      'location:view', 'sales:view', 'cash:view', 'cash:approve', 'closing:view',
      'expense:view', 'expense:approve', 'expense:reverse', 'purchase:view', 'purchase:approve',
      'supplier:view', 'supplier:pay', 'stock:view', 'transfer:view', 'count:view', 'wastage:view',
      'recipe:view', 'staff:view', 'attendance:view', 'salary:manage', 'salary:approve', 'salary:pay',
      'advance:approve', 'advance:pay', 'dashboard:view', 'alert:view', 'pl:view',
      'report:view', 'report:export', 'audit:view',
    ],
  },
  {
    code: 'STOCK_MANAGER', name: 'Stock / Purchase Manager', scope: 'ASSIGNED',
    perms: [
      'location:view', 'dashboard:view', 'purchase:view', 'purchase:create', 'purchase:approve',
      'supplier:view', 'supplier:manage', 'item:manage', 'stock:view',
      'transfer:view', 'transfer:create', 'transfer:dispatch', 'transfer:approve',
      'count:view', 'count:enter', 'count:approve', 'wastage:view', 'wastage:approve',
      'recipe:view', 'alert:view', 'report:view', 'report:export', 'audit:view',
    ],
  },
  {
    code: 'BRANCH_MANAGER', name: 'Branch Manager', scope: 'ASSIGNED',
    perms: [
      'location:view', 'dashboard:view', 'sales:view', 'sales:enter', 'cash:view', 'cash:enter',
      'closing:view', 'closing:submit', 'expense:view', 'expense:create', 'expense:edit',
      'purchase:view', 'purchase:create', 'supplier:view', 'stock:view', 'transfer:view', 'transfer:receive',
      'count:view', 'count:enter', 'count:submit', 'wastage:view', 'wastage:create',
      'staff:view', 'attendance:view', 'attendance:mark', 'advance:request', 'advance:manager_approve',
      'alert:view', 'report:view', 'report:export',
    ],
  },
  {
    code: 'STAFF', name: 'Staff', scope: 'ASSIGNED',
    perms: ['stock:view', 'count:enter', 'wastage:create', 'attendance:mark', 'advance:request'],
  },
];

// LLD s12 default approval limits
const LIMITS: Array<[string, string, string]> = [
  ['BRANCH_MANAGER', 'EXPENSE', '500'], ['BRANCH_MANAGER', 'WASTAGE', '200'],
  ['ACCOUNTANT', 'EXPENSE', '25000'], ['ACCOUNTANT', 'PURCHASE', '25000'],
  ['ACCOUNTANT', 'ADVANCE', '5000'], ['ACCOUNTANT', 'CASH_VARIANCE', '5000'],
  ['STOCK_MANAGER', 'PURCHASE', '25000'], ['STOCK_MANAGER', 'WASTAGE', '2000'],
];

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

// [name, P&L bucket, receipt-required-above override]
const CATEGORIES: Array<[string, string]> = [
  ['Milk', 'RAW_MATERIAL'], ['Tea powder', 'RAW_MATERIAL'], ['Coffee', 'RAW_MATERIAL'], ['Sugar', 'RAW_MATERIAL'],
  ['Snacks / raw materials', 'RAW_MATERIAL'], ['Salary', 'SALARY'], ['Staff advance', 'NON_PL'],
  ['Rent', 'RENT'], ['Electricity', 'ELECTRICITY'], ['Gas', 'OTHER'], ['Transport', 'TRANSPORT'],
  ['Maintenance', 'MAINTENANCE'], ['Repairs', 'MAINTENANCE'], ['Cleaning', 'MAINTENANCE'],
  ['Cooking oil', 'RAW_MATERIAL'], ['Packaging', 'RAW_MATERIAL'], ['Miscellaneous', 'OTHER'],
];

// category -> [sub-category, Tamil name]
const SUB_CATEGORIES: Record<string, Array<[string, string]>> = {
  Milk: [['Cow milk', 'பசும்பால்'], ['Buffalo milk', 'எருமைப்பால்']],
  Salary: [['Monthly salary', 'மாதச் சம்பளம்'], ['Daily wages', 'தினக்கூலி'], ['Overtime', 'கூடுதல் நேரம்']],
  Gas: [['Commercial cylinder', 'வணிக சிலிண்டர்'], ['Cylinder delivery', 'சிலிண்டர் விநியோகம்']],
  Electricity: [['Shop meter bill', 'கடை மின் கட்டணம்'], ['Generator fuel', 'ஜெனரேட்டர் எரிபொருள்']],
  Transport: [['Fuel', 'எரிபொருள்'], ['Delivery charges', 'விநியோகக் கட்டணம்'], ['Vehicle hire', 'வாகன வாடகை']],
  Maintenance: [['Electrical work', 'மின் பணி'], ['Plumbing', 'குழாய் பணி'], ['Equipment service', 'கருவி சேவை']],
  Cleaning: [['Housekeeping supplies', 'சுத்தம் செய்யும் பொருட்கள்'], ['Pest control', 'பூச்சிக் கட்டுப்பாடு']],
  Packaging: [['Paper cups', 'காகிதக் குவளைகள்'], ['Carry bags', 'கைப்பைகள்'], ['Parcel boxes', 'பார்சல் பெட்டிகள்']],
  Repairs: [['Furniture', 'மரச்சாமான்'], ['Appliances', 'மின்சாதனங்கள்']],
};

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
];

const SUPPLIERS: Array<[string, string, number]> = [
  ['SUP0001', 'Dairy supplier', 1], ['SUP0002', 'Tea wholesaler', 15],
  ['SUP0003', 'Packaging supplier', 30], ['SUP0004', 'Snacks vendor', 7],
];

async function seedUnitsAndCategories() {
  for (const [code, name, base, factor] of UNITS) {
    const baseUnit = base ? await prisma.unit.findUnique({ where: { code: base } }) : null;
    await prisma.unit.upsert({
      where: { code }, update: {},
      create: { code, name, base_unit_id: baseUnit?.id ?? null, factor_to_base: D(factor) },
    });
  }
  for (const [i, [name, bucket]] of CATEGORIES.entries()) {
    const exists = await prisma.expenseCategory.findFirst({ where: { name_en: name, parent_id: null } });
    if (!exists) await prisma.expenseCategory.create({ data: { name_en: name, name_ta: TA[name], pl_bucket: bucket, sort_order: i } });
  }
  // starter sub-categories: the owner can add, rename or switch these off under Expenses > Categories
  for (const [parentName, subs] of Object.entries(SUB_CATEGORIES)) {
    const parent = await prisma.expenseCategory.findFirst({ where: { name_en: parentName, parent_id: null } });
    if (!parent) continue;
    for (const [i, [name, nameTa]] of subs.entries()) {
      const exists = await prisma.expenseCategory.findFirst({ where: { name_en: name, parent_id: parent.id } });
      if (!exists) await prisma.expenseCategory.create({ data: { parent_id: parent.id, name_en: name, name_ta: nameTa, pl_bucket: parent.pl_bucket, sort_order: i } });
    }
  }
  return new Map((await prisma.unit.findMany()).map((u) => [u.code, u.id]));
}

async function main() {
  const password = process.env.SEED_PASSWORD ?? (process.env.NODE_ENV === 'production' ? undefined : 'ChangeMe@123');
  if (!password) throw new Error('SEED_PASSWORD is required in production');
  if (MINIMAL && password === 'ChangeMe@123') throw new Error('Set a real SEED_PASSWORD for a production seed');
  const passwordHash = await argon2.hash(password);

  // ---- permissions, roles
  for (const [module, acts] of Object.entries(PERMISSIONS)) {
    for (const a of acts) {
      await prisma.permission.upsert({
        where: { code: `${module}:${a}` }, update: {}, create: { code: `${module}:${a}`, module },
      });
    }
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { scope_mode: r.scope },
      create: { code: r.code, name: r.name, scope_mode: r.scope, is_system: true },
    });
    await prisma.rolePermission.deleteMany({ where: { role_id: role.id } });
    await prisma.rolePermission.createMany({ data: r.perms.map((p) => ({ role_id: role.id, permission_id: perms.get(p)! })) });
  }
  const roleId = new Map((await prisma.role.findMany()).map((r) => [r.code, r.id]));
  for (const [role, entity, max] of LIMITS) {
    await prisma.approvalLimit.upsert({
      where: { role_id_entity_type: { role_id: roleId.get(role)!, entity_type: entity } },
      update: { max_amount: D(max) },
      create: { role_id: roleId.get(role)!, entity_type: entity, max_amount: D(max) },
    });
  }

  // Production bootstrap: roles, permissions, limits, units, categories and ONE owner. No demo branches,
  // items or users - the owner creates their own locations and staff in the app.
  if (MINIMAL) {
    await seedUnitsAndCategories();
    if (!(await prisma.user.findUnique({ where: { username: 'owner' } }))) {
      await prisma.user.create({
        data: {
          username: 'owner', full_name: 'Owner', password_hash: passwordHash,
          roles: { create: [{ role_id: roleId.get('OWNER')! }] },
        },
      });
    }
    console.log(`Minimal seed done: ${ALL_PERMS.length} permissions, ${ROLES.length} roles, owner user 'owner'.`);
    console.log('Sign in as owner with SEED_PASSWORD and change it straight away (Settings -> Users).');
    return;
  }

  // ---- locations
  const openedOn = DEMO ? toDate(fmtDate(addDays(toDate(todayIST()), -45))) : null;
  for (const [code, name, type] of LOCATIONS) {
    await prisma.location.upsert({
      where: { code }, update: {},
      create: { code, name, name_ta: TA[name], type, default_opening_cash: type === 'BRANCH' ? D(2000) : D(0), opened_on: type === 'BRANCH' ? openedOn : null },
    });
  }
  const locs = await prisma.location.findMany();
  const locId = new Map(locs.map((l) => [l.code, l.id]));
  const branches = locs.filter((l) => l.type === 'BRANCH').sort((a, b) => a.code.localeCompare(b.code));

  // ---- units, categories, items, suppliers
  const unitId = await seedUnitsAndCategories();

  for (const [code, name, category, base, rate, purchaseUnit, daily, min] of ITEMS) {
    const item = await prisma.inventoryItem.upsert({
      where: { code }, update: {},
      create: {
        code, name_en: name, name_ta: TA[name], category, base_unit_id: unitId.get(base)!, purchase_unit_id: unitId.get(purchaseUnit)!,
        is_perishable: code === 'ITM001', daily_count_required: daily, last_purchase_rate: D(rate), avg_cost: D(rate),
      },
    });
    for (const b of [...branches, locs.find((l) => l.code === 'GDN01')!]) {
      await prisma.itemLocationSetting.upsert({
        where: { item_id_location_id: { item_id: item.id, location_id: b.id } },
        update: {}, create: { item_id: item.id, location_id: b.id, min_stock: b.type === 'BRANCH' ? D(min) : D(0) },
      });
    }
  }
  for (const [code, name, terms] of SUPPLIERS) {
    await prisma.supplier.upsert({ where: { code }, update: {}, create: { code, name, payment_terms_days: terms } });
  }

  // ---- recipes (tea shop: Tea = 8.60, LLD 9.5)
  const itemId = new Map((await prisma.inventoryItem.findMany()).map((i) => [i.code, i.id]));
  const RECIPES: Array<[string, string, string, Array<[string, string, string]>]> = [
    ['RCP001', 'Tea', '15', [['ITM001', '90', 'ML'], ['ITM002', '4', 'G'], ['ITM004', '8', 'G'], ['ITM008', '1', 'PCS']]],
    ['RCP002', 'Coffee', '20', [['ITM001', '90', 'ML'], ['ITM003', '5', 'G'], ['ITM004', '10', 'G'], ['ITM008', '1', 'PCS']]],
  ];
  for (const [code, name, price, lines] of RECIPES) {
    if (await prisma.recipe.findUnique({ where: { code } })) continue;
    await prisma.recipe.create({
      data: {
        code, name_en: name, selling_price: D(price), effective_from: toDate(todayIST()),
        items: { create: lines.map(([ic, q, u]) => ({ item_id: itemId.get(ic)!, quantity: D(q), unit_id: unitId.get(u)!, base_quantity: D(q) })) },
      },
    });
  }

  // ---- default settings that differ from code defaults are not needed; business.type is explicit
  await prisma.setting.upsert({
    where: { key: 'business.type' }, update: {}, create: { key: 'business.type', value: 'TEA_SHOP' },
  });

  // ---- users
  const users: Array<{ username: string; name: string; role: string; locations: string[] }> = [
    { username: 'owner', name: 'Owner', role: 'OWNER', locations: [] },
    { username: 'accountant', name: 'Accountant', role: 'ACCOUNTANT', locations: [] },
    { username: 'stockmgr', name: 'Stock Manager', role: 'STOCK_MANAGER', locations: ['GDN01', ...branches.map((b) => b.code)] },
    ...branches.map((b, i) => ({
      username: `manager${i + 1}`, name: `${b.name} Manager`, role: 'BRANCH_MANAGER', locations: [b.code],
    })),
  ];
  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { username: u.username } });
    if (existing) continue;
    await prisma.user.create({
      data: {
        username: u.username, full_name: u.name, password_hash: passwordHash,
        roles: { create: [{ role_id: roleId.get(u.role)! }] },
        locations: { create: u.locations.map((c) => ({ location_id: locId.get(c)! })) },
      },
    });
  }
  for (const [i, b] of branches.entries()) {
    const m = await prisma.user.findUnique({ where: { username: `manager${i + 1}` } });
    if (m) await prisma.location.update({ where: { id: b.id }, data: { manager_user_id: m.id } });
  }

  console.log(`Seeded masters, ${ALL_PERMS.length} permissions, ${ROLES.length} roles, ${users.length} users.`);
  if (!process.env.SEED_PASSWORD) console.log('Seed password for every user (dev only): ChangeMe@123');

  if (DEMO) {
    await seedDemoHistory(branches, locId.get('HO01')!);
    await seedDemoStockExtras(branches);
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

async function seedDemoHistory(branches: Array<{ id: string; code: string; card_enabled: boolean }>, _ho: string) {
  const days = 30;
  const today = toDate(todayIST());
  const cats = await prisma.expenseCategory.findMany({ where: { parent_id: null, status: 'ACTIVE' } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } });
  const weekdayFactor = [1.15, 0.9, 0.9, 0.95, 1.0, 1.1, 1.25]; // Sun..Sat
  let created = 0;

  for (const [bi, b] of branches.entries()) {
    if (await prisma.dailySales.count({ where: { location_id: b.id } })) continue; // already seeded
    const manager = await prisma.user.findUniqueOrThrow({ where: { username: `manager${bi + 1}` } });
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
 * Demo-only wastage and stock consumption so the dashboard's wastage and consumption charts have data
 * before the stock module exists. Consumption is derived from each day's sales (tea recipe: 90 ml milk,
 * 4 g tea powder, 8 g sugar, 1 cup per ~15 rupees). Ledger rows are written without stock_balances, so
 * never seed this into a database you plan to run the real stock module on.
 */
async function seedDemoStockExtras(branches: Array<{ id: string; code: string }>) {
  if (await prisma.wastage.count()) return; // idempotent
  const owner = await prisma.user.findUniqueOrThrow({ where: { username: 'owner' } });
  const items = await prisma.inventoryItem.findMany();
  const item = (code: string) => items.find((i) => i.code === code)!;
  const today = toDate(todayIST());
  const perCup: Array<[string, number]> = [['ITM001', 90], ['ITM002', 4], ['ITM004', 8], ['ITM008', 1]];
  const reasons = ['SPOILED', 'EXCESS_PREPARATION', 'BURNT', 'DAMAGED'] as const;
  let w = 0, c = 0;

  // approved days are locked by trigger; the seed runs as the owner, so lift the lock only for this insert
  await prisma.$executeRawUnsafe('ALTER TABLE wastage DISABLE TRIGGER t_lock_wastage');
  try {
    for (const [bi, b] of branches.entries()) {
      const manager = await prisma.user.findUniqueOrThrow({ where: { username: `manager${bi + 1}` } });
      const rand = rng(5000 + bi);
      for (let back = 30; back >= 1; back--) {
        const date = addDays(today, -back);
        const sales = await prisma.dailySales.findFirst({ where: { location_id: b.id, business_date: date } });
        const closing = await prisma.dailyClosing.findFirst({ where: { location_id: b.id, business_date: date } });
        if (!sales || !closing) continue;

        const cups = sales.total_sales.div(15);
        for (const [code, per] of perCup) {
          const it = item(code);
          const qty = cups.mul(per).mul(0.9 + rand() * 0.2).toDecimalPlaces(3);
          await prisma.inventoryTransaction.create({
            data: {
              location_id: b.id, item_id: it.id, business_date: date, txn_type: 'CONSUMPTION', quantity: qty.neg(),
              unit_cost: it.avg_cost, value: qty.mul(it.avg_cost).neg().toDecimalPlaces(2), balance_after: D(0),
              source_type: 'CLOSING', source_id: closing.id, created_by: manager.id,
            },
          });
          c++;
        }

        if (rand() < 0.45) {
          const it = item(['ITM001', 'ITM002', 'ITM004'][Math.floor(rand() * 3)]);
          const qty = D(Math.round(300 + rand() * 1700)).div(it.code === 'ITM001' ? 1 : 10);
          await prisma.wastage.create({
            data: {
              code: await nextCode('WST', 'seq_code_wastage', b.code), location_id: b.id, business_date: date, item_id: it.id,
              quantity: qty, unit_id: it.base_unit_id, base_quantity: qty, estimated_value: qty.mul(it.avg_cost).toDecimalPlaces(2),
              reason: reasons[Math.floor(rand() * reasons.length)], entered_by: manager.id, approval_status: 'APPROVED',
              approved_by: owner.id, approved_at: date, source: 'SYSTEM',
            },
          });
          w++;
        }
      }
    }
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE wastage ENABLE TRIGGER t_lock_wastage');
  }
  console.log(`Demo stock extras: ${w} wastage entries, ${c} consumption ledger rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
