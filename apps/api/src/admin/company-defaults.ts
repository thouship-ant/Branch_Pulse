import { Prisma } from '@prisma/client';

/**
 * Everything a brand-new company starts with: its own copy of the roles (so each Admin can tune permissions without
 * touching another company), approval limits, expense categories and settings. Shared by the seed script and by
 * "Create company" in the Super Admin area, so both always produce the same starting point.
 */

// ---------------------------------------------------------------- permissions & roles (LLD s12)
export const PERMISSIONS: Record<string, string[]> = {
  company: ['manage'], // Super Admin only: create and manage companies
  user: ['manage'], role: ['manage'], location: ['view', 'manage'], settings: ['manage'],
  sales: ['view', 'enter'], cash: ['view', 'enter', 'approve'],
  closing: ['view', 'submit', 'approve', 'reopen'],
  expense: ['view', 'create', 'edit', 'approve', 'reverse'],
  purchase: ['view', 'create', 'approve'], supplier: ['view', 'manage', 'pay'],
  item: ['manage'], stock: ['view'],
  transfer: ['view', 'create', 'dispatch', 'approve', 'receive'],
  count: ['view', 'enter', 'submit', 'approve'], wastage: ['view', 'create', 'approve'],
  recipe: ['view', 'manage'], staff: ['view', 'manage'], attendance: ['view', 'mark'],
  salary: ['manage', 'approve', 'pay'], advance: ['view', 'request', 'manager_approve', 'approve', 'pay'],
  dashboard: ['view'], alert: ['view', 'manage'], pl: ['view'], report: ['view', 'export'], audit: ['view'],
};
export const ALL_PERMS = Object.entries(PERMISSIONS).flatMap(([m, acts]) => acts.map((a) => `${m}:${a}`));
/** Every permission a company role can hold (the company module belongs to the Super Admin alone). */
export const COMPANY_PERMS = ALL_PERMS.filter((p) => !p.startsWith('company:'));

export const SUPER_ADMIN_ROLE = { code: 'SUPER_ADMIN', name: 'Super Admin', scope: 'ALL' as const, perms: ['company:manage'] };

export const ROLE_TEMPLATES: Array<{ code: string; name: string; scope: 'ALL' | 'ASSIGNED'; perms: string[] }> = [
  { code: 'ADMIN', name: 'Admin', scope: 'ALL', perms: COMPANY_PERMS },
  {
    code: 'ACCOUNTANT', name: 'Accountant', scope: 'ALL',
    perms: [
      'location:view', 'sales:view', 'cash:view', 'cash:approve', 'closing:view',
      'expense:view', 'expense:approve', 'expense:reverse', 'purchase:view', 'purchase:approve',
      'supplier:view', 'supplier:pay', 'stock:view', 'transfer:view', 'count:view', 'wastage:view',
      'recipe:view', 'staff:view', 'attendance:view', 'salary:manage', 'salary:approve', 'salary:pay',
      'advance:view', 'advance:approve', 'advance:pay', 'dashboard:view', 'alert:view', 'pl:view',
      'report:view', 'report:export', 'audit:view',
    ],
  },
  {
    code: 'STOCK_MANAGER', name: 'Stock Manager', scope: 'ASSIGNED',
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
      'staff:view', 'attendance:view', 'attendance:mark', 'advance:view', 'advance:request', 'advance:manager_approve',
      'alert:view', 'report:view', 'report:export',
    ],
  },
  {
    code: 'STAFF', name: 'Staff', scope: 'ASSIGNED',
    perms: ['stock:view', 'count:enter', 'wastage:create', 'attendance:mark', 'advance:view', 'advance:request'],
  },
];

// LLD s12 default approval limits
export const LIMITS: Array<[string, string, string]> = [
  ['BRANCH_MANAGER', 'EXPENSE', '500'], ['BRANCH_MANAGER', 'WASTAGE', '200'],
  ['ACCOUNTANT', 'EXPENSE', '25000'], ['ACCOUNTANT', 'PURCHASE', '25000'],
  ['ACCOUNTANT', 'ADVANCE', '5000'], ['ACCOUNTANT', 'CASH_VARIANCE', '5000'],
  ['STOCK_MANAGER', 'PURCHASE', '25000'], ['STOCK_MANAGER', 'WASTAGE', '2000'],
];

// ---------------------------------------------------------------- expense categories
// [name, P&L bucket]
export const CATEGORIES: Array<[string, string]> = [
  ['Milk', 'RAW_MATERIAL'], ['Tea powder', 'RAW_MATERIAL'], ['Coffee', 'RAW_MATERIAL'], ['Sugar', 'RAW_MATERIAL'],
  ['Snacks / raw materials', 'RAW_MATERIAL'], ['Salary', 'SALARY'], ['Staff advance', 'NON_PL'],
  ['Rent', 'RENT'], ['Electricity', 'ELECTRICITY'], ['Gas', 'OTHER'], ['Transport', 'TRANSPORT'],
  ['Maintenance', 'MAINTENANCE'], ['Repairs', 'MAINTENANCE'], ['Cleaning', 'MAINTENANCE'],
  ['Cooking oil', 'RAW_MATERIAL'], ['Packaging', 'RAW_MATERIAL'], ['Miscellaneous', 'OTHER'],
];

// these are bought from a supplier, so the expense entry screen asks for one; every other category hides the field
export const REQUIRES_SUPPLIER = new Set(['Milk', 'Tea powder', 'Coffee', 'Sugar', 'Snacks / raw materials', 'Cooking oil', 'Gas', 'Packaging']);

