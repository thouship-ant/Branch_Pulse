import { randomInt } from 'node:crypto';
import { validation } from '../common/app-exception';

/** Default password for a new user, by role. The user must change it after the first sign-in. */
export const DEFAULT_PASSWORDS: Record<string, string> = {
  ADMIN: 'Admin@1234',
  ACCOUNTANT: 'Account@1234',
  STOCK_MANAGER: 'StkMr@1234',
  BRANCH_MANAGER: 'Manager@1234',
  STAFF: 'Emp@1234',
};

// when a user holds several roles the most privileged one decides
const ORDER = ['ADMIN', 'ACCOUNTANT', 'STOCK_MANAGER', 'BRANCH_MANAGER', 'STAFF'];

export function defaultPasswordFor(roleCodes: string[]): string {
  const code = ORDER.find((c) => roleCodes.includes(c));
  return code ? DEFAULT_PASSWORDS[code] : DEFAULT_PASSWORDS.STAFF;
}

export const PASSWORD_RULES = 'At least 8 characters with one uppercase letter, one lowercase letter, one number and one special character';

/** The reasons a password is not acceptable (empty when it is fine). */
export function passwordProblems(pw: string): string[] {
  const out: string[] = [];
  if (pw.length < 8) out.push('at least 8 characters');
  if (!/[A-Z]/.test(pw)) out.push('one uppercase letter');
  if (!/[a-z]/.test(pw)) out.push('one lowercase letter');
  if (!/\d/.test(pw)) out.push('one number');
  if (!/[^A-Za-z0-9]/.test(pw)) out.push('one special character');
  return out;
}

export function assertStrongPassword(pw: string, field = 'password') {
  const problems = passwordProblems(pw);
  if (problems.length) throw validation('WEAK_PASSWORD', `Password needs ${problems.join(', ')}`, field);
}

/** A random temporary password that satisfies the rules (no look-alike characters, SMS friendly). */
export function generateTempPassword(): string {
  const pick = (chars: string) => chars[randomInt(chars.length)];
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnopqrstuvwxyz', digit = '23456789', special = '@#$%&*!';
  const all = upper + lower + digit;
  const chars = [pick(upper), pick(lower), pick(digit), pick(special)];
  while (chars.length < 10) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { // shuffle
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
