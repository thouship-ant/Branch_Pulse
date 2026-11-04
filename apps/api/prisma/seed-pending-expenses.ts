/**
 * Adds a few expenses that are waiting for the Admin's approval (Approvals > Expenses), written the way the app writes them
 * (cash ones also post to the cash ledger). Idempotent: skipped when the branch already has the marker descriptions.
 *
 *   npx tsx prisma/seed-pending-expenses.ts --company CMP000 --branch "Anna Nagar"
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { fmtDate, toDate } from '../src/common/dates';

try {
  (process as any).loadEnvFile?.('.env');
} catch {
  /* no .env */
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

async function main() {
  const company = await prisma.company.findFirstOrThrow({ where: { code: arg('company', 'CMP000') } });
  const branch = await prisma.location.findFirstOrThrow({ where: { company_id: company.id, name: { contains: arg('branch', 'Anna Nagar'), mode: 'insensitive' } } });
  const actor = (branch.manager_user_id ? await prisma.user.findUnique({ where: { id: branch.manager_user_id } }) : null)
    ?? (await prisma.user.findFirstOrThrow({ where: { company_id: company.id } }));
  const cats = await prisma.expenseCategory.findMany({ where: { company_id: company.id, parent_id: null, status: 'ACTIVE' }, orderBy: { name_en: 'asc' } });
  const today = toDate('2026-11-04');
  const day = (back: number) => new Date(today.getTime() - back * 86400000);

  const rows: Array<[number, number, 'CASH' | 'UPI', number, string, string?]> = [
    // [days back, category index, mode, amount, description, payee]
    [0, 0, 'CASH', 850, 'Gas cylinder refill', 'Sri Gas Agency'],
    [0, 1, 'UPI', 2400, 'Shop cleaning and pest control', 'Clean Care Services'],
    [1, 2, 'CASH', 640, 'Milk cans transport', 'Murugan Transport'],
    [1, 3, 'CASH', 1200, 'Mixer grinder repair', 'Kumar Electricals'],
    [1, 4 % Math.max(cats.length, 1), 'UPI', 3150, 'Signboard lighting replacement', 'Vel Electricals'],
    [0, 0, 'CASH', 300, 'Water cans', 'Aqua Fresh'],
  ];
  if (!cats.length) throw new Error('no expense categories');

  let n = 0;
  for (const [back, ci, mode, amount, description, payee] of rows) {
    if (await prisma.expense.count({ where: { location_id: branch.id, description } })) continue; // already added
    const date = day(back);
    const cat = cats[ci % cats.length];
    const [{ n: seq }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('seq_code_expense') AS n`);
    const code = `EXP-${branch.code}-${fmtDate(date).slice(2, 4)}-${String(seq).padStart(6, '0')}`;
    const e = await prisma.expense.create({
      data: {
        code, location_id: branch.id, business_date: date, category_id: cat.id, amount: new Prisma.Decimal(amount), payment_mode: mode,
        payee_name: payee, description, approval_status: 'SUBMITTED', entered_by: actor.id, created_by: actor.id, source: 'WEB',
      },
    });
    if (mode === 'CASH') {
      await prisma.cashTransaction.create({
        data: { location_id: branch.id, business_date: date, txn_type: 'EXPENSE', direction: -1, amount: new Prisma.Decimal(amount), source_type: 'EXPENSE', source_id: e.id, source: 'WEB' },
      });
    }
    n++;
  }
  console.log(`added ${n} expenses waiting for approval at ${branch.name} (${branch.code}), ${company.code}`);
}

main().finally(() => prisma.$disconnect());
