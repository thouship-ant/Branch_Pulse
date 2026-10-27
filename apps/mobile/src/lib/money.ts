import Decimal from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export const dec = (v: string | number | null | undefined): Decimal => {
  try {
    return new Decimal(v === null || v === undefined || v === '' ? 0 : v);
  } catch {
    return new Decimal(0);
  }
};

/** 1234567 -> 12,34,567 (Indian grouping, done by hand because Intl support for en-IN varies by platform). */
function group(int: string): string {
  if (int.length <= 3) return int;
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** ₹1,23,456.00 - never goes through float math. */
export function formatINR(v: string | number | Decimal | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (v === null || v === undefined || v === '') return '—';
  const d = v instanceof Decimal ? v : dec(v as string | number);
  const [int, frac] = d.abs().toFixed(2).split('.');
  return `${d.isNegative() ? '-' : ''}₹${group(int)}${opts.decimals === false ? '' : `.${frac}`}`;
}

export const sumDec = (values: Array<string | number | Decimal | null | undefined>): Decimal =>
  values.reduce<Decimal>((a, v) => a.plus(v instanceof Decimal ? v : dec(v)), new Decimal(0));

/** Accept only characters valid in a 2-decimal amount while typing. */
export function cleanAmount(input: string, maxDecimals = 2): string {
  let s = input.replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, maxDecimals);
  return s.replace(/^0+(?=\d)/, '');
}

/** "" -> undefined so optional fields are omitted from requests. */
export const amt = (s: string): string | undefined => (s.trim() === '' ? undefined : new Decimal(s || 0).toFixed(2));
