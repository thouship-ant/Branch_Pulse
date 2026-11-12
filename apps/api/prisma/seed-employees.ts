/**
 * Adds 10 employees (random Muslim names) to every active branch of a company. Idempotent: a branch that already has employees from
 * this name list is skipped.
 *
 *   npx tsx prisma/seed-employees.ts --company CMP000 --per-branch 10
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { addDays, fmtDate, toDate, todayIST } from '../src/common/dates';

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
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const MALE = ['Mohammed', 'Abdul', 'Syed', 'Ahmed', 'Ismail', 'Imran', 'Rafiq', 'Salman', 'Farooq', 'Yusuf', 'Nazeer', 'Shahul', 'Jabbar', 'Riyaz', 'Basheer', 'Anwar', 'Zakir', 'Hameed', 'Irfan', 'Sadiq', 'Kareem', 'Naushad', 'Habib', 'Fazil', 'Mustafa', 'Idris', 'Junaid', 'Aslam', 'Ayub', 'Khaleel', 'Rahim', 'Sulaiman'];
const FEMALE = ['Fathima', 'Ayesha', 'Zainab', 'Rukhsana', 'Shabana', 'Nasreen', 'Mumtaz', 'Sameera', 'Noorjahan', 'Rahmath', 'Farzana', 'Humera', 'Shaheen', 'Yasmin', 'Asma', 'Sabeena'];
const FAMILY = ['Khan', 'Basha', 'Hussain', 'Ali', 'Sheikh', 'Rahman', 'Ansari', 'Siddiqui', 'Ibrahim', 'Mohideen', 'Rawther', 'Maricar', 'Begum', 'Nisha', 'Banu', 'Fareed', 'Hameed', 'Raja', 'Ahmed', 'Shariff'];
const ROLES: Array<[string, 'MONTHLY' | 'DAILY', number, number]> = [
  ['Tea master', 'MONTHLY', 16000, 22000], ['Cashier', 'MONTHLY', 13000, 17000], ['Counter staff', 'MONTHLY', 10000, 13000], ['Counter staff', 'MONTHLY', 10000, 13000],
  ['Server', 'DAILY', 450, 600], ['Server', 'DAILY', 450, 600], ['Helper', 'DAILY', 400, 520], ['Cook', 'MONTHLY', 15000, 20000], ['Cleaner', 'DAILY', 350, 450], ['Snack maker', 'MONTHLY', 12000, 16000],
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

async function main() {
  const company = await prisma.company.findFirstOrThrow({ where: { code: arg('company', 'CMP000') } });
  const perBranch = Number(arg('per-branch', '10'));
  const branches = await prisma.location.findMany({ where: { company_id: company.id, type: 'BRANCH', status: 'ACTIVE' }, orderBy: { code: 'asc' } });
  const rand = rng(424242);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const names = new Set<string>();
  const used = new Set((await prisma.employee.findMany({ select: { full_name: true } })).map((e) => e.full_name));
  const newName = (female: boolean) => {
    for (;;) {
      const n = `${pick(female ? FEMALE : MALE)} ${pick(FAMILY)}`;
      if (!names.has(n) && !used.has(n)) { names.add(n); return n; }
    }
  };
  const today = toDate(todayIST());
  let total = 0;
  for (const b of branches) {
    // skip a branch that has already been given this batch: its employees carry a phone starting with 98 and a 2026-batch code range
    const marker = await prisma.employee.count({ where: { location_id: b.id, phone: { startsWith: '9884' } } });
    if (marker >= perBranch) continue;
    for (let i = 0; i < perBranch; i++) {
      const [role, type, lo, hi] = ROLES[i % ROLES.length];
      const female = ['Cashier', 'Counter staff', 'Snack maker'].includes(role) && rand() < 0.5;
      const salary = Math.round((lo + rand() * (hi - lo)) / (type === 'MONTHLY' ? 500 : 10)) * (type === 'MONTHLY' ? 500 : 10);
      const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('seq_code_employee') AS n`);
      await prisma.employee.create({
        data: {
          code: `EMP${String(n).padStart(6, '0')}`, full_name: newName(female), location_id: b.id, job_role: role,
          phone: `9884${String(Math.floor(100000 + rand() * 899999))}`, joining_date: addDays(today, -Math.floor(30 + rand() * 900)), salary_type: type,
          base_salary: D(salary), overtime_rate_per_hour: type === 'MONTHLY' ? D(Math.round(salary / 26 / 8 / 10) * 10) : D(0), payment_method: type === 'MONTHLY' ? 'BANK' : 'CASH',
        },
      });
      total++;
    }
  }
  console.log(`Added ${total} employees across ${branches.length} branches (${fmtDate(today)}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
