import Decimal from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export const dec = (v: string | number | null | undefined): Decimal => {
  try {
    return new Decimal(v === null || v === undefined || v === '' ? 0 : v);
  } catch {
    return new Decimal(0);
  }
};

const inr0 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** ₹1,23,456.00 - Indian digit grouping (LLD s9 Localization). Never goes through float math. */
export function formatINR(v: string | number | Decimal | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (v === null || v === undefined || v === '') return '—';
  const d = v instanceof Decimal ? v : dec(v as string | number);
  const neg = d.isNegative();
  // Intl formats numbers; feed it the exact fixed string split into integer/fraction to avoid float drift
  const fixed = d.abs().toFixed(2);
  const [int, frac] = fixed.split('.');
  const grouped = inr0.format(BigInt(int));
  const body = opts.decimals === false ? grouped : `${grouped}.${frac}`;
  return `${neg ? '-' : ''}₹${body}`;
}

/** Decimal-safe sum for live previews (the server value stays authoritative). */
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
