export const MODE_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank', CHEQUE: 'Cheque', CREDIT: 'Credit' };
export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Rejected', REOPENED: 'Reopened', CANCELLED: 'Cancelled', REVERSED: 'Reversed',
};
export const REASON_LABEL: Record<string, string> = {
  SHORT_CHANGE: 'Short change', COUNTING_ERROR: 'Counting error', CASH_TAKEN: 'Cash taken', UNRECORDED_EXPENSE: 'Unrecorded expense', OTHER: 'Other',
};
export const MOVEMENT_LABEL: Record<string, string> = {
  OTHER_RECEIPT: 'Other receipt', WITHDRAWAL: 'Withdrawal', DEPOSIT_TO_BANK: 'Deposit to bank', ADJUSTMENT: 'Adjustment',
  EXPENSE: 'Expense', PURCHASE: 'Purchase', SUPPLIER_PAYMENT: 'Supplier payment', ADVANCE_PAYMENT: 'Advance',
};
export const roleLabel = (code: string) => code.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');

/** Chip tone for an approval status. */
export const approvalTone = (s: string | null | undefined) => (s === 'APPROVED' ? 'ok' : s === 'REJECTED' ? 'bad' : s === 'SUBMITTED' ? 'warn' : 'neutral') as 'ok' | 'bad' | 'warn' | 'neutral';
