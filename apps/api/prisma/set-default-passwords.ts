/**
 * Gives every company user the default password for their role (Admin@1234, Account@1234, StkMr@1234, Manager@1234,
 * Emp@1234) and makes them change it at the next sign-in. For databases whose users predate the password policy.
 *
 *   npx tsx prisma/set-default-passwords.ts              all company users
 *   npx tsx prisma/set-default-passwords.ts --company CMP000
 *
 * The Super Admin is never touched. Runs as the database owner (DIRECT_URL).
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { defaultPasswordFor } from '../src/auth/passwords';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const argIdx = process.argv.indexOf('--company');
const companyCode = argIdx > 0 ? process.argv[argIdx + 1] : undefined;

async function main() {
  const users = await prisma.user.findMany({
    where: { company_id: companyCode ? (await prisma.company.findUniqueOrThrow({ where: { code: companyCode } })).id : { not: null } },
    include: { roles: { include: { role: true } } },
  });
  const cache = new Map<string, string>();
  let n = 0;
  for (const u of users) {
    const pw = defaultPasswordFor(u.roles.map((r) => r.role.code));
    if (!cache.has(pw)) cache.set(pw, await argon2.hash(pw));
    await prisma.user.update({
      where: { id: u.id },
      data: { password_hash: cache.get(pw)!, must_change_password: true, password_changed_at: null, failed_logins: 0, locked_until: null },
    });
    n++;
  }
  console.log(`Default passwords set for ${n} users${companyCode ? ` of ${companyCode}` : ''}; they must change them at the next sign-in.`);
}

main().finally(() => prisma.$disconnect());
