import type { MessageKey } from './i18n';

/** Server codes -> translation keys, so enum values never reach the screen as raw English. */
export const REASON_KEY: Record<string, MessageKey> = {
  SHORT_CHANGE: 'reasonShortChange',
  COUNTING_ERROR: 'reasonCounting',
  CASH_TAKEN: 'reasonCashTaken',
  UNRECORDED_EXPENSE: 'reasonUnrecorded',
  OTHER: 'reasonOther',
};

export const MODE_KEY: Record<string, MessageKey> = {
  CASH: 'cash',
  UPI: 'upi',
  CARD: 'card',
  BANK_TRANSFER: 'modeBank',
  CREDIT: 'credit',
};

export const STATUS_KEY: Record<string, MessageKey> = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REOPENED: 'reopened',
  CANCELLED: 'cancelled',
  REVERSED: 'reversed',
};

/** Cash movement types as the manager sees them. */
export const MOVEMENT_KEY: Record<string, MessageKey> = {
  OTHER_RECEIPT: 'mvOtherReceipt',
  WITHDRAWAL: 'mvWithdrawal',
  DEPOSIT_TO_BANK: 'mvDeposit',
  ADJUSTMENT: 'mvAdjustment',
  EXPENSE: 'mvExpense',
  PURCHASE: 'mvPurchase',
  SUPPLIER_PAYMENT: 'mvSupplier',
  ADVANCE_PAYMENT: 'mvAdvance',
  OPENING: 'openingCash',
};

export const EXCEPTION_KEY: Record<string, MessageKey> = {
  CLOSING_PENDING: 'exClosingPending',
  CLOSING_REJECTED: 'exClosingRejected',
  CLOSING_REOPENED: 'exClosingReopened',
  CASH_SHORTAGE: 'exCashShortage',
  CASH_SURPLUS: 'exCashSurplus',
  APPROVAL_PENDING: 'exApprovalPending',
};
