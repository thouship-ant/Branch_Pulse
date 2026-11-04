/**
 * Sets the Super Admin's password to SEED_PASSWORD (or NEW_PASSWORD) and signs the account out everywhere. The seed only
 * creates the Super Admin when it does not exist yet, so on a database that already has one this is how to change it.
 *
 *   production:  $C run --rm seed npx tsx prisma/set-superadmin-password.ts      (uses SEED_PASSWORD from .env.prod)
 *   dev:         NEW_PASSWORD='...' npx tsx prisma/set-superadmin-password.ts
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { assertStrongPassword } from '../src/auth/passwords';

try {
  (process as any).loadEnvFile?.('.env');
} catch {
  /* no .env */
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });

async function main() {
  const pw = process.env.NEW_PASSWORD || process.env.SEED_PASSWORD;
  if (!pw) throw new Error('Set SEED_PASSWORD (or NEW_PASSWORD) first');
  assertStrongPassword(pw);
  const r = await prisma.user.updateMany({
    where: { username: 'superadmin', company_id: null },
    data: { password_hash: await argon2.hash(pw), failed_logins: 0, locked_until: null, must_change_password: false, password_changed_at: new Date() },
  });
  if (r.count === 0) throw new Error("No Super Admin ('superadmin') found - run the seed first");
  await prisma.session.updateMany({ where: { user: { username: 'superadmin', company_id: null }, revoked_at: null }, data: { revoked_at: new Date() } });
  console.log("Super Admin password updated. Sign in as 'superadmin'.");
}

main().finally(() => prisma.$disconnect());
