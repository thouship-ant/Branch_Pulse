import { Prisma } from '@prisma/client';
import { validation } from './app-exception';

export type Dec = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value): Dec => new Prisma.Decimal(v);
export const ZERO = new Prisma.Decimal(0);

/** Round half-up to 2 decimal places (LLD s1: rounding only at posting). */
export const round2 = (v: Dec): Dec => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const round3 = (v: Dec): Dec => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);

export const MAX_AMOUNT = D('99999999.99'); // 9,99,99,999.99 (V4)

const MONEY_RE = /^-?\d{1,8}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;

/**
 * Parse a money string ("1250.50") into a Decimal. Amounts travel as strings to avoid float
 * parsing (LLD s1). Rejects numbers-as-floats, >2 decimals and out-of-range values (V4).
 */
export function parseMoney(
  value: unknown,
  field: string,
  opts: { allowNegative?: boolean; allowZero?: boolean } = {},
): Dec {
  const { allowNegative = false, allowZero = true } = opts;
  const s = typeof value === 'number' ? String(value) : value;
  if (typeof s !== 'string' || !MONEY_RE.test(s.trim())) {
    throw validation('INVALID_AMOUNT', `${field}: enter an amount with up to 2 decimals`, field);
  }
  const d = D(s.trim());
  if (!allowNegative && d.isNegative()) throw validation('INVALID_AMOUNT', `${field} cannot be negative`, field);
  if (!allowZero && d.isZero()) throw validation('INVALID_AMOUNT', `${field} must be greater than zero`, field);
  if (d.abs().greaterThan(MAX_AMOUNT)) throw validation('INVALID_AMOUNT', `${field} is too large`, field);
  return d;
}

/** Optional money field: undefined/null/'' -> 0. */
export const parseMoneyOr0 = (value: unknown, field: string, opts = {}): Dec =>
  value === undefined || value === null || value === '' ? ZERO : parseMoney(value, field, opts);

export function parseQty(value: unknown, field: string, opts: { allowZero?: boolean } = {}): Dec {
  const s = typeof value === 'number' ? String(value) : value;
  if (typeof s !== 'string' || !QTY_RE.test(s.trim())) {
    throw validation('INVALID_QTY', `${field}: enter a quantity with up to 3 decimals`, field);
  }
  const d = D(s.trim());
  if (!opts.allowZero && d.isZero()) throw validation('INVALID_QTY', `${field} must be greater than zero`, field);
  return d;
}

export const sum = (values: Array<Dec | null | undefined>): Dec =>
  values.reduce<Dec>((acc, v) => (v ? acc.plus(v) : acc), ZERO);

/** Regex for DTO decorators. */
export const MONEY_PATTERN = MONEY_RE;