export const CATEGORY_TA: Record<string, string> = {
  Milk: 'பால்', 'Tea powder': 'தேயிலைத் தூள்', Coffee: 'காபி', Sugar: 'சர்க்கரை',
  'Snacks / raw materials': 'சிற்றுண்டி / மூலப்பொருட்கள்', Salary: 'சம்பளம்', 'Staff advance': 'ஊழியர் முன்பணம்',
  Rent: 'வாடகை', Electricity: 'மின்சாரம்', Gas: 'எரிவாயு', Transport: 'போக்குவரத்து', Maintenance: 'பராமரிப்பு',
  Repairs: 'பழுதுபார்ப்பு', Cleaning: 'சுத்தம்', 'Cooking oil': 'சமையல் எண்ணெய்', Packaging: 'பேக்கிங்', Miscellaneous: 'இதர',
};

// category -> [sub-category, Tamil name]
export const SUB_CATEGORIES: Record<string, Array<[string, string]>> = {
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

/** Any Prisma client: the API passes a transaction, the seed script passes the owner client. */
type Db = Prisma.TransactionClient;

/** Make sure every permission code exists (they are shared by all companies). */
export async function ensurePermissions(db: Db) {
  for (const [module, acts] of Object.entries(PERMISSIONS)) {
    for (const a of acts) {
      await db.permission.upsert({ where: { code: `${module}:${a}` }, update: {}, create: { code: `${module}:${a}`, module } });
    }
  }
}

/** The Super Admin role (not owned by any company). */
export async function ensureSuperAdminRole(db: Db): Promise<string> {
  await ensurePermissions(db);
  let role = await db.role.findFirst({ where: { code: SUPER_ADMIN_ROLE.code, company_id: null } });
  if (!role) {
    role = await db.role.create({ data: { code: SUPER_ADMIN_ROLE.code, name: SUPER_ADMIN_ROLE.name, scope_mode: SUPER_ADMIN_ROLE.scope, is_system: true, company_id: null } });
  }
  const perms = await db.permission.findMany({ where: { code: { in: SUPER_ADMIN_ROLE.perms } } });
  await db.rolePermission.deleteMany({ where: { role_id: role.id } });
  await db.rolePermission.createMany({ data: perms.map((p) => ({ role_id: role.id, permission_id: p.id })) });
  return role.id;
}

/**
 * Give a company its starting roles, approval limits, categories and settings. Idempotent: existing rows are kept.
 * Returns the company's role ids by code (the caller assigns the first Admin user to ADMIN).
 */
export async function provisionCompanyDefaults(db: Db, companyId: string, businessName: string): Promise<Map<string, string>> {
  await ensurePermissions(db);
  const perms = new Map((await db.permission.findMany()).map((p) => [p.code, p.id]));

  const roleId = new Map<string, string>();
  for (const r of ROLE_TEMPLATES) {
    let role = await db.role.findFirst({ where: { code: r.code, company_id: companyId } });
    if (!role) {
      role = await db.role.create({ data: { company_id: companyId, code: r.code, name: r.name, scope_mode: r.scope, is_system: true } });
      await db.rolePermission.createMany({ data: r.perms.map((p) => ({ role_id: role!.id, permission_id: perms.get(p)! })) });
    }
    roleId.set(r.code, role.id);
  }

  for (const [role, entity, max] of LIMITS) {
    await db.approvalLimit.upsert({
      where: { company_id_role_id_entity_type: { company_id: companyId, role_id: roleId.get(role)!, entity_type: entity } },
      update: {},
      create: { company_id: companyId, role_id: roleId.get(role)!, entity_type: entity, max_amount: new Prisma.Decimal(max) },
    });
  }

  for (const [i, [name, bucket]] of CATEGORIES.entries()) {
    const exists = await db.expenseCategory.findFirst({ where: { company_id: companyId, name_en: name, parent_id: null } });
    if (!exists) {
      await db.expenseCategory.create({
        data: { company_id: companyId, name_en: name, name_ta: CATEGORY_TA[name], pl_bucket: bucket, sort_order: i, requires_supplier: REQUIRES_SUPPLIER.has(name) },
      });
    }
  }
  // starter sub-categories: the Admin can add, rename or switch these off under Expenses > Categories
  for (const [parentName, subs] of Object.entries(SUB_CATEGORIES)) {
    const parent = await db.expenseCategory.findFirst({ where: { company_id: companyId, name_en: parentName, parent_id: null } });
    if (!parent) continue;
    for (const [i, [name, nameTa]] of subs.entries()) {
      const exists = await db.expenseCategory.findFirst({ where: { company_id: companyId, name_en: name, parent_id: parent.id } });
      if (!exists) {
        await db.expenseCategory.create({ data: { company_id: companyId, parent_id: parent.id, name_en: name, name_ta: nameTa, pl_bucket: parent.pl_bucket, sort_order: i } });
      }
    }
  }

  await db.setting.upsert({
    where: { company_id_key: { company_id: companyId, key: 'business.name' } },
    update: {}, create: { company_id: companyId, key: 'business.name', value: businessName },
  });
  await db.setting.upsert({
    where: { company_id_key: { company_id: companyId, key: 'business.type' } },
    update: {}, create: { company_id: companyId, key: 'business.type', value: 'TEA_SHOP' },
  });
  return roleId;
}
