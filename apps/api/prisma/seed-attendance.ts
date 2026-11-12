/**
 * Attendance and payroll history for a company's employees, up to yesterday: nearly every day PRESENT, a few leave / half days,
 * some overtime. Then a payroll row for each finished month (basic from attendance + overtime + allowance - advance recovery),
 * approved and paid in full, in part, or not yet. Idempotent: existing attendance days and salary months are left alone.
 *
 *   npx tsx prisma/seed-attendance.ts --company CMP000 --from 2026-09-01
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { addDays, fmtDate, toDate, todayIST } from '../src/common/dates';

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
const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

async function main() {
  const company = await prisma.company.findFirstOrThrow({ where: { code: arg('company', 'CMP000') } });
  const from = toDate(arg('from', '2026-09-01'));
  const yesterday = addDays(toDate(todayIST()), -1);
  const owner = await prisma.user.findFirstOrThrow({ where: { company_id: company.id, roles: { some: { role: { code: 'ADMIN' } } } } });
  const locs = await prisma.location.findMany({ where: { company_id: company.id }, select: { id: true, manager_user_id: true } });
  const locIds = locs.map((l) => l.id);
  const employees = await prisma.employee.findMany({ where: { location_id: { in: locIds }, status: 'ACTIVE' }, orderBy: { code: 'asc' } });
  const marker = new Map(locs.map((l) => [l.id, l.manager_user_id ?? owner.id]));

  // ---- attendance
  let att = 0;
  for (const [ei, e] of employees.entries()) {
    const rand = rng(900 + ei);
    const start = e.joining_date.getTime() > from.getTime() ? e.joining_date : from;
    const existing = new Set((await prisma.attendance.findMany({ where: { employee_id: e.id, business_date: { gte: start, lte: yesterday } }, select: { business_date: true } })).map((a) => fmtDate(a.business_date)));
    const data: Prisma.AttendanceCreateManyInput[] = [];
    for (let d = start; d.getTime() <= yesterday.getTime(); d = addDays(d, 1)) {
      const ds = fmtDate(d);
      const r = rand(), o = rand();
      if (existing.has(ds)) continue;
      const status = r < 0.945 ? 'PRESENT' : r < 0.97 ? 'LEAVE' : r < 0.99 ? 'HALF_DAY' : 'ABSENT';
      data.push({
        employee_id: e.id, location_id: e.location_id, business_date: d, status: status as any,
        overtime_hours: status === 'PRESENT' && o < 0.1 ? D(Math.ceil(rand() * 2)) : D(0), marked_by: marker.get(e.location_id)!, source: 'SYSTEM', created_by: owner.id,
      });
    }
    if (data.length) { await prisma.attendance.createMany({ data, skipDuplicates: true }); att += data.length; }
  }

  // ---- payroll for each finished month
  const thisMonth = toDate(`${todayIST().slice(0, 7)}-01`);
  let pay = 0;
  for (let m = toDate(`${fmtDate(from).slice(0, 7)}-01`); m.getTime() < thisMonth.getTime(); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const monthEnd = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
    const calendarDays = monthEnd.getUTCDate();
    for (const [ei, e] of employees.entries()) {
      if (e.joining_date.getTime() > monthEnd.getTime()) continue;
      if (await prisma.salary.findUnique({ where: { employee_id_period_month: { employee_id: e.id, period_month: m } } })) continue;
      const rows = await prisma.attendance.findMany({ where: { employee_id: e.id, business_date: { gte: m, lte: monthEnd } } });
      if (rows.length === 0) continue;
      const count = (s: string) => rows.filter((r) => r.status === s).length;
      const presentDays = D(count('PRESENT') + count('HALF_DAY') * 0.5);
      const workingDays = D(calendarDays - count('WEEK_OFF') - count('HOLIDAY'));
      const overtimeHours = rows.reduce((t, r) => t.plus(r.overtime_hours), D(0));
      const basic = e.salary_type === 'DAILY' ? round2(e.base_salary.mul(presentDays)) : round2(e.base_salary.mul(presentDays).div(workingDays));
      const overtime = round2(overtimeHours.mul(e.overtime_rate_per_hour));
      const rand = rng(5000 + ei + m.getUTCMonth() * 101);
      const allowances = D(Math.round((rand() < 0.6 ? 300 + rand() * 900 : 0) / 50) * 50);
      const payable = round2(basic.plus(overtime).plus(allowances));
      const roll = rand();
      const status = roll < 0.78 ? 'PAID' : roll < 0.9 ? 'PARTIAL' : 'UNPAID';
      const paid = status === 'PAID' ? payable : status === 'PARTIAL' ? D(Math.round(payable.mul(0.5).toNumber() / 100) * 100) : D(0);
      await prisma.salary.create({
        data: {
          employee_id: e.id, location_id: e.location_id, period_month: m, working_days: workingDays, present_days: presentDays, leave_days: D(count('LEAVE')), overtime_hours: overtimeHours,
          basic_earned: basic, overtime_amount: overtime, allowances, advance_recovery: D(0), other_deductions: D(0), payable, paid_amount: paid, payment_status: status,
          approval_status: 'APPROVED', approved_by: owner.id, paid_on: status === 'UNPAID' ? null : addDays(toDate(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)), 4 + Math.floor(rand() * 3)),
          payment_mode: status === 'UNPAID' ? null : e.payment_method === 'BANK' ? 'BANK_TRANSFER' : 'CASH', created_by: owner.id,
        },
      });
      pay++;
    }
  }
  console.log(`Attendance: ${att} days written up to ${fmtDate(yesterday)}; payroll: ${pay} salary months created.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
