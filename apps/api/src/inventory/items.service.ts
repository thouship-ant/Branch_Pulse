import { Injectable } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { D, Dec, parseQty } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';

const RATE_RE = /^\d{1,8}(\.\d{1,4})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,3})?$/;

export class CreateItemDto {
  @IsString() @MaxLength(80) nameEn: string;
  @IsOptional() @IsString() @MaxLength(80) nameTa?: string;
  @IsString() @MaxLength(30) category: string;
  @IsUUID() baseUnitId: string;
  @IsOptional() @IsUUID() purchaseUnitId?: string;
  @IsOptional() @IsBoolean() isPerishable?: boolean;
  @IsOptional() @IsBoolean() dailyCountRequired?: boolean;
  @IsOptional() @Matches(PCT_RE) varianceThresholdPct?: string; // a count differing by more than this % needs an explanation
  @IsOptional() @IsString() varianceThresholdQty?: string; // ... or by more than this quantity (base unit)
  @IsOptional() @Matches(RATE_RE) lastPurchaseRate?: string; // per base unit
}

export class UpdateItemDto {
  @IsOptional() @IsString() @MaxLength(80) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(80) nameTa?: string;
  @IsOptional() @IsString() @MaxLength(30) category?: string;
  @IsOptional() @IsUUID() purchaseUnitId?: string;
  @IsOptional() @IsBoolean() isPerishable?: boolean;
  @IsOptional() @IsBoolean() dailyCountRequired?: boolean;
  @IsOptional() varianceThresholdPct?: string | null;
  @IsOptional() varianceThresholdQty?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class LocationSettingDto {
  @IsString() minStock: string;
  @IsOptional() @IsBoolean() isStocked?: boolean;
}

export class ListItemsQuery {
  @IsOptional() @IsString() includeInactive?: string;
  @IsOptional() @IsString() q?: string;
}

/** Items to track: the tea-shop template ships milk, tea, coffee, sugar, ginger, cardamom, oil, snacks, cups, glasses, packaging, bottles and more; the owner adds the rest. */
@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(ctx: ReqCtx, q: ListItemsQuery) {
    const search = q.q?.trim().toLowerCase();
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [items, units, settings] = await Promise.all([
        tx.inventoryItem.findMany({ where: q.includeInactive === 'true' ? {} : { status: 'ACTIVE' }, orderBy: { code: 'asc' } }),
        tx.unit.findMany(),
        tx.itemLocationSetting.findMany(),
      ]);
      return items
        .filter((i) => !search || `${i.name_en} ${i.name_ta ?? ''} ${i.code} ${i.category}`.toLowerCase().includes(search))
        .map((i) => {
          const base = units.find((u) => u.id === i.base_unit_id);
          const purchase = units.find((u) => u.id === i.purchase_unit_id);
          return {
            ...i, base_unit: base?.code ?? '', purchase_unit: purchase?.code ?? base?.code ?? '',
            // the unit people read quantities in: the purchase unit when it converts to the base (litres for milk), else the base
            display_unit: purchase && (purchase.base_unit_id === i.base_unit_id || purchase.id === i.base_unit_id) ? purchase.code : base?.code ?? '',
            display_factor: purchase && (purchase.base_unit_id === i.base_unit_id || purchase.id === i.base_unit_id) ? purchase.factor_to_base : D(1),
            settings: settings.filter((s) => s.item_id === i.id).map((s) => ({ locationId: s.location_id, minStock: s.min_stock, isStocked: s.is_stocked })),
          };
        });
    });
  }

  private async nextCode(tx: Tx): Promise<string> {
    const all = await tx.inventoryItem.findMany({ select: { code: true } });
    const max = all.reduce((m, i) => Math.max(m, Number(/^ITM(\d+)$/.exec(i.code)?.[1] ?? 0)), 0);
    return `ITM${String(max + 1).padStart(3, '0')}`;
  }

  private async checkUnits(tx: Tx, baseUnitId: string, purchaseUnitId?: string) {
    const base = await tx.unit.findUnique({ where: { id: baseUnitId } });
    if (!base || base.base_unit_id) throw validation('INVALID_UNIT', 'The stock unit must be a base unit (ml, g, pcs)', 'baseUnitId');
    if (purchaseUnitId) {
      const p = await tx.unit.findUnique({ where: { id: purchaseUnitId } });
      if (!p || (p.id !== base.id && p.base_unit_id !== base.id)) throw validation('INVALID_UNIT', 'The purchase unit must convert to the stock unit', 'purchaseUnitId');
    }
  }

  private threshold(v: string | null | undefined, field: string, qty = false): Dec | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    return qty ? parseQty(v, field) : D(PCT_RE.test(v) ? v : (() => { throw validation('INVALID_AMOUNT', `${field}: enter a percentage`, field); })());
  }

  async create(ctx: ReqCtx, dto: CreateItemDto) {
    const name = dto.nameEn?.trim();
    if (!name) throw validation('NAME_REQUIRED', 'Enter the item name', 'nameEn');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      if (await tx.inventoryItem.findFirst({ where: { name_en: { equals: name, mode: 'insensitive' } } })) throw new AppException(409, 'DUPLICATE_ITEM', 'An item with this name already exists');
      await this.checkUnits(tx, dto.baseUnitId, dto.purchaseUnitId);
      const rate = dto.lastPurchaseRate ? D(dto.lastPurchaseRate) : null;
      const item = await tx.inventoryItem.create({
        data: {
          code: await this.nextCode(tx), name_en: name, name_ta: dto.nameTa?.trim() || null, category: dto.category.trim().toUpperCase().replace(/\s+/g, '_'),
          base_unit_id: dto.baseUnitId, purchase_unit_id: dto.purchaseUnitId ?? null, is_perishable: dto.isPerishable ?? false, daily_count_required: dto.dailyCountRequired ?? false,
          variance_threshold_pct: this.threshold(dto.varianceThresholdPct, 'varianceThresholdPct') ?? null,
          variance_threshold_qty: this.threshold(dto.varianceThresholdQty, 'varianceThresholdQty', true) ?? null,
          last_purchase_rate: rate, avg_cost: rate ?? D(0), created_by: ctx.user.id, updated_by: ctx.user.id,
        },
      });
      // stocked at every branch and warehouse by default; the owner can switch it off or set a minimum per location
      const locs = await tx.location.findMany({ where: { status: 'ACTIVE', type: { in: ['BRANCH', 'GODOWN'] } }, select: { id: true } });
      if (locs.length) await tx.itemLocationSetting.createMany({ data: locs.map((l) => ({ item_id: item.id, location_id: l.id })), skipDuplicates: true });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'INVENTORY_ITEM', entityId: item.id, entityCode: item.code, after: item });
      return item;
    });
  }

  async update(ctx: ReqCtx, id: string, dto: UpdateItemDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.inventoryItem.findUnique({ where: { id } });
      if (!before) throw notFound('Item');
      const name = dto.nameEn?.trim();
      if (name && name.toLowerCase() !== before.name_en.toLowerCase() && (await tx.inventoryItem.findFirst({ where: { name_en: { equals: name, mode: 'insensitive' }, NOT: { id } } }))) {
        throw new AppException(409, 'DUPLICATE_ITEM', 'An item with this name already exists');
      }
      if (dto.purchaseUnitId) await this.checkUnits(tx, before.base_unit_id, dto.purchaseUnitId);
      const after = await tx.inventoryItem.update({
        where: { id },
        data: {
          name_en: name || undefined, name_ta: dto.nameTa?.trim(), category: dto.category?.trim().toUpperCase().replace(/\s+/g, '_'), purchase_unit_id: dto.purchaseUnitId,
          is_perishable: dto.isPerishable, daily_count_required: dto.dailyCountRequired,
          variance_threshold_pct: this.threshold(dto.varianceThresholdPct, 'varianceThresholdPct'),
          variance_threshold_qty: this.threshold(dto.varianceThresholdQty, 'varianceThresholdQty', true),
          status: dto.active === undefined ? undefined : dto.active ? 'ACTIVE' : 'INACTIVE', updated_by: ctx.user.id, version: { increment: 1 },
        },
      });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'INVENTORY_ITEM', entityId: id, entityCode: after.code, before, after });
      return after;
    });
  }

  /** Minimum stock (and whether it is stocked at all) for one item at one location. */
  async setLocation(ctx: ReqCtx, itemId: string, locationId: string, dto: LocationSettingDto) {
    const min = parseQty(dto.minStock, 'minStock', { allowZero: true });
    return this.prisma.runScoped(ctx.user, async (tx) => {
      if (!(await tx.inventoryItem.findUnique({ where: { id: itemId } }))) throw notFound('Item');
      const loc = await tx.location.findUnique({ where: { id: locationId } });
      if (!loc) throw notFound('Location');
      const row = await tx.itemLocationSetting.upsert({
        where: { item_id_location_id: { item_id: itemId, location_id: locationId } },
        update: { min_stock: min, is_stocked: dto.isStocked ?? undefined },
        create: { item_id: itemId, location_id: locationId, min_stock: min, is_stocked: dto.isStocked ?? true },
      });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'ITEM_LOCATION_SETTING', entityId: itemId, locationId, after: row });
      return row;
    });
  }
}
