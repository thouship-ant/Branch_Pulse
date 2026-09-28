import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { addDays, fmtDate, toDate, todayIST } from '../common/dates';
import { D, Dec, parseMoney, parseQty, round2, ZERO } from '../common/money';
import { PrismaService, SYSTEM_SCOPE, Tx } from '../common/prisma.service';

export class RecipeItemDto {
  @IsUUID() itemId: string;
  @IsString() quantity: string;
  @IsUUID() unitId: string;
}

export class CreateRecipeDto {
  @IsString() @MaxLength(80) nameEn: string;
  @IsOptional() @IsString() @MaxLength(80) nameTa?: string;
  @IsString() yieldQty: string;
  @IsOptional() @IsString() sellingPrice?: string;
  @IsOptional() @IsString() effectiveFrom?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RecipeItemDto) items: RecipeItemDto[];
}

export class UpdateRecipeDto {
  @IsOptional() @IsString() @MaxLength(80) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(80) nameTa?: string;
  @IsOptional() @IsString() yieldQty?: string;
  @IsOptional() sellingPrice?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RecipeItemDto) items?: RecipeItemDto[];
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListRecipesQuery {
  @IsOptional() @IsString() includeInactive?: string;
}

export class CostTrendQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class RawMaterialTrendQuery {
  @IsUUID() itemId: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

interface CostLine {
  itemId: string; code?: string; name?: string; nameTa?: string | null;
  quantity: Dec; unitCode?: string; unitCost: Dec; lineCost: Dec;
}

/**
 * Recipes are management accounting only (LLD: "do not make this a billing feature") - they estimate what a
 * menu item costs to make, using today's purchase prices, so the owner can watch margins move without a POS.
 */
@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async nextCode(tx: Tx): Promise<string> {
    const all = await tx.recipe.findMany({ select: { code: true } });
    const max = all.reduce((m, r) => Math.max(m, Number(/^RCP(\d+)$/.exec(r.code)?.[1] ?? 0)), 0);
    return `RCP${String(max + 1).padStart(3, '0')}`;
  }

  /** What an item costs company-wide right now: the quantity-weighted average of what every location currently holds it at. */
  private async currentUnitCost(tx: Tx, itemId: string): Promise<Dec> {
    const balances = await tx.stockBalance.findMany({ where: { item_id: itemId, quantity: { gt: 0 } }, select: { quantity: true, avg_cost: true } });
    const totalQty = balances.reduce((s, b) => s.plus(b.quantity), ZERO);
    if (totalQty.greaterThan(0)) {
      const totalValue = balances.reduce((s, b) => s.plus(D(b.quantity).mul(b.avg_cost)), ZERO);
      return totalValue.div(totalQty).toDecimalPlaces(4);
    }
    const item = await tx.inventoryItem.findUnique({ where: { id: itemId }, select: { avg_cost: true, last_purchase_rate: true } });
    if (item?.avg_cost?.greaterThan(0)) return item.avg_cost;
    return item?.last_purchase_rate ?? ZERO;
  }

  private async checkUnit(tx: Tx, item: { base_unit_id: string }, unitId: string) {
    const unit = await tx.unit.findUnique({ where: { id: unitId } });
    if (!unit || (unit.id !== item.base_unit_id && unit.base_unit_id !== item.base_unit_id)) {
      throw validation('INVALID_UNIT', 'This unit does not match the item', 'unitId');
    }
    return unit;
  }

  private async resolveLines(tx: Tx, lines: RecipeItemDto[]) {
    const seen = new Set<string>();
    const out: Array<{ item_id: string; quantity: Dec; unit_id: string; base_quantity: Dec }> = [];
    for (const l of lines) {
      if (seen.has(l.itemId)) throw validation('DUPLICATE_ITEM', 'Each ingredient can appear only once', 'itemId');
      seen.add(l.itemId);
      const item = await tx.inventoryItem.findUnique({ where: { id: l.itemId } });
      if (!item || item.status !== 'ACTIVE') throw validation('INVALID_ITEM', 'Choose an active item', 'itemId');
      const qty = parseQty(l.quantity, 'quantity');
      if (qty.lessThanOrEqualTo(0)) throw validation('INVALID_QTY', 'Quantity must be greater than zero', 'quantity');
      const unit = await this.checkUnit(tx, item, l.unitId);
      out.push({ item_id: l.itemId, quantity: qty, unit_id: l.unitId, base_quantity: qty.mul(unit.factor_to_base).toDecimalPlaces(3) });
    }
    return out;
  }

