import { ClosingStatus } from '@prisma/client';
import { Dec, D, ZERO } from '../common/money';
import { invalidTransition } from '../common/app-exception';

// ---------------------------------------------------------------- sales split (LLD 9.1)
/** Mismatch = Total - (Cash + UPI + Card + Credit + Other adjustments). Complimentary is informational. */
export function salesMismatch(p: {
  total: Dec; cash: Dec; upi: Dec; card: Dec; credit: Dec; otherAdjustments: Dec;
}): Dec {
  return p.total.minus(p.cash.plus(p.upi).plus(p.card).plus(p.credit).plus(p.otherAdjustments));
}

// ---------------------------------------------------------------- cash reconciliation (LLD 9.2)
export interface CashComponents {
  opening: Dec;
  cashSales: Dec;
  otherReceipts: Dec;
  cashExpenses: Dec;
  cashPurchases: Dec;
  otherCashOut: Dec;
  withdrawals: Dec;
}

/** Expected = Opening + Cash sales + Other receipts - Cash expenses - Cash purchases - Other cash out - Withdrawals. */
export function expectedCash(c: CashComponents): Dec {
  return c.opening
    .plus(c.cashSales)
    .plus(c.otherReceipts)
    .minus(c.cashExpenses)
    .minus(c.cashPurchases)
    .minus(c.otherCashOut)
    .minus(c.withdrawals);
}

/** Variance = Actual - Expected. < 0 shortage, > 0 surplus, 0 tallied. */
export const cashVariance = (actual: Dec, expected: Dec): Dec => actual.minus(expected);

export function varianceLabel(v: Dec | null | undefined): 'SHORTAGE' | 'SURPLUS' | 'TALLIED' | null {
  if (v === null || v === undefined) return null;
  if (v.isZero()) return 'TALLIED';
  return v.isNegative() ? 'SHORTAGE' : 'SURPLUS';
}

// ---------------------------------------------------------------- daily closing state machine (LLD s8)
const CLOSING_TRANSITIONS: Record<ClosingStatus, ClosingStatus[]> = {
  PENDING: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  REJECTED: ['SUBMITTED'],
  APPROVED: ['REOPENED'],
  REOPENED: ['SUBMITTED'],
};

export function assertClosingTransition(from: ClosingStatus, to: ClosingStatus) {
  if (!CLOSING_TRANSITIONS[from]?.includes(to)) throw invalidTransition('Daily closing', from, to);
}

// ---------------------------------------------------------------- submission pre-checks (HLD 5.2, LLD V25)
export interface Precheck {
  code: string;
  ok: boolean;
  message: string;
}

export interface PrecheckInput {
  sales: { mismatch: Dec; remarks?: string | null } | null;
  recon: {
    actualClosing: Dec | null;
    variance: Dec | null;
    reason?: string | null;
    explanation?: string | null;
  } | null;
  tolerance: Dec;
}

export function evaluatePrechecks(i: PrecheckInput): Precheck[] {
  const checks: Precheck[] = [];

  checks.push({
    code: 'SALES_ENTERED',
    ok: !!i.sales,
    message: 'Enter the total sales for the day',
  });

  const splitOk = !i.sales || i.sales.mismatch.abs().lessThanOrEqualTo(i.tolerance) || !!i.sales.remarks?.trim();
  checks.push({
    code: 'SALES_SPLIT_MATCHES',
    ok: splitOk,
    message: 'Cash + UPI + Card + Credit must equal total sales, or add a remark explaining the difference',
  });

  const counted = !!i.recon && i.recon.actualClosing !== null;
  checks.push({ code: 'CASH_COUNTED', ok: counted, message: 'Enter the actual closing cash count' });

  const v = i.recon?.variance ?? ZERO;
  const explained = v.isZero() || (!!i.recon?.reason && (i.recon?.explanation?.trim().length ?? 0) >= 10);
  checks.push({
    code: 'VARIANCE_EXPLAINED',
    ok: !counted || explained,
    message: 'Cash does not tally: choose a reason and write an explanation (at least 10 characters)',
  });

  return checks;
}

export const D0 = D(0);
