import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { D, Dec, parseQty, round2, sum, ZERO } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { RulesService } from '../common/rules.service';
import { SettingsService } from '../common/settings.service';
import { DayFlow, dayFlows, emptyFlow } from './flows';
import { LedgerService } from './ledger.service';

export const COUNT_REASONS = ['MEASUREMENT', 'SPILLAGE', 'UNRECORDED_USE', 'UNRECORDED_WASTAGE', 'SUPPLIER_SHORT', 'THEFT_SUSPECTED', 'COUNTING_ERROR', 'OTHER'];

export class ConsumptionLineDto {
  @IsUUID() itemId: string;
  @IsString() quantity: string; // total used that day, in the item's stock unit
}
export class SetConsumptionDto {
  @IsUUID() locationId: string;
  @IsString() businessDate: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ConsumptionLineDto) items: ConsumptionLineDto[];
}

export class CountLineDto {
  @IsUUID() itemId: string;
  @IsString() physicalQty: string; // in the item's stock unit
  @IsOptional() @IsIn(COUNT_REASONS) reason?: string;
  @IsOptional() @IsString() @MaxLength(500) explanation?: string;
}
export class SaveCountDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CountLineDto) items: CountLineDto[];
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}
export class ReviewCountDto {
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class ReconciliationQuery {
  @IsUUID() locationId: string;
  @IsOptional() @IsString() date?: string;
}
export class ListCountsQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}
export class VarianceReportQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(['all', 'shortage', 'excess']) type?: 'all' | 'shortage' | 'excess';
  @IsOptional() @IsString() status?: string;
}

export type VarianceLabel = 'SHORTAGE' | 'EXCESS' | 'TALLIED';
export const stockVarianceLabel = (v: Dec): VarianceLabel => (v.isZero() ? 'TALLIED' : v.isNegative() ? 'SHORTAGE' : 'EXCESS');

/**
 * A count line is "significant" (needs a reason and an explanation) when it differs from the books by more than the item's
 * threshold: its own quantity limit, else its own percentage, else the shop-wide default percentage.
 */
export function isSignificantVariance(variance: Dec, expected: Dec, item: { pct: Dec | null; qty: Dec | null }, defaultPct: Dec): boolean {
  if (variance.isZero()) return false;
  if (item.qty) return variance.abs().greaterThan(item.qty);
  if (expected.lessThanOrEqualTo(0)) return true;
  return variance.abs().div(expected).mul(100).greaterThan(item.pct ?? defaultPct);
}

type Row = RowBase & DayFlow;
interface RowBase {
  itemId: string;
  code: string;
  name: string;
  nameTa: string | null;
  category: string;
  unit: string;
  displayUnit: string;
  displayFactor: Dec;
  dailyCountRequired: boolean;
  minStock: Dec;
  avgCost: Dec;
  physical: Dec | null;
  variance: Dec | null;
  varianceValue: Dec | null;
  label: VarianceLabel | null;
  reason: string | null;
  explanation: string | null;
  isSignificant: boolean;
}