  /** Ingredient-by-ingredient cost of one recipe at current purchase prices. */
  private async costOf(tx: Tx, recipeId: string) {
    const recipe = await tx.recipe.findUnique({ where: { id: recipeId }, include: { items: true } });
    if (!recipe) throw notFound('Recipe');
    const itemIds = recipe.items.map((i) => i.item_id);
    const [items, units] = await Promise.all([
      tx.inventoryItem.findMany({ where: { id: { in: itemIds } } }),
      tx.unit.findMany(),
    ]);
    let total = ZERO;
    const breakdown: CostLine[] = [];
    for (const line of recipe.items) {
      const item = items.find((i) => i.id === line.item_id);
      const unit = units.find((u) => u.id === line.unit_id);
      const cost = await this.currentUnitCost(tx, line.item_id);
      const lineCost = round2(D(line.base_quantity).mul(cost));
      total = total.plus(lineCost);
      breakdown.push({ itemId: line.item_id, code: item?.code, name: item?.name_en, nameTa: item?.name_ta, quantity: line.quantity, unitCode: unit?.code, unitCost: cost, lineCost });
    }
    const costPerUnit = recipe.yield_qty.greaterThan(0) ? total.div(recipe.yield_qty).toDecimalPlaces(4) : total;
    const marginPct = recipe.selling_price && recipe.selling_price.greaterThan(0)
      ? recipe.selling_price.minus(costPerUnit).div(recipe.selling_price).mul(100).toDecimalPlaces(1)
      : null;
    return { recipe, breakdown, totalCost: total, costPerUnit, marginPct };
  }

  /** Records today's cost as a point in the recipe's history. Called after every change, and once a day for every recipe. */
  private async snapshot(tx: Tx, recipeId: string) {
    const { recipe, breakdown, costPerUnit, marginPct } = await this.costOf(tx, recipeId);
    const stored = breakdown.map((b) => ({ ...b, quantity: b.quantity.toString(), unitCost: b.unitCost.toString(), lineCost: b.lineCost.toString() }));
    const date = toDate(todayIST());
    await tx.recipeCostSnapshot.upsert({
      where: { recipe_id_snapshot_date: { recipe_id: recipeId, snapshot_date: date } },
      update: { cost_per_unit: costPerUnit, selling_price: recipe.selling_price, gross_margin_pct: marginPct, breakdown: stored },
      create: { recipe_id: recipeId, snapshot_date: date, cost_per_unit: costPerUnit, selling_price: recipe.selling_price, gross_margin_pct: marginPct, breakdown: stored },
    });
  }

