import { dec } from './money';

/** Quantities travel in the item's stock unit (ml, g, pcs). People read them in the purchase unit (litres, kg) when there is one. */
export const toDisplay = (base: string | number | null | undefined, factor: string | number): string => {
  if (base === null || base === undefined || base === '') return '';
  const f = dec(factor);
  return dec(base).div(f.isZero() ? 1 : f).toDecimalPlaces(3).toString();
};
export const toBase = (shown: string, factor: string | number): string => dec(shown).mul(dec(factor)).toDecimalPlaces(3).toString();
export const fmtQty = (base: string | number | null | undefined, factor: string | number, unit: string): string =>
  base === null || base === undefined ? '—' : `${toDisplay(base, factor)} ${unit}`;

/** Keep a typed quantity to digits and up to three decimals. */
export const cleanQty = (v: string) => v.replace(/[^\d.]/g, '').replace(/^(\d*\.\d{0,3}).*$/, '$1');

export const WASTAGE_REASONS: Array<[string, string]> = [
  ['SPOILED', 'Spoiled'], ['EXPIRED', 'Expired'], ['BURNT', 'Burnt'], ['DAMAGED', 'Damaged'], ['EXCESS_PREPARATION', 'Excess preparation'],
  ['STAFF_CONSUMPTION', 'Staff consumption'], ['COMPLIMENTARY', 'Complimentary'], ['OTHER', 'Other'],
];
export const wastageReason = (code: string) => WASTAGE_REASONS.find(([c]) => c === code)?.[1] ?? code;

export const TRANSFER_STATUS: Record<string, string> = {
  DRAFT: 'Pending', PENDING_APPROVAL: 'Pending approval', APPROVED: 'Approved', DISPATCHED: 'On the way', RECEIVED: 'Received', CANCELLED: 'Cancelled', REJECTED: 'Rejected',
};

export const COUNT_REASONS: Array<[string, string]> = [
  ['MEASUREMENT', 'Measurement'], ['SPILLAGE', 'Spillage'], ['UNRECORDED_USE', 'Unrecorded use'], ['UNRECORDED_WASTAGE', 'Unrecorded wastage'],
  ['SUPPLIER_SHORT', 'Supplier short'], ['THEFT_SUSPECTED', 'Theft suspected'], ['COUNTING_ERROR', 'Counting error'], ['OTHER', 'Other'],
];
