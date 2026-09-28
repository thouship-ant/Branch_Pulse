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
  CHEQUE: 'modeCheque',
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

export const COUNT_REASON_KEY: Record<string, MessageKey> = {
  MEASUREMENT: 'crMeasurement', SPILLAGE: 'crSpillage', UNRECORDED_USE: 'crUnrecordedUse', UNRECORDED_WASTAGE: 'crUnrecordedWastage',
  SUPPLIER_SHORT: 'crSupplierShort', THEFT_SUSPECTED: 'crTheft', COUNTING_ERROR: 'crCountingError', OTHER: 'crOther',
};

export const WASTAGE_REASON_KEY: Record<string, MessageKey> = {
  SPOILED: 'wrSpoiled', EXPIRED: 'wrExpired', BURNT: 'wrBurnt', DAMAGED: 'wrDamaged', EXCESS_PREPARATION: 'wrExcessPrep',
  STAFF_CONSUMPTION: 'wrStaff', COMPLIMENTARY: 'wrComplimentary', OTHER: 'wrOther',
};

export const TRANSFER_STATUS_KEY: Record<string, MessageKey> = {
  DRAFT: 'trPending', PENDING_APPROVAL: 'trPending', APPROVED: 'trApproved', DISPATCHED: 'trDispatched',
  RECEIVED: 'trReceived', PARTIALLY_RECEIVED: 'trPartial', CANCELLED: 'trCancelled',
};

export const ATTENDANCE_STATUS_KEY: Record<string, MessageKey> = {
  PRESENT: 'stPresent', ABSENT: 'stAbsent', LEAVE: 'stLeave', HALF_DAY: 'stHalfDay', WEEK_OFF: 'stWeekOff', HOLIDAY: 'stHoliday',
};

export const ADVANCE_STATUS_KEY: Record<string, MessageKey> = {
  REQUESTED: 'advRequested', MANAGER_APPROVED: 'advManagerApproved', APPROVED: 'advApproved', REJECTED: 'rejected',
  PAID: 'advPaid', CLOSED: 'advClosed', CANCELLED: 'cancelled',
};