  // ------------------------------------------------------------ writes (owner only: recipe:manage)
  async create(ctx: ReqCtx, dto: CreateRecipeDto) {
    const name = dto.nameEn.trim();
    if (!name) throw validation('NAME_REQUIRED', 'Enter the recipe name', 'nameEn');
    const yieldQty = parseQty(dto.yieldQty, 'yieldQty');
    if (yieldQty.lessThanOrEqualTo(0)) throw validation('INVALID_QTY', 'Yield must be greater than zero', 'yieldQty');
    const sellingPrice = dto.sellingPrice ? parseMoney(dto.sellingPrice, 'sellingPrice', { allowZero: false }) : null;
    return this.prisma.runScoped(ctx.user, async (tx) => {
      if (await tx.recipe.findFirst({ where: { name_en: { equals: name, mode: 'insensitive' } } })) {
        throw new AppException(409, 'DUPLICATE_RECIPE', 'A recipe with this name already exists');
      }
      const items = await this.resolveLines(tx, dto.items);
      const recipe = await tx.recipe.create({
        data: {
          code: await this.nextCode(tx), name_en: name, name_ta: dto.nameTa?.trim() || null, yield_qty: yieldQty, selling_price: sellingPrice,
          effective_from: dto.effectiveFrom ? toDate(dto.effectiveFrom, 'effectiveFrom') : toDate(todayIST()),
          created_by: ctx.user.id, updated_by: ctx.user.id, items: { create: items },
        },
        include: { items: true },
      });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'RECIPE', entityId: recipe.id, entityCode: recipe.code, after: recipe });
      await this.snapshot(tx, recipe.id);
      return recipe;
    });
  }

  async update(ctx: ReqCtx, id: string, dto: UpdateRecipeDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.recipe.findUnique({ where: { id }, include: { items: true } });
      if (!before) throw notFound('Recipe');
      const name = dto.nameEn?.trim();
      if (name && name.toLowerCase() !== before.name_en.toLowerCase() && (await tx.recipe.findFirst({ where: { name_en: { equals: name, mode: 'insensitive' }, NOT: { id } } }))) {
        throw new AppException(409, 'DUPLICATE_RECIPE', 'A recipe with this name already exists');
      }
      const yieldQty = dto.yieldQty !== undefined ? parseQty(dto.yieldQty, 'yieldQty') : undefined;
      if (yieldQty && yieldQty.lessThanOrEqualTo(0)) throw validation('INVALID_QTY', 'Yield must be greater than zero', 'yieldQty');
      const sellingPrice = dto.sellingPrice === undefined ? undefined : dto.sellingPrice === null ? null : parseMoney(dto.sellingPrice, 'sellingPrice', { allowZero: false });
      if (dto.items) {
        const items = await this.resolveLines(tx, dto.items);
        await tx.recipeItem.deleteMany({ where: { recipe_id: id } });
        await tx.recipeItem.createMany({ data: items.map((i) => ({ ...i, recipe_id: id })) });
      }
      const after = await tx.recipe.update({
        where: { id },
        data: {
          name_en: name || undefined, name_ta: dto.nameTa?.trim(), yield_qty: yieldQty, selling_price: sellingPrice,
          status: dto.active === undefined ? undefined : dto.active ? 'ACTIVE' : 'INACTIVE',
          updated_by: ctx.user.id, version: { increment: 1 },
        },
        include: { items: true },
      });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'RECIPE', entityId: id, entityCode: after.code, before, after });
      if (dto.items || sellingPrice !== undefined) await this.snapshot(tx, id);
      return after;
    });
  }

  // ------------------------------------------------------------ reads (recipe:view)
  async list(ctx: ReqCtx, q: ListRecipesQuery) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const recipes = await tx.recipe.findMany({ where: q.includeInactive === 'true' ? {} : { status: 'ACTIVE' }, orderBy: { code: 'asc' } });
      return Promise.all(recipes.map(async (r) => {
        const { breakdown, totalCost, costPerUnit, marginPct } = await this.costOf(tx, r.id);
        return { ...r, ingredientCount: breakdown.length, totalCost, costPerUnit, marginPct };
      }));
    });
  }

  async get(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const { recipe, breakdown, totalCost, costPerUnit, marginPct } = await this.costOf(tx, id);
      return { ...recipe, breakdown, totalCost, costPerUnit, marginPct };
    });
  }

  /** Cost history for one recipe: how its estimated cost has moved, and by how much since the start of the range. */
  async costTrend(ctx: ReqCtx, id: string, q: CostTrendQuery) {
    const to = q.to ? toDate(q.to, 'to') : toDate(todayIST());
    const from = q.from ? toDate(q.from, 'from') : addDays(to, -89);
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const recipe = await tx.recipe.findUnique({ where: { id } });
      if (!recipe) throw notFound('Recipe');
      const rows = await tx.recipeCostSnapshot.findMany({ where: { recipe_id: id, snapshot_date: { gte: from, lte: to } }, orderBy: { snapshot_date: 'asc' } });
      const first = rows[0], last = rows[rows.length - 1];
      const changePct = first && last && first.cost_per_unit.greaterThan(0)
        ? last.cost_per_unit.minus(first.cost_per_unit).div(first.cost_per_unit).mul(100).toDecimalPlaces(1) : null;
      return {
        recipeId: id, code: recipe.code, name: recipe.name_en, from: fmtDate(from), to: fmtDate(to),
        points: rows.map((r) => ({ date: fmtDate(r.snapshot_date), costPerUnit: r.cost_per_unit, sellingPrice: r.selling_price, marginPct: r.gross_margin_pct })),
        change: first && last ? { from: first.cost_per_unit, to: last.cost_per_unit, changePct } : null,
      };
    });
  }

  /** Raw material cost over time: the actual purchase rate paid for one item, wherever it was bought, across the range. */
  async rawMaterialTrend(ctx: ReqCtx, q: RawMaterialTrendQuery) {
    const to = q.to ? toDate(q.to, 'to') : toDate(todayIST());
    const from = q.from ? toDate(q.from, 'from') : addDays(to, -89);
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: q.itemId } });
      if (!item) throw notFound('Item');
      const rows = await tx.inventoryTransaction.findMany({
        where: { item_id: q.itemId, txn_type: 'PURCHASE_IN', business_date: { gte: from, lte: to } },
        orderBy: [{ business_date: 'asc' }, { created_at: 'asc' }],
        select: { business_date: true, unit_cost: true },
      });
      const byDay = new Map<string, Dec>();
      for (const r of rows) byDay.set(fmtDate(r.business_date), r.unit_cost); // the last purchase of the day wins
      const points = [...byDay.entries()].map(([date, unitCost]) => ({ date, unitCost }));
      const first = points[0], last = points[points.length - 1];
      const changePct = first && last && D(first.unitCost).greaterThan(0)
        ? D(last.unitCost).minus(first.unitCost).div(first.unitCost).mul(100).toDecimalPlaces(1) : null;
      return {
        itemId: item.id, code: item.code, name: item.name_en, nameTa: item.name_ta, from: fmtDate(from), to: fmtDate(to), points,
        change: first && last ? { from: first.unitCost, to: last.unitCost, changePct } : null,
      };
    });
  }

  // ------------------------------------------------------------ scheduled snapshot
  /** 00:15 IST: snapshot every active recipe's cost, so "cost over time" and "cost increase" have real history to show. */
  @Cron('15 0 * * *', { timeZone: 'Asia/Kolkata' })
  async snapshotAll() {
    await this.prisma.runScoped(SYSTEM_SCOPE, async (tx) => {
      const recipes = await tx.recipe.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      for (const r of recipes) await this.snapshot(tx, r.id);
    });
  }
}
