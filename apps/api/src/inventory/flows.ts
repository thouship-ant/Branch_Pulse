import { D, Dec, ZERO } from '../common/money';
import { Tx } from '../common/prisma.service';

/** One item's day at one location: the reconciliation formula, in base units. */
export interface DayFlow {
  opening: Dec;
  purchases: Dec;
  transfersIn: Dec;
  transfersOut: Dec; // shown as a positive number that is subtracted
  consumption: Dec; // positive, subtracted
  wastage: Dec; // positive, subtracted
  other: Dec; // signed: transfer variance, reversals
  adjustment: Dec; // signed: an approved count's correction, dated this day. Not part of expected.
  expected: Dec;
}

export const emptyFlow = (): DayFlow => ({
  opening: ZERO, purchases: ZERO, transfersIn: ZERO, transfersOut: ZERO, consumption: ZERO, wastage: ZERO, other: ZERO, adjustment: ZERO, expected: ZERO,
});

/** Opening + purchases + transfers in - transfers out - consumption - wastage (+ other) = expected closing. */
export const expectedOf = (f: DayFlow): Dec =>
  f.opening.plus(f.purchases).plus(f.transfersIn).minus(f.transfersOut).minus(f.consumption).minus(f.wastage).plus(f.other);

/**
 * The day's stock flows per item, straight from the append-only inventory ledger:
 * opening = everything before the day (plus an OPENING load dated the day); the rest are the day's movements by type.
 * A count's correction (COUNT_ADJUSTMENT) dated the day is kept apart, so "expected" stays what the books said before the count.
 */
export async function dayFlows(tx: Tx, locationId: string, date: Date, itemIds?: string[]): Promise<Map<string, DayFlow>> {
  const itemFilter = itemIds ? { item_id: { in: itemIds } } : {};
  const [before, day] = await Promise.all([
    tx.inventoryTransaction.groupBy({ by: ['item_id'], where: { location_id: locationId, business_date: { lt: date }, ...itemFilter }, _sum: { quantity: true } }),
    tx.inventoryTransaction.groupBy({ by: ['item_id', 'txn_type'], where: { location_id: locationId, business_date: date, ...itemFilter }, _sum: { quantity: true } }),
  ]);
  const out = new Map<string, DayFlow>();
  const get = (id: string) => {
    let f = out.get(id);
    if (!f) { f = emptyFlow(); out.set(id, f); }
    return f;
  };
  for (const b of before) get(b.item_id).opening = D(b._sum.quantity ?? 0);
  for (const d of day) {
    const f = get(d.item_id);
    const q = D(d._sum.quantity ?? 0);
    switch (d.txn_type) {
      case 'OPENING': f.opening = f.opening.plus(q); break;
      case 'PURCHASE_IN': f.purchases = f.purchases.plus(q); break;
      case 'TRANSFER_IN': f.transfersIn = f.transfersIn.plus(q); break;
      case 'TRANSFER_OUT': f.transfersOut = f.transfersOut.plus(q.neg()); break;
      case 'CONSUMPTION': f.consumption = f.consumption.plus(q.neg()); break;
      case 'WASTAGE': f.wastage = f.wastage.plus(q.neg()); break;
      case 'COUNT_ADJUSTMENT': f.adjustment = f.adjustment.plus(q); break;
      default: f.other = f.other.plus(q); // TRANSFER_VARIANCE, REVERSAL
    }
  }
  for (const f of out.values()) f.expected = expectedOf(f);
  return out;
}
