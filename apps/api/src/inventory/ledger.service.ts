import { Injectable } from '@nestjs/common';
import { Prisma, StockTxnType } from '@prisma/client';
import { ReqCtx } from '../common/auth-user';
import { D, Dec, round2, ZERO } from '../common/money';
import { Tx } from '../common/prisma.service';

export interface LedgerPost {
  locationId: string;
  itemId: string;
  date: Date;
  type: StockTxnType;
  quantity: Dec; // signed: + adds stock, - removes it
  unitCost: Dec;
  sourceType: string;
  sourceId: string;
  counterpartyLocationId?: string;
  reversalOfId?: string;
}

/**
 * The one place stock moves. Every movement is an append-only inventory_transactions row plus an atomic update of the
 * location's balance (weighted-average cost). Nothing else writes stock_balances.
 */
@Injectable()
export class LedgerService {
  /** Atomic stock movement with weighted-average cost. Returns the balance after. */
  async moveStock(tx: Tx, locationId: string, itemId: string, qty: Dec, value: Dec, unitCost: Dec): Promise<Dec> {
    const rows = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal }>>`
      INSERT INTO stock_balances (location_id, item_id, quantity, avg_cost, value, last_txn_at, version)
      VALUES (${locationId}::uuid, ${itemId}::uuid, ${qty.toString()}::numeric, ${unitCost.toString()}::numeric, ${value.toString()}::numeric, now(), 1)
      ON CONFLICT (location_id, item_id) DO UPDATE SET
        quantity = stock_balances.quantity + EXCLUDED.quantity,
        value = stock_balances.value + EXCLUDED.value,
        avg_cost = CASE WHEN stock_balances.quantity + EXCLUDED.quantity > 0
                        THEN round((stock_balances.value + EXCLUDED.value) / (stock_balances.quantity + EXCLUDED.quantity), 4)
                        ELSE stock_balances.avg_cost END,
        last_txn_at = now(), version = stock_balances.version + 1
      RETURNING quantity`;
    return D(rows[0].quantity);
  }

  /** What a unit of this item is worth at this location right now: its average cost, else the item's, else its last purchase rate. */
  async unitCost(tx: Tx, locationId: string, itemId: string): Promise<Dec> {
    const bal = await tx.stockBalance.findUnique({ where: { location_id_item_id: { location_id: locationId, item_id: itemId } } });
    if (bal && bal.avg_cost.greaterThan(0)) return bal.avg_cost;
    const item = await tx.inventoryItem.findUnique({ where: { id: itemId }, select: { avg_cost: true, last_purchase_rate: true } });
    if (item?.avg_cost?.greaterThan(0)) return item.avg_cost;
    return item?.last_purchase_rate ?? ZERO;
  }

  /** Append a ledger row and move the balance. Returns the balance after and the row's value. */
  async post(tx: Tx, ctx: ReqCtx, p: LedgerPost): Promise<{ balance: Dec; value: Dec; id: string }> {
    const value = round2(p.quantity.mul(p.unitCost));
    const balance = await this.moveStock(tx, p.locationId, p.itemId, p.quantity, value, p.unitCost);
    const row = await tx.inventoryTransaction.create({
      data: {
        location_id: p.locationId, item_id: p.itemId, business_date: p.date, txn_type: p.type, quantity: p.quantity, unit_cost: p.unitCost, value,
        balance_after: balance, source_type: p.sourceType, source_id: p.sourceId, counterparty_location_id: p.counterpartyLocationId ?? null,
        reversal_of_id: p.reversalOfId ?? null, created_by: ctx.user.id,
      },
    });
    return { balance, value, id: row.id };
  }
}
