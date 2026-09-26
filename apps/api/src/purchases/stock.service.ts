import { Injectable } from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { validation } from '../common/app-exception';
import { ReqCtx } from '../common/auth-user';
import { toDate } from '../common/dates';
import { D } from '../common/money';
import { PrismaService } from '../common/prisma.service';
import { Envelope } from '../common/response';

export class StockQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() low?: string; // 'true' = only items at or below their minimum
}

export class StockMovementsQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) page?: number;
  @IsOptional() @Type(() => Number) pageSize?: number;
}

/** Stock on hand per location and item, and every movement behind it. Purchases add to it when they are approved. */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async levels(ctx: ReqCtx, q: StockQuery) {
    const search = q.q?.trim().toLowerCase();
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [balances, items, units, settings, locs] = await Promise.all([
        tx.stockBalance.findMany({ where: q.locationId ? { location_id: q.locationId } : {} }),
        tx.inventoryItem.findMany({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } }),
        tx.unit.findMany(),
        tx.itemLocationSetting.findMany({ where: q.locationId ? { location_id: q.locationId } : {} }),
        tx.location.findMany({ where: { status: 'ACTIVE', type: { in: ['BRANCH', 'GODOWN'] }, ...(q.locationId ? { id: q.locationId } : {}) }, orderBy: { code: 'asc' } }),
      ]);
      const rows = [];
      for (const l of locs) {
        for (const i of items) {
          if (search && !`${i.name_en} ${i.code} ${i.name_ta ?? ''}`.toLowerCase().includes(search)) continue;
          const b = balances.find((x) => x.location_id === l.id && x.item_id === i.id);
          const s = settings.find((x) => x.location_id === l.id && x.item_id === i.id);
          if (s && !s.is_stocked && !b) continue;
          const quantity = b?.quantity ?? D(0);
          const min = s?.min_stock ?? D(0);
          const low = min.greaterThan(0) && quantity.lessThanOrEqualTo(min);
          if (q.low === 'true' && !low) continue;
          rows.push({
            locationId: l.id, locationCode: l.code, locationName: l.name, locationNameTa: l.name_ta, locationType: l.type,
            itemId: i.id, itemCode: i.code, itemName: i.name_en, itemNameTa: i.name_ta, unit: units.find((u) => u.id === i.base_unit_id)?.code ?? '',
            quantity, avgCost: b?.avg_cost ?? D(0), value: b?.value ?? D(0), minStock: min, low, lastMovementAt: b?.last_txn_at ?? null,
          });
        }
      }
      return rows;
    });
  }

  async movements(ctx: ReqCtx, q: StockMovementsQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
    if (!q.locationId && !q.itemId) throw validation('FILTER_REQUIRED', 'Choose a location or an item', 'locationId');
    const where = {
      ...(q.locationId ? { location_id: q.locationId } : {}), ...(q.itemId ? { item_id: q.itemId } : {}),
      ...(q.from || q.to ? { business_date: { ...(q.from ? { gte: toDate(q.from, 'from') } : {}), ...(q.to ? { lte: toDate(q.to, 'to') } : {}) } } : {}),
    };
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.inventoryTransaction.findMany({ where, orderBy: [{ created_at: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.inventoryTransaction.count({ where }),
      ]);
      const [items, units, locs, purchases] = await Promise.all([
        tx.inventoryItem.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.item_id))] } } }),
        tx.unit.findMany(),
        tx.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.location_id))] } }, select: { id: true, code: true, name: true } }),
        tx.purchase.findMany({ where: { id: { in: rows.filter((r) => r.source_type.startsWith('PURCHASE')).map((r) => r.source_id) } }, select: { id: true, code: true } }),
      ]);
      const data = rows.map((r) => {
        const item = items.find((i) => i.id === r.item_id);
        return {
          ...r, item_code: item?.code, item_name: item?.name_en, item_name_ta: item?.name_ta,
          unit: units.find((u) => u.id === item?.base_unit_id)?.code, location_code: locs.find((l) => l.id === r.location_id)?.code,
          source_code: purchases.find((p) => p.id === r.source_id)?.code ?? null,
        };
      });
      return new Envelope(data, [], { page, pageSize, total });
    });
  }
}
