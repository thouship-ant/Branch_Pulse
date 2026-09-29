import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AppException, notFound, staleVersion, validation } from '../common/app-exception';
import { AttachmentsService } from '../attachments/attachments.service';
import { AuditService } from '../common/audit.service';
import { can, isOwner, ReqCtx } from '../common/auth-user';
import { addDays, toDate, todayIST } from '../common/dates';
import { CodesService } from '../common/codes.service';
import { D, MONEY_PATTERN, parseMoney } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { Envelope } from '../common/response';
import { RulesService } from '../common/rules.service';
import { SettingsService } from '../common/settings.service';

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT'];

export class CreateExpenseDto {
  @IsUUID() locationId: string;
  @IsString() businessDate: string;
  @IsUUID() categoryId: string;
  @IsOptional() @IsUUID() subCategoryId?: string;
  @Matches(MONEY_PATTERN) amount: string;
  @IsEnum(PAYMENT_MODES) paymentMode: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(100) payeeName?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() periodFrom?: string;
  @IsOptional() @IsString() periodTo?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attachmentKeys?: string[];
  @IsOptional() @IsUUID() clientUuid?: string;
  @IsOptional() @IsString() clientCreatedAt?: string;
}

export class UpdateExpenseDto {
  @IsInt() version: number;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() subCategoryId?: string;
  @IsOptional() @Matches(MONEY_PATTERN) amount?: string;
  @IsOptional() @IsEnum(PAYMENT_MODES) paymentMode?: string;
  @IsOptional() @IsString() @MaxLength(100) payeeName?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class ExpenseActionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ListExpensesQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() status?: string; // approval status
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() subCategoryId?: string;
  @IsOptional() @IsEnum(PAYMENT_MODES) paymentMode?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string; // matches payee, description or code
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

type Warning = { code: string; message: string; field?: string };

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly settings: SettingsService,
    private readonly codes: CodesService,
    private readonly attachments: AttachmentsService,
  ) {}

  // ------------------------------------------------------------ create
  async create(ctx: ReqCtx, dto: CreateExpenseDto): Promise<Envelope<unknown>> {
    const date = await this.rules.assertBusinessDate(ctx.user, dto.businessDate);
    const amount = parseMoney(dto.amount, 'amount', { allowZero: false });
    const periodFrom = dto.periodFrom ? toDate(dto.periodFrom, 'periodFrom') : null;
    const periodTo = dto.periodTo ? toDate(dto.periodTo, 'periodTo') : null;
    if (periodFrom && periodTo && periodTo < periodFrom) {
      throw validation('INVALID_DATE', 'periodTo cannot be before periodFrom', 'periodTo');
    }

    return this.prisma.runScoped(ctx.user, async (tx) => {
      // replay of an offline operation returns the original row
      if (dto.clientUuid) {
        const dup = await tx.expense.findUnique({ where: { client_uuid: dto.clientUuid } });
        if (dup) return new Envelope(dup, []);
      }

      const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw notFound('Location');
      if (loc.type === 'GODOWN') throw validation('INVALID_LOCATION', 'Expenses are booked to a branch or the central office', 'locationId');
      await this.rules.assertDayEditable(tx, ctx.user, dto.locationId, date);

      // V11 category / sub-category
      const cat = await tx.expenseCategory.findUnique({ where: { id: dto.categoryId } });
      if (!cat || cat.status !== 'ACTIVE' || cat.parent_id) throw validation('INVALID_CATEGORY', 'Choose an active category', 'categoryId');
      if (dto.subCategoryId) {
        const sub = await tx.expenseCategory.findUnique({ where: { id: dto.subCategoryId } });
        if (!sub || sub.status !== 'ACTIVE' || sub.parent_id !== cat.id) {
          throw validation('INVALID_CATEGORY', 'Sub-category does not belong to the category', 'subCategoryId');
        }
      }

      // V12 receipt required above threshold
      const receiptAbove = cat.requires_receipt_above ?? D(await this.settings.getNumber('expense.receipt_above'));
      if (amount.greaterThan(receiptAbove) && !dto.attachmentKeys?.length) {
        throw validation('RECEIPT_REQUIRED', `A receipt photo is required for amounts above ${receiptAbove.toFixed(0)}`, 'attachmentKeys');
      }
      if (cat.requires_supplier && !dto.supplierId) {
        throw validation('SUPPLIER_REQUIRED', 'Choose a supplier for this category', 'supplierId');
      }

      const warnings = await this.softWarnings(tx, dto, cat, amount, date);

      // approval: auto-approve when within the creator's limit for EXPENSE (LLD s8)
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'EXPENSE');
      const auto = this.rules.withinLimit(limit, amount);

      const code = await this.codes.next(tx, 'expense', dto.locationId);
      const row = await tx.expense.create({
        data: {
          code,
          location_id: dto.locationId,
          business_date: date,
          category_id: dto.categoryId,
          sub_category_id: dto.subCategoryId,
          amount,
          payment_mode: dto.paymentMode as any,
          supplier_id: dto.supplierId,
          payee_name: dto.payeeName,
          description: dto.description,
          period_from: periodFrom,
          period_to: periodTo,
          employee_id: dto.employeeId,
          approval_status: auto ? 'APPROVED' : 'SUBMITTED',
          approved_by: auto ? ctx.user.id : null,
          approved_at: auto ? new Date() : null,
          entered_by: ctx.user.id,
          client_uuid: dto.clientUuid,
          client_created_at: dto.clientCreatedAt ? new Date(dto.clientCreatedAt) : undefined,
          source: ctx.source,
          created_by: ctx.user.id,
          updated_by: ctx.user.id,
        },
      });

      // cash leaves the till when it is spent, whether or not it is approved yet
      if (row.payment_mode === 'CASH') {
        await tx.cashTransaction.create({
          data: {
            location_id: row.location_id, business_date: date, txn_type: 'EXPENSE', direction: -1, amount,
            source_type: 'EXPENSE', source_id: row.id, description: row.code, source: ctx.source,
            created_by: ctx.user.id, updated_by: ctx.user.id,
          },
        });
      }
      if (dto.attachmentKeys?.length) {
        await this.attachments.register(tx, ctx, { entityType: 'EXPENSE', entityId: row.id, locationId: row.location_id, keys: dto.attachmentKeys });
      }
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'EXPENSE', entityId: row.id, entityCode: row.code, locationId: row.location_id, after: row });
      return new Envelope(row, warnings);
    });
  }

  /** V13 unusual amount, V14 possible duplicate: warnings only, the entry still saves. */
  private async softWarnings(
    tx: Tx,
    dto: CreateExpenseDto,
    cat: { id: string; name_en: string; unusual_threshold: Prisma.Decimal | null },
    amount: Prisma.Decimal,
    date: Date,
  ): Promise<Warning[]> {
    const warnings: Warning[] = [];

    if (cat.unusual_threshold && amount.greaterThan(cat.unusual_threshold)) {
      warnings.push({ code: 'UNUSUAL_EXPENSE', message: `Above the usual limit for ${cat.name_en}`, field: 'amount' });
    } else {
      const since = addDays(date, -90);
      const agg = await tx.expense.aggregate({
        where: {
          location_id: dto.locationId, category_id: cat.id, status: 'ACTIVE',
          approval_status: { in: ['SUBMITTED', 'APPROVED'] }, business_date: { gte: since, lt: date },
        },
        _avg: { amount: true },
        _count: true,
      });
      const mult = D(await this.settings.getNumber('expense.unusual_multiple'));
      if (agg._count >= 5 && agg._avg.amount && amount.greaterThan(agg._avg.amount.mul(mult))) {
        warnings.push({
          code: 'UNUSUAL_EXPENSE',
          message: `${cat.name_en} is ${mult.toFixed(0)}x higher than the 90-day average`,
          field: 'amount',
        });
      }
    }

    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const dup = await tx.expense.findFirst({
      where: {
        location_id: dto.locationId, business_date: date, category_id: cat.id, amount, status: 'ACTIVE',
        payee_name: dto.payeeName ?? null, created_at: { gte: tenMinAgo },
      },
      select: { code: true },
    });
    if (dup) warnings.push({ code: 'POSSIBLE_DUPLICATE', message: `Looks the same as ${dup.code} entered a moment ago` });

    return warnings;
  }

  // ------------------------------------------------------------ read
  /** Ledger rows carry everything the owner screens show: names for category / sub-category / supplier / branch / people. */
  async list(ctx: ReqCtx, q: ListExpensesQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)));
    const search = q.q?.trim();
    const where: Prisma.ExpenseWhereInput = {
      ...(q.locationId ? { location_id: q.locationId } : {}),
      ...(q.categoryId ? { category_id: q.categoryId } : {}),
      ...(q.subCategoryId ? { sub_category_id: q.subCategoryId } : {}),
      ...(q.paymentMode ? { payment_mode: q.paymentMode as any } : {}),
      ...(q.status ? { approval_status: q.status as any } : {}),
      ...(search
        ? { OR: [{ payee_name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] }
        : {}),
      ...(q.from || q.to
        ? { business_date: { ...(q.from ? { gte: toDate(q.from, 'from') } : {}), ...(q.to ? { lte: toDate(q.to, 'to') } : {}) } }
        : {}),
    };
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const [rows, total, totalAmount] = await Promise.all([
        tx.expense.findMany({ where, orderBy: [{ business_date: 'desc' }, { created_at: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.expense.count({ where }),
        tx.expense.aggregate({ where: { ...where, status: 'ACTIVE', approval_status: { in: ['SUBMITTED', 'APPROVED'] } }, _sum: { amount: true } }),
      ]);
      const catIds = [...new Set(rows.flatMap((r) => [r.category_id, r.sub_category_id].filter((x): x is string => !!x)))];
      const userIds = [...new Set(rows.flatMap((r) => [r.entered_by, r.approved_by].filter((x): x is string => !!x)))];
      const supplierIds = [...new Set(rows.map((r) => r.supplier_id).filter((x): x is string => !!x))];
      const locIds = [...new Set(rows.map((r) => r.location_id))];
      const [cats, users, suppliers, locs, atts] = await Promise.all([
        tx.expenseCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name_en: true, name_ta: true } }),
        tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } }),
        tx.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } }),
        tx.location.findMany({ where: { id: { in: locIds } }, select: { id: true, code: true, name: true, name_ta: true } }),
        tx.attachment.groupBy({ by: ['entity_id'], where: { entity_type: 'EXPENSE', entity_id: { in: rows.map((r) => r.id) }, status: 'ACTIVE' }, _count: { _all: true } }),
      ]);
      const c = new Map(cats.map((x) => [x.id, x]));
      const u = new Map(users.map((x) => [x.id, x.full_name]));
      const sp = new Map(suppliers.map((x) => [x.id, x.name]));
      const l = new Map(locs.map((x) => [x.id, x]));
      const a = new Map(atts.map((x) => [x.entity_id, x._count._all]));
      const data = rows.map((r) => ({
        ...r,
        category_name: c.get(r.category_id)?.name_en, category_name_ta: c.get(r.category_id)?.name_ta,
        sub_category_name: r.sub_category_id ? c.get(r.sub_category_id)?.name_en : null,
        sub_category_name_ta: r.sub_category_id ? c.get(r.sub_category_id)?.name_ta : null,
        supplier_name: r.supplier_id ? sp.get(r.supplier_id) : null,
        location_code: l.get(r.location_id)?.code, location_name: l.get(r.location_id)?.name, location_name_ta: l.get(r.location_id)?.name_ta,
        entered_by_name: u.get(r.entered_by) ?? null,
        approved_by_name: r.approved_by ? u.get(r.approved_by) ?? null : null,
        receipt_count: a.get(r.id) ?? 0,
      }));
      return new Envelope(data, [], { page, pageSize, total, totalAmount: totalAmount._sum.amount ?? D(0) });
    });
  }

  async get(ctx: ReqCtx, id: string) {
    const [row, atts] = await this.prisma.runScoped(ctx.user, async (tx) => {
      const r = await tx.expense.findUnique({ where: { id } });
      if (!r) throw notFound('Expense');
      const a = await tx.attachment.findMany({
        where: { entity_type: 'EXPENSE', entity_id: id, status: 'ACTIVE' },
        select: { id: true, file_name: true, mime_type: true, size_bytes: true },
      });
      return [r, a] as const;
    });
    return { ...row, attachments: atts };
  }

  // ------------------------------------------------------------ edit (unapproved only)
  async update(ctx: ReqCtx, id: string, dto: UpdateExpenseDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.expense.findUnique({ where: { id } });
      if (!before) throw notFound('Expense');
      if (before.version !== dto.version) throw staleVersion();
      if (before.status !== 'ACTIVE' || !['SUBMITTED', 'REJECTED'].includes(before.approval_status)) {
        throw new AppException(409, 'APPROVED_IMMUTABLE', 'Only unapproved expenses can be edited; reverse approved ones instead');
      }
      if (before.entered_by !== ctx.user.id && !can(ctx.user, 'expense:approve')) {
        throw new AppException(403, 'FORBIDDEN', 'You can edit only your own entries');
      }
      await this.rules.assertDayEditable(tx, ctx.user, before.location_id, before.business_date);

      const amount = dto.amount ? parseMoney(dto.amount, 'amount', { allowZero: false }) : before.amount;
      const paymentMode = (dto.paymentMode as any) ?? before.payment_mode;

      // a resubmitted rejected expense goes back to the approval queue (or auto-approves within limit)
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'EXPENSE');
      const auto = this.rules.withinLimit(limit, amount);

      const after = await tx.expense.update({
        where: { id },
        data: {
          category_id: dto.categoryId, sub_category_id: dto.subCategoryId, amount, payment_mode: paymentMode,
          payee_name: dto.payeeName, description: dto.description,
          approval_status: auto ? 'APPROVED' : 'SUBMITTED',
          approved_by: auto ? ctx.user.id : null, approved_at: auto ? new Date() : null, rejection_reason: null,
          updated_by: ctx.user.id, version: { increment: 1 },
        },
      });

      // keep the till in step: cancel the old cash row, post a new one if still cash
      await tx.cashTransaction.updateMany({
        where: { source_type: 'EXPENSE', source_id: id, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      if (paymentMode === 'CASH') {
        await tx.cashTransaction.create({
          data: {
            location_id: after.location_id, business_date: after.business_date, txn_type: 'EXPENSE', direction: -1, amount,
            source_type: 'EXPENSE', source_id: id, description: after.code, source: ctx.source,
            created_by: ctx.user.id, updated_by: ctx.user.id,
          },
        });
      }
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'EXPENSE', entityId: id, entityCode: after.code, locationId: after.location_id, before, after });
      return after;
    });
  }

  // ------------------------------------------------------------ workflow
  async approve(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const e = await this.loadFor(tx, id, ['SUBMITTED'], 'approve');
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'EXPENSE');
      if (!this.rules.withinLimit(limit, e.amount)) {
        throw new AppException(403, 'APPROVAL_LIMIT_EXCEEDED', 'This amount is above your approval limit; ask the owner');
      }
      const after = await tx.expense.update({
        where: { id },
        data: { approval_status: 'APPROVED', approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.audit.log(tx, ctx, { action: 'APPROVE', entityType: 'EXPENSE', entityId: id, entityCode: e.code, locationId: e.location_id, before: e, after });
      return after;
    });
  }

  async reject(ctx: ReqCtx, id: string, dto: ExpenseActionDto) {
    if (!dto.reason?.trim()) throw validation('REASON_REQUIRED', 'Give a reason for rejecting', 'reason');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const e = await this.loadFor(tx, id, ['SUBMITTED'], 'reject');
      const limit = await this.rules.approvalLimit(tx, ctx.user, 'EXPENSE');
      if (!this.rules.withinLimit(limit, e.amount)) {
        throw new AppException(403, 'APPROVAL_LIMIT_EXCEEDED', 'This amount is above your approval limit; ask the owner');
      }
      const after = await tx.expense.update({
        where: { id },
        data: { approval_status: 'REJECTED', rejection_reason: dto.reason, approved_by: ctx.user.id, approved_at: new Date(), updated_by: ctx.user.id, version: { increment: 1 } },
      });
      // a rejected expense never left the till
      await tx.cashTransaction.updateMany({ where: { source_type: 'EXPENSE', source_id: id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, ctx, { action: 'REJECT', entityType: 'EXPENSE', entityId: id, entityCode: e.code, locationId: e.location_id, before: e, after, reason: dto.reason });
      return after;
    });
  }

  /** SUBMITTED / REJECTED -> CANCELLED by the creator or the owner. */
  async cancel(ctx: ReqCtx, id: string, dto: ExpenseActionDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const e = await this.loadFor(tx, id, ['SUBMITTED', 'REJECTED'], 'cancel');
      if (e.entered_by !== ctx.user.id && !isOwner(ctx.user)) {
        throw new AppException(403, 'FORBIDDEN', 'Only the person who entered it, or the owner, can cancel this expense');
      }
      const after = await tx.expense.update({
        where: { id },
        data: { approval_status: 'CANCELLED', status: 'CANCELLED', updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await tx.cashTransaction.updateMany({ where: { source_type: 'EXPENSE', source_id: id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, ctx, { action: 'CANCEL', entityType: 'EXPENSE', entityId: id, entityCode: e.code, locationId: e.location_id, before: e, after, reason: dto.reason });
      return after;
    });
  }

  /**
   * APPROVED -> REVERSED (owner/accountant). Never a delete: the original stays visible and a mirror
   * cash posting dated today puts the money back in the till.
   */
  async reverse(ctx: ReqCtx, id: string, dto: ExpenseActionDto) {
    if (!dto.reason?.trim()) throw validation('REASON_REQUIRED', 'Give a reason for reversing', 'reason');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const e = await this.loadFor(tx, id, ['APPROVED'], 'reverse');
      const after = await tx.expense.update({
        where: { id },
        data: { status: 'REVERSED', updated_by: ctx.user.id, version: { increment: 1 } },
      });
      const original = await tx.cashTransaction.findFirst({ where: { source_type: 'EXPENSE', source_id: id, status: 'ACTIVE' } });
      if (original) {
        await tx.cashTransaction.create({
          data: {
            location_id: original.location_id, business_date: toDate(todayIST()), txn_type: 'ADJUSTMENT', direction: 1,
            amount: original.amount, source_type: 'EXPENSE_REVERSAL', source_id: id, reversal_of_id: original.id,
            description: `Reversal of ${e.code}`, source: ctx.source, created_by: ctx.user.id, updated_by: ctx.user.id,
          },
        });
      }
      await this.audit.log(tx, ctx, { action: 'REVERSE', entityType: 'EXPENSE', entityId: id, entityCode: e.code, locationId: e.location_id, before: e, after, reason: dto.reason });
      return after;
    });
  }

  private async loadFor(tx: Tx, id: string, allowed: string[], verb: string) {
    const e = await tx.expense.findUnique({ where: { id } });
    if (!e) throw notFound('Expense');
    if (e.status !== 'ACTIVE' || !allowed.includes(e.approval_status)) {
      throw new AppException(409, 'INVALID_TRANSITION', `Cannot ${verb} an expense that is ${e.status === 'ACTIVE' ? e.approval_status : e.status}`);
    }
    return e;
  }
}
