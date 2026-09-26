import { Prisma } from '@prisma/client';
import { AppException } from './app-exception';
import { addDaysStr, timeIST, toDate, todayIST } from './dates';
import { parseMoney, parseQty, round2 } from './money';
import { serialise } from './response';

describe('money parsing (V4/V5)', () => {
  it('accepts strings with up to 2 decimals', () => {
    expect(parseMoney('1250.50', 'amount').toFixed(2)).toBe('1250.50');
    expect(parseMoney('0', 'amount').isZero()).toBe(true);
    expect(parseMoney('99999999.99', 'amount').toFixed(2)).toBe('99999999.99');
  });

  it.each(['1.234', '-5', 'abc', '', '1e3', '100000000', ' '])('rejects %p', (v) => {
    expect(() => parseMoney(v, 'amount')).toThrow(AppException);
  });

  it('can require a positive amount and allow negatives where the rule says so', () => {
    expect(() => parseMoney('0', 'amount', { allowZero: false })).toThrow(/greater than zero/);
    expect(parseMoney('-25.5', 'adj', { allowNegative: true }).toFixed(2)).toBe('-25.50');
  });

  it('quantities allow up to 3 decimals', () => {
    expect(parseQty('1.500', 'qty').toFixed(3)).toBe('1.500');
    expect(() => parseQty('1.5001', 'qty')).toThrow(AppException);
    expect(() => parseQty('0', 'qty')).toThrow(AppException);
  });

  it('rounds half-up to 2 decimals', () => {
    expect(round2(new Prisma.Decimal('2.345')).toFixed(2)).toBe('2.35');
    expect(round2(new Prisma.Decimal('2.344')).toFixed(2)).toBe('2.34');
  });
});

describe('business dates', () => {
  it('parses YYYY-MM-DD as UTC midnight and rejects impossible dates', () => {
    expect(toDate('2026-09-26').toISOString()).toBe('2026-09-26T00:00:00.000Z');
    expect(() => toDate('2026-02-30')).toThrow(AppException);
    expect(() => toDate('26/09/2026')).toThrow(AppException);
  });

  it('uses the IST calendar day, not UTC (18:30 UTC is already the next day in India)', () => {
    expect(todayIST(new Date('2026-09-26T18:29:00Z'))).toBe('2026-09-26');
    expect(todayIST(new Date('2026-09-26T18:31:00Z'))).toBe('2026-09-27');
    expect(timeIST(new Date('2026-09-26T18:31:00Z'))).toBe('00:01');
  });

  it('adds days', () => {
    expect(addDaysStr('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysStr('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('response serialisation (LLD s1)', () => {
  it('camelCases keys, prints Decimals as strings and DATE columns as YYYY-MM-DD', () => {
    const out = serialise({
      total_sales: new Prisma.Decimal('1250.5'),
      business_date: new Date('2026-09-26T00:00:00.000Z'),
      created_at: new Date('2026-09-26T08:15:30.123Z'),
      nested_rows: [{ location_id: 'x' }],
    });
    expect(out).toEqual({
      totalSales: '1250.5',
      businessDate: '2026-09-26',
      createdAt: '2026-09-26T08:15:30.123Z',
      nestedRows: [{ locationId: 'x' }],
    });
  });

  it('never leaks secrets or binary columns', () => {
    const out = serialise({ id: 1n, password_hash: 'x', refresh_token_hash: 'y', bank_details_enc: Buffer.from('z'), name: 'ok' });
    expect(out).toEqual({ id: '1', name: 'ok' });
  });
});
