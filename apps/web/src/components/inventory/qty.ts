import { dec } from '@/lib/money';

/** Quantities travel in the item's stock unit (ml, g, pcs). People read them in the purchase unit (litres, kg) when there is one. */
export const toDisplay = (base: string | number | null | undefined, factor: string | number): string => {
  if (base === null || base === undefined || base === '') return '';
  const f = dec(factor);
  return dec(base).div(f.isZero() ? 1 : f).toDecimalPlaces(3).toString();
};
export const toBase = (shown: string, factor: string | number): string => dec(shown).mul(dec(factor)).toDecimalPlaces(3).toString();
export const fmtQty = (base: string | number | null | undefined, factor: string | number, unit: string): string =>
  base === null || base === undefined ? '—' : `${toDisplay(base, factor)} ${unit}`;
