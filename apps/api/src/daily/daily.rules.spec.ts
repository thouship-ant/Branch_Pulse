import { D } from '../common/money';
import {
  assertClosingTransition, cashVariance, evaluatePrechecks, expectedCash, salesMismatch, varianceLabel,
} from './daily.rules';

describe('cash reconciliation (LLD 9.2)', () => {
  const base = {
    opening: D(2000), cashSales: D(10000), otherReceipts: D(0), cashExpenses: D(1500),
    cashPurchases: D(0), otherCashOut: D(0), withdrawals: D(0),
  };

  it('SRS example: 2,000 + 10,000 - 1,500 = 10,500 expected; actual 10,200 -> shortage 300', () => {
    const expected = expectedCash(base);
    expect(expected.toFixed(2)).toBe('10500.00');
    const variance = cashVariance(D(10200), expected);
    expect(variance.toFixed(2)).toBe('-300.00');
    expect(varianceLabel(variance)).toBe('SHORTAGE');
  });

  it('deducts cash purchases, supplier payments/advances and withdrawals', () => {
    const e = expectedCash({ ...base, cashPurchases: D(500), otherCashOut: D(250), withdrawals: D(1000), otherReceipts: D(100) });
    expect(e.toFixed(2)).toBe('8850.00');
  });

  it('labels surplus and tallied', () => {
    expect(varianceLabel(D(50))).toBe('SURPLUS');
    expect(varianceLabel(D(0))).toBe('TALLIED');
    expect(varianceLabel(null)).toBeNull();
  });

  it('has no floating-point drift across 1,000 random amounts', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
    const cents = Array.from({ length: 1000 }, () => Math.floor(rand() * 10_000_000));
    const exact = cents.reduce((a, c) => a + BigInt(c), 0n);
    const dec = cents.reduce((a, c) => a.plus(D(c).div(100)), D(0));
    expect(dec.mul(100).toFixed(0)).toBe(exact.toString());
  });
});

describe('sales split (LLD 9.1)', () => {
  it('mismatch = total - (cash + upi + card + credit + other)', () => {
    const m = salesMismatch({ total: D(30000), cash: D(12000), upi: D(17000), card: D(500), credit: D(0), otherAdjustments: D(0) });
    expect(m.toFixed(2)).toBe('500.00');
  });

  it('a matching split has zero mismatch', () => {
    const m = salesMismatch({ total: D(30000), cash: D(12000), upi: D(17000), card: D(1000), credit: D(0), otherAdjustments: D(0) });
    expect(m.isZero()).toBe(true);
  });
});

describe('daily closing state machine (LLD s8)', () => {
  it.each([
    ['PENDING', 'SUBMITTED'], ['SUBMITTED', 'APPROVED'], ['SUBMITTED', 'REJECTED'],
    ['REJECTED', 'SUBMITTED'], ['APPROVED', 'REOPENED'], ['REOPENED', 'SUBMITTED'],
  ] as const)('%s -> %s is allowed', (from, to) => {
    expect(() => assertClosingTransition(from, to)).not.toThrow();
  });

  it.each([
    ['PENDING', 'APPROVED'], ['APPROVED', 'SUBMITTED'], ['REJECTED', 'APPROVED'],
    ['PENDING', 'REOPENED'], ['SUBMITTED', 'REOPENED'], ['REOPENED', 'APPROVED'],
  ] as const)('%s -> %s is rejected with 409 INVALID_TRANSITION', (from, to) => {
    expect(() => assertClosingTransition(from, to)).toThrow(/cannot go from/);
  });
});

describe('closing submission pre-checks', () => {
  const okSales = { mismatch: D(0), remarks: null };
  const okRecon = { actualClosing: D(10500), variance: D(0), reason: null, explanation: null };
  const failing = (c: ReturnType<typeof evaluatePrechecks>) => c.filter((x) => !x.ok).map((x) => x.code);

  it('passes when everything is in order', () => {
    expect(failing(evaluatePrechecks({ sales: okSales, recon: okRecon, tolerance: D(0) }))).toEqual([]);
  });

  it('blocks submit without sales or cash count', () => {
    expect(failing(evaluatePrechecks({ sales: null, recon: null, tolerance: D(0) }))).toEqual(['SALES_ENTERED', 'CASH_COUNTED']);
  });

  it('a split mismatch needs a remark (or to be within tolerance)', () => {
    const mism = { mismatch: D(500), remarks: null };
    expect(failing(evaluatePrechecks({ sales: mism, recon: okRecon, tolerance: D(0) }))).toEqual(['SALES_SPLIT_MATCHES']);
    expect(failing(evaluatePrechecks({ sales: { ...mism, remarks: 'card machine down' }, recon: okRecon, tolerance: D(0) }))).toEqual([]);
    expect(failing(evaluatePrechecks({ sales: mism, recon: okRecon, tolerance: D(500) }))).toEqual([]);
  });

  it('a non-zero cash variance needs a reason and a 10+ character explanation', () => {
    const v = { actualClosing: D(10200), variance: D(-300), reason: null, explanation: null };
    expect(failing(evaluatePrechecks({ sales: okSales, recon: v, tolerance: D(0) }))).toEqual(['VARIANCE_EXPLAINED']);
    const short = { ...v, reason: 'SHORT_CHANGE', explanation: 'too short' };
    expect(failing(evaluatePrechecks({ sales: okSales, recon: short, tolerance: D(0) }))).toEqual(['VARIANCE_EXPLAINED']);
    const good = { ...v, reason: 'SHORT_CHANGE', explanation: 'Gave wrong change to a customer' };
    expect(failing(evaluatePrechecks({ sales: okSales, recon: good, tolerance: D(0) }))).toEqual([]);
  });
});