/**
 * Daily stock reconciliation per location: for every item, opening + purchases + transfers in - transfers out - consumption - wastage =
 * expected closing, compared with the physical count to give a shortage or an excess. Books come from the inventory ledger only.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
  ) {}

  private async checkLocation(tx: Tx, locationId: string) {
    const loc = await tx.location.findUnique({ where: { id: locationId } });
    if (!loc || loc.status !== 'ACTIVE') throw notFound('Location');
    if (loc.type === 'CENTRAL_OFFICE') throw validation('INVALID_LOCATION', 'Stock is kept at a branch or the central warehouse', 'locationId');
    return loc;
  }

  private async stockedItems(tx: Tx, locationId: string, flows: Map<string, DayFlow>) {
    const [items, settings] = await Promise.all([
      tx.inventoryItem.findMany({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } }),
      tx.itemLocationSetting.findMany({ where: { location_id: locationId } }),
    ]);
    return items
      .filter((i) => {
        const s = settings.find((x) => x.item_id === i.id);
        return !s || s.is_stocked || flows.has(i.id);
      })
      .map((i) => ({ item: i, min: settings.find((x) => x.item_id === i.id)?.min_stock ?? ZERO }));
  }

  // ------------------------------------------------------------ the day
  async reconciliation(ctx: ReqCtx, locationId: string, dateStr?: string) {
    const date = toDate(dateStr ?? todayIST(), 'date');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await this.checkLocation(tx, locationId);
      const flows = await dayFlows(tx, locationId, date);
      const stocked = await this.stockedItems(tx, locationId, flows);
      const [units, balances, count] = await Promise.all([
        tx.unit.findMany(),
        tx.stockBalance.findMany({ where: { location_id: locationId } }),
        tx.stockCount.findFirst({ where: { location_id: locationId, business_date: date, count_type: 'CLOSING' }, include: { items: true } }),
      ]);
      const users = count ? await tx.user.findMany({ where: { id: { in: [count.counted_by, count.approved_by].filter((x): x is string => !!x) } }, select: { id: true, full_name: true } }) : [];

      const rows: Row[] = stocked.map(({ item, min }) => {
        const f = flows.get(item.id) ?? emptyFlow();
        const base = units.find((u) => u.id === item.base_unit_id);
        const pu = units.find((u) => u.id === item.purchase_unit_id);
        const convertible = pu && (pu.id === item.base_unit_id || pu.base_unit_id === item.base_unit_id);
        const avg = balances.find((b) => b.item_id === item.id)?.avg_cost;
        const cost = avg && avg.greaterThan(0) ? avg : item.avg_cost;
        const ci = count?.items.find((c) => c.item_id === item.id);
        // a submitted or approved count keeps the figures it was counted against; a draft is re-measured against today's books
        const frozen = !!ci && !!count && count.status !== 'IN_PROGRESS' && count.status !== 'REJECTED';
        const expected = frozen ? ci!.expected_qty : f.expected;
        const variance = ci ? (frozen ? ci.variance_qty : ci.physical_qty.minus(f.expected)) : null;
        return {
          itemId: item.id, code: item.code, name: item.name_en, nameTa: item.name_ta, category: item.category, unit: base?.code ?? '',
          displayUnit: convertible ? pu!.code : base?.code ?? '', displayFactor: convertible ? pu!.factor_to_base : D(1),
          dailyCountRequired: item.daily_count_required, minStock: min, avgCost: cost, ...f, expected,
          physical: ci?.physical_qty ?? null, variance, varianceValue: variance ? round2(variance.mul(cost)) : null,
          label: variance ? stockVarianceLabel(variance) : null, reason: ci?.reason ?? null, explanation: ci?.explanation ?? null, isSignificant: ci?.is_significant ?? false,
        };
      });

      const valued = (pick: (r: Row) => Dec | null) => sum(rows.map((r) => (pick(r) ?? ZERO).mul(r.avgCost)));
      const varianceRows = rows.filter((r) => r.variance && !r.variance.isZero());
      return {
        locationId, locationCode: loc.code, locationName: loc.name, locationNameTa: loc.name_ta, date: fmtDate(date),
        count: count ? {
          id: count.id, status: count.status, version: count.version, remarks: count.remarks, reviewComment: count.review_comment,
          countedBy: users.find((u) => u.id === count.counted_by)?.full_name ?? null, approvedBy: users.find((u) => u.id === count.approved_by)?.full_name ?? null, approvedAt: count.approved_at,
        } : null,
        rows,
        totals: {
          itemsCounted: rows.filter((r) => r.physical !== null).length, itemsTotal: rows.length,
          expectedValue: round2(valued((r) => r.expected)), physicalValue: round2(valued((r) => r.physical)),
          shortageValue: round2(sum(varianceRows.filter((r) => r.variance!.isNegative()).map((r) => r.varianceValue))).abs(),
          excessValue: round2(sum(varianceRows.filter((r) => !r.variance!.isNegative()).map((r) => r.varianceValue))),
          wastageValue: round2(valued((r) => r.wastage)), consumptionValue: round2(valued((r) => r.consumption)),
          shortages: varianceRows.filter((r) => r.variance!.isNegative()).length, excesses: varianceRows.filter((r) => !r.variance!.isNegative()).length,
        },
      };
    });
  }

  // ------------------------------------------------------------ consumption
  /**
   * Set what was used that day, per item (in the stock unit). The ledger is append-only, so a change posts the difference:
   * more use = another CONSUMPTION row, less use = a positive one. The reconciliation always shows the net.
   */
  async setConsumption(ctx: ReqCtx, dto: SetConsumptionDto) {
    const date = await this.rules.assertBusinessDate(ctx.user, dto.businessDate);
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw validation('ITEMS_REQUIRED', 'Enter the quantity used for at least one item', 'items');
    const targets = dto.items.map((l, i) => ({ itemId: l.itemId, qty: parseQty(l.quantity, `items.${i}.quantity`, { allowZero: true }) }));
    return this.prisma.runScoped(ctx.user, async (tx) => {
      await this.checkLocation(tx, dto.locationId);
      await this.rules.assertDayEditable(tx, ctx.user, dto.locationId, date);
      await this.assertNoApprovedCount(tx, dto.locationId, date);
      const items = await tx.inventoryItem.findMany({ where: { id: { in: targets.map((t) => t.itemId) }, status: 'ACTIVE' } });
      const flows = await dayFlows(tx, dto.locationId, date, targets.map((t) => t.itemId));
      const warnings: Array<{ code: string; message: string; field?: string }> = [];
      const changed: Array<{ itemId: string; delta: Dec }> = [];
      for (const [i, t] of targets.entries()) {
        const item = items.find((x) => x.id === t.itemId);
        if (!item) throw validation('INVALID_ITEM', 'Choose active items', `items.${i}.itemId`);
        const current = flows.get(t.itemId)?.consumption ?? ZERO;
        const delta = t.qty.minus(current); // + = used more than recorded
        if (delta.isZero()) continue;
        const cost = await this.ledger.unitCost(tx, dto.locationId, t.itemId);
        const { balance } = await this.ledger.post(tx, ctx, {
          locationId: dto.locationId, itemId: t.itemId, date, type: 'CONSUMPTION', quantity: delta.neg(), unitCost: cost, sourceType: 'CONSUMPTION_ENTRY', sourceId: randomUUID(),
        });
        if (balance.isNegative()) warnings.push({ code: 'NEGATIVE_STOCK', field: `items.${i}.quantity`, message: `${item.name_en}: more was used than the books show in stock` });
        changed.push({ itemId: t.itemId, delta });
      }
      if (changed.length) {
        await this.audit.log(tx, ctx, {
          action: 'UPDATE', entityType: 'STOCK_CONSUMPTION', entityId: dto.locationId, locationId: dto.locationId,
          after: { date: fmtDate(date), lines: changed.map((c) => ({ item_id: c.itemId, change: c.delta.toString() })) },
        });
      }
      return { businessDate: fmtDate(date), changed: changed.length, warnings };
    });
  }

  private async assertNoApprovedCount(tx: Tx, locationId: string, date: Date) {
    const c = await tx.stockCount.findFirst({ where: { location_id: locationId, business_date: date, count_type: 'CLOSING', status: 'APPROVED' } });
    if (c) throw new AppException(409, 'COUNT_APPROVED', 'This day\'s stock count is approved; the figures can no longer change');
  }

  // ------------------------------------------------------------ physical count
  async saveCount(ctx: ReqCtx, locationId: string, dateStr: string, dto: SaveCountDto) {
    const date = await this.rules.assertBusinessDate(ctx.user, dateStr, 'date');
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw validation('ITEMS_REQUIRED', 'Count at least one item', 'items');
    const lines = dto.items.map((l, i) => ({ ...l, qty: parseQty(l.physicalQty, `items.${i}.physicalQty`, { allowZero: true }) }));
    if (new Set(lines.map((l) => l.itemId)).size !== lines.length) throw validation('DUPLICATE_ITEM', 'An item appears twice', 'items');
    const defaultPct = D(await this.settings.getNumber('stock.variance_pct_default'));

    return this.prisma.runScoped(ctx.user, async (tx) => {
      await this.checkLocation(tx, locationId);
      await this.rules.assertDayEditable(tx, ctx.user, locationId, date);
      const existing = await tx.stockCount.findFirst({ where: { location_id: locationId, business_date: date, count_type: 'CLOSING' } });
      if (existing?.status === 'APPROVED') throw new AppException(409, 'COUNT_APPROVED', 'This day\'s stock count is already approved');
      if (existing?.status === 'SUBMITTED') throw new AppException(409, 'COUNT_SUBMITTED', 'This count is waiting for approval; it cannot be changed');

      const items = await tx.inventoryItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) }, status: 'ACTIVE' } });
      const flows = await dayFlows(tx, locationId, date, lines.map((l) => l.itemId));
      const built = [];
      for (const [i, l] of lines.entries()) {
        const item = items.find((x) => x.id === l.itemId);
        if (!item) throw validation('INVALID_ITEM', 'Choose active items', `items.${i}.itemId`);
        const expected = flows.get(l.itemId)?.expected ?? ZERO;
        const variance = l.qty.minus(expected);
        const cost = await this.ledger.unitCost(tx, locationId, l.itemId);
        built.push({
          item_id: l.itemId, expected_qty: expected, physical_qty: l.qty, variance_qty: variance, variance_value: round2(variance.mul(cost)),
          is_significant: isSignificantVariance(variance, expected, { pct: item.variance_threshold_pct, qty: item.variance_threshold_qty }, defaultPct),
          reason: variance.isZero() ? null : l.reason ?? null, explanation: variance.isZero() ? null : l.explanation?.trim() || null,
        });
      }
      const count = existing
        ? await tx.stockCount.update({ where: { id: existing.id }, data: { status: 'IN_PROGRESS', remarks: dto.remarks?.trim() ?? existing.remarks, counted_by: ctx.user.id, updated_by: ctx.user.id, version: { increment: 1 } } })
        : await tx.stockCount.create({ data: { location_id: locationId, business_date: date, count_type: 'CLOSING', status: 'IN_PROGRESS', remarks: dto.remarks?.trim() || null, counted_by: ctx.user.id, created_by: ctx.user.id, updated_by: ctx.user.id } });
      await tx.stockCountItem.deleteMany({ where: { stock_count_id: count.id } });
      await tx.stockCountItem.createMany({ data: built.map((b) => ({ ...b, stock_count_id: count.id })) });
      await this.audit.log(tx, ctx, { action: existing ? 'UPDATE' : 'CREATE', entityType: 'STOCK_COUNT', entityId: count.id, locationId, after: { date: fmtDate(date), items: built.length } });
      return { id: count.id, status: count.status, items: built.length, significant: built.filter((b) => b.is_significant).length };
    });
  }

  /** Send the count in. Small differences are accepted straight away; significant ones (or a missing reason) wait for the owner. */
  async submitCount(ctx: ReqCtx, locationId: string, dateStr: string) {
    const date = toDate(dateStr, 'date');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const count = await tx.stockCount.findFirst({ where: { location_id: locationId, business_date: date, count_type: 'CLOSING' }, include: { items: true } });
      if (!count || count.items.length === 0) throw new AppException(409, 'NO_COUNT', 'Save the count first');
      if (count.status === 'SUBMITTED' || count.status === 'APPROVED') throw new AppException(409, 'INVALID_TRANSITION', `This count is already ${count.status.toLowerCase()}`);

      // every item that must be counted daily has to be in
      const required = await tx.inventoryItem.findMany({ where: { status: 'ACTIVE', daily_count_required: true }, select: { id: true, name_en: true } });
      const settings = await tx.itemLocationSetting.findMany({ where: { location_id: locationId, is_stocked: false } });
      const missing = required.filter((r) => !settings.some((s) => s.item_id === r.id) && !count.items.some((c) => c.item_id === r.id));
      if (missing.length) throw new AppException(422, 'COUNT_INCOMPLETE', 'Count these items too', missing.map((m) => ({ code: 'MISSING', message: m.name_en })));

      const weak = count.items.filter((c) => c.is_significant && (!c.reason || (c.explanation?.trim().length ?? 0) < 10));
      if (weak.length) {
        const names = await tx.inventoryItem.findMany({ where: { id: { in: weak.map((w) => w.item_id) } }, select: { id: true, name_en: true } });
        throw new AppException(422, 'VARIANCE_REASON_REQUIRED', 'Give a reason and an explanation (at least 10 characters) for each significant difference',
          weak.map((w) => ({ code: 'REASON', message: names.find((n) => n.id === w.item_id)?.name_en ?? '' })));
      }
      const needsApproval = count.items.some((c) => c.is_significant);
      const canApprove = ctx.user.permissions.includes('count:approve');
      if (needsApproval && !canApprove) {
        await tx.stockCount.update({ where: { id: count.id }, data: { status: 'SUBMITTED', counted_by: ctx.user.id, updated_by: ctx.user.id, version: { increment: 1 } } });
        await this.audit.log(tx, ctx, { action: 'STATUS_CHANGE', entityType: 'STOCK_COUNT', entityId: count.id, locationId, before: { status: count.status }, after: { status: 'SUBMITTED' } });
        return { id: count.id, status: 'SUBMITTED' as const };
      }
      await this.approveInternal(tx, ctx, count.id);
      return { id: count.id, status: 'APPROVED' as const };
    });
  }

  async approveCount(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const c = await tx.stockCount.findUnique({ where: { id } });
      if (!c) throw notFound('Stock count');
      if (c.status !== 'SUBMITTED') throw new AppException(409, 'INVALID_TRANSITION', `Cannot approve a count that is ${c.status.toLowerCase()}`);
      await this.approveInternal(tx, ctx, id);
      return { id, status: 'APPROVED' as const };
    });
  }

  async rejectCount(ctx: ReqCtx, id: string, dto: ReviewCountDto) {
    if (!dto.comment?.trim()) throw validation('COMMENT_REQUIRED', 'Say what needs to be re-counted', 'comment');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const c = await tx.stockCount.findUnique({ where: { id } });
      if (!c) throw notFound('Stock count');
      if (c.status !== 'SUBMITTED') throw new AppException(409, 'INVALID_TRANSITION', `Cannot reject a count that is ${c.status.toLowerCase()}`);
      await tx.stockCount.update({ where: { id }, data: { status: 'REJECTED', review_comment: dto.comment, approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'REJECT', entityType: 'STOCK_COUNT', entityId: id, locationId: c.location_id, before: { status: c.status }, after: { status: 'REJECTED' }, reason: dto.comment });
      return { id, status: 'REJECTED' as const };
    });
  }

  /** Accept a count: the books are corrected to what was physically there (a COUNT_ADJUSTMENT per differing item). */
  private async approveInternal(tx: Tx, ctx: ReqCtx, id: string) {
    const count = await tx.stockCount.findUniqueOrThrow({ where: { id }, include: { items: true } });
    const flows = await dayFlows(tx, count.location_id, count.business_date, count.items.map((i) => i.item_id));
    for (const ci of count.items) {
      const expectedNow = flows.get(ci.item_id)?.expected ?? ZERO; // books may have moved since the count was saved
      const variance = ci.physical_qty.minus(expectedNow);
      const cost = await this.ledger.unitCost(tx, count.location_id, ci.item_id);
      await tx.stockCountItem.update({ where: { id: ci.id }, data: { expected_qty: expectedNow, variance_qty: variance, variance_value: round2(variance.mul(cost)) } });
      if (!variance.isZero()) {
        await this.ledger.post(tx, ctx, {
          locationId: count.location_id, itemId: ci.item_id, date: count.business_date, type: 'COUNT_ADJUSTMENT', quantity: variance, unitCost: cost, sourceType: 'STOCK_COUNT', sourceId: count.id,
        });
      }
    }
    await tx.stockBalance.updateMany({ where: { location_id: count.location_id, item_id: { in: count.items.map((i) => i.item_id) } }, data: { last_counted_on: count.business_date } });
    const after = await tx.stockCount.update({ where: { id }, data: { status: 'APPROVED', approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } } });
    await this.audit.log(tx, ctx, { action: 'APPROVE', entityType: 'STOCK_COUNT', entityId: id, locationId: count.location_id, before: { status: count.status }, after: { status: after.status } });
  }

  async listCounts(ctx: ReqCtx, q: ListCountsQuery) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const rows = await tx.stockCount.findMany({
        where: {
          ...(q.locationId ? { location_id: q.locationId } : {}), ...(q.status ? { status: q.status as any } : {}),
          ...(q.from || q.to ? { business_date: { ...(q.from ? { gte: toDate(q.from, 'from') } : {}), ...(q.to ? { lte: toDate(q.to, 'to') } : {}) } } : {}),
        },
        include: { items: true }, orderBy: [{ business_date: 'desc' }, { created_at: 'desc' }], take: 100,
      });
      const locs = await tx.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.location_id))] } }, select: { id: true, code: true, name: true, name_ta: true } });
      const users = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.counted_by).filter((x): x is string => !!x))] } }, select: { id: true, full_name: true } });
      return rows.map((r) => ({
        id: r.id, locationId: r.location_id, locationCode: locs.find((l) => l.id === r.location_id)?.code, locationName: locs.find((l) => l.id === r.location_id)?.name,
        locationNameTa: locs.find((l) => l.id === r.location_id)?.name_ta, businessDate: r.business_date, status: r.status, countedBy: users.find((u) => u.id === r.counted_by)?.full_name ?? null,
        items: r.items.length, significant: r.items.filter((i) => i.is_significant).length,
        shortageValue: sum(r.items.filter((i) => i.variance_qty.isNegative()).map((i) => i.variance_value ?? ZERO)).abs(),
        excessValue: sum(r.items.filter((i) => !i.variance_qty.isNegative() && !i.variance_qty.isZero()).map((i) => i.variance_value ?? ZERO)),
      }));
    });
  }

  // ------------------------------------------------------------ variance report
  /** Shortage, excess and wastage in a period: every counted difference with its reason, the totals, and the split by item and location. */
  async varianceReport(ctx: ReqCtx, q: VarianceReportQuery) {
    const to = q.to ? toDate(q.to, 'to') : toDate(todayIST());
    const from = q.from ? toDate(q.from, 'from') : addDays(to, -29);
    if (from.getTime() > to.getTime()) throw validation('INVALID_RANGE', 'from must be on or before to', 'from');
    if ((to.getTime() - from.getTime()) / 86_400_000 > 400) throw validation('INVALID_RANGE', 'Choose a range of at most 400 days', 'to');
    const status = q.status ?? '';
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const counts = await tx.stockCount.findMany({
        where: { business_date: { gte: from, lte: to }, status: status ? (status as any) : { in: ['SUBMITTED', 'APPROVED'] }, ...(q.locationId ? { location_id: q.locationId } : {}) },
        include: { items: q.itemId ? { where: { item_id: q.itemId } } : true },
      });
      const wast = await tx.wastage.groupBy({
        by: ['item_id', 'location_id'], where: { business_date: { gte: from, lte: to }, status: 'ACTIVE', approval_status: { in: ['SUBMITTED', 'APPROVED'] }, ...(q.locationId ? { location_id: q.locationId } : {}), ...(q.itemId ? { item_id: q.itemId } : {}) },
        _sum: { estimated_value: true, base_quantity: true },
      });
      const [items, locs, units, users] = await Promise.all([
        tx.inventoryItem.findMany({ select: { id: true, code: true, name_en: true, name_ta: true, base_unit_id: true } }),
        tx.location.findMany({ select: { id: true, code: true, name: true, name_ta: true } }),
        tx.unit.findMany(),
        tx.user.findMany({ where: { id: { in: [...new Set(counts.flatMap((c) => [c.counted_by, c.approved_by]).filter((x): x is string => !!x))] } }, select: { id: true, full_name: true } }),
      ]);
      const item = (id: string) => items.find((i) => i.id === id);
      const loc = (id: string) => locs.find((l) => l.id === id);
      const rows = counts
        .flatMap((c) => c.items.filter((i) => !i.variance_qty.isZero()).map((i) => ({ c, i })))
        .filter(({ i }) => q.type === 'shortage' ? i.variance_qty.isNegative() : q.type === 'excess' ? !i.variance_qty.isNegative() : true)
        .map(({ c, i }) => ({
          id: i.id, countId: c.id, businessDate: c.business_date, locationId: c.location_id, locationCode: loc(c.location_id)?.code, locationName: loc(c.location_id)?.name, locationNameTa: loc(c.location_id)?.name_ta,
          itemId: i.item_id, itemCode: item(i.item_id)?.code, itemName: item(i.item_id)?.name_en, itemNameTa: item(i.item_id)?.name_ta,
          unit: units.find((u) => u.id === item(i.item_id)?.base_unit_id)?.code, expected: i.expected_qty, physical: i.physical_qty, variance: i.variance_qty, varianceValue: i.variance_value ?? ZERO,
          label: stockVarianceLabel(i.variance_qty), reason: i.reason, explanation: i.explanation, isSignificant: i.is_significant, status: c.status,
          countedBy: users.find((u) => u.id === c.counted_by)?.full_name ?? null, approvedBy: users.find((u) => u.id === c.approved_by)?.full_name ?? null,
        }))
        .sort((a, b) => b.businessDate.getTime() - a.businessDate.getTime() || a.itemName!.localeCompare(b.itemName!));

      const short = rows.filter((r) => r.variance.isNegative());
      const excess = rows.filter((r) => !r.variance.isNegative());
      const group = <K extends string>(key: (r: (typeof rows)[number]) => string, meta: (id: string) => Record<K, unknown>) => {
        const m = new Map<string, { shortage: Dec; excess: Dec; count: number }>();
        for (const r of rows) {
          const g = m.get(key(r)) ?? { shortage: ZERO, excess: ZERO, count: 0 };
          if (r.variance.isNegative()) g.shortage = g.shortage.plus(r.varianceValue.abs()); else g.excess = g.excess.plus(r.varianceValue);
          g.count += 1; m.set(key(r), g);
        }
        return [...m.entries()].map(([id, g]) => ({ id, ...meta(id), shortageValue: g.shortage, excessValue: g.excess, net: g.excess.minus(g.shortage), count: g.count })).sort((a, b) => b.shortageValue.comparedTo(a.shortageValue));
      };
      const wastageValue = sum(wast.map((w) => D(w._sum.estimated_value ?? 0)));
      return {
        from: fmtDate(from), to: fmtDate(to),
        summary: {
          countDays: counts.length, shortageCount: short.length, excessCount: excess.length,
          shortageValue: sum(short.map((r) => r.varianceValue)).abs(), excessValue: sum(excess.map((r) => r.varianceValue)),
          net: sum(rows.map((r) => r.varianceValue)), wastageValue,
          byStatus: { submitted: counts.filter((c) => c.status === 'SUBMITTED').length, approved: counts.filter((c) => c.status === 'APPROVED').length },
        },
        byItem: group((r) => r.itemId, (id) => ({ code: item(id)?.code, name: item(id)?.name_en, nameTa: item(id)?.name_ta })),
        byLocation: group((r) => r.locationId, (id) => ({ code: loc(id)?.code, name: loc(id)?.name, nameTa: loc(id)?.name_ta })),
        wastageByItem: [...wast.reduce((m, w) => { m.set(w.item_id, (m.get(w.item_id) ?? ZERO).plus(D(w._sum.estimated_value ?? 0))); return m; }, new Map<string, Dec>()).entries()]
          .map(([id, value]) => ({ itemId: id, code: item(id)?.code, name: item(id)?.name_en, nameTa: item(id)?.name_ta, value }))
          .sort((a, b) => b.value.comparedTo(a.value)),
        rows,
      };
    });
  }
}
