import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsDefined, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { MONEY_PATTERN, parseMoney } from '../common/money';
import { PrismaService } from '../common/prisma.service';
import { SETTING_DEFAULTS, SettingsService } from '../common/settings.service';

const BUCKETS = ['RAW_MATERIAL', 'SALARY', 'RENT', 'ELECTRICITY', 'TRANSPORT', 'MAINTENANCE', 'OTHER', 'NON_PL'];

export class CategoryDto {
  @IsOptional() @IsUUID() parentId?: string;
  @IsString() @IsNotEmpty() @MaxLength(60) nameEn: string;
  @IsOptional() @IsString() @MaxLength(60) nameTa?: string;
  @IsIn(BUCKETS) plBucket: string;
  @IsOptional() @Matches(MONEY_PATTERN) requiresReceiptAbove?: string;
  @IsOptional() @Matches(MONEY_PATTERN) unusualThreshold?: string;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @MaxLength(60) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(60) nameTa?: string;
  @IsOptional() @IsIn(BUCKETS) plBucket?: string;
  @IsOptional() @Matches(MONEY_PATTERN) requiresReceiptAbove?: string;
  @IsOptional() @Matches(MONEY_PATTERN) unusualThreshold?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class SettingValueDto {
  // any JSON scalar; type-checked against the setting's default in the service
  @IsDefined() value: unknown;
}

export class ApprovalLimitDto {
  @IsString() roleCode: string;
  @IsIn(['EXPENSE', 'PURCHASE', 'ADVANCE', 'WASTAGE', 'CASH_VARIANCE']) entityType: string;
  @Matches(MONEY_PATTERN) maxAmount: string;
}

@Injectable()
export class MasterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ---- expense categories (LLD s2)
  listCategories(includeInactive = false) {
    return this.prisma.expenseCategory.findMany({
      where: includeInactive ? {} : { status: 'ACTIVE' },
      orderBy: [{ sort_order: 'asc' }, { name_en: 'asc' }],
    });
  }

  createCategory(ctx: ReqCtx, dto: CategoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.parentId) {
        const parent = await tx.expenseCategory.findUnique({ where: { id: dto.parentId } });
        if (!parent || parent.parent_id) throw validation('INVALID_CATEGORY', 'Parent must be a top-level category', 'parentId');
      }
      const cat = await tx.expenseCategory.create({
        data: {
          parent_id: dto.parentId ?? null,
          name_en: dto.nameEn,
          name_ta: dto.nameTa,
          pl_bucket: dto.plBucket,
          requires_receipt_above: dto.requiresReceiptAbove ? parseMoney(dto.requiresReceiptAbove, 'requiresReceiptAbove') : null,
          unusual_threshold: dto.unusualThreshold ? parseMoney(dto.unusualThreshold, 'unusualThreshold') : null,
          created_by: ctx.user.id,
          updated_by: ctx.user.id,
        },
      });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'EXPENSE_CATEGORY', entityId: cat.id, entityCode: cat.name_en, after: cat });
      return cat;
    });
  }

  updateCategory(ctx: ReqCtx, id: string, dto: UpdateCategoryDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.expenseCategory.findUnique({ where: { id } });
      if (!before) throw notFound('Category');
      const after = await tx.expenseCategory.update({
        where: { id },
        data: {
          name_en: dto.nameEn,
          name_ta: dto.nameTa,
          pl_bucket: dto.plBucket,
          requires_receipt_above: dto.requiresReceiptAbove ? parseMoney(dto.requiresReceiptAbove, 'requiresReceiptAbove') : undefined,
          unusual_threshold: dto.unusualThreshold ? parseMoney(dto.unusualThreshold, 'unusualThreshold') : undefined,
          status: dto.active === undefined ? undefined : dto.active ? 'ACTIVE' : 'INACTIVE',
          updated_by: ctx.user.id,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'EXPENSE_CATEGORY', entityId: id, entityCode: after.name_en, before, after });
      return after;
    });
  }

  // ---- settings
  allSettings() {
    return this.settings.all();
  }

  async putSetting(ctx: ReqCtx, key: string, value: unknown) {
    if (!(key in SETTING_DEFAULTS)) throw validation('UNKNOWN_SETTING', `Unknown setting ${key}`, 'key');
    const expected = typeof SETTING_DEFAULTS[key];
    if (typeof value !== expected) throw validation('INVALID_SETTING', `${key} must be a ${expected}`, 'value');
    if (key === 'business.type' && !['TEA_SHOP', 'HOTEL', 'BAKERY', 'OTHER'].includes(String(value))) {
      throw validation('INVALID_SETTING', 'business.type must be TEA_SHOP, HOTEL, BAKERY or OTHER', 'value');
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.setting.findUnique({ where: { key } });
      const after = await tx.setting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue, updated_by: ctx.user.id },
        update: { value: value as Prisma.InputJsonValue, updated_by: ctx.user.id },
      });
      this.settings.invalidate(key);
      await this.audit.log(tx, ctx, {
        action: 'SETTINGS_CHANGE', entityType: 'SETTING', entityCode: key,
        before: before ? { value: before.value } : { value: SETTING_DEFAULTS[key] },
        after: { value },
      });
      return after;
    });
  }

  // ---- approval limits (LLD s2, s12)
  listLimits() {
    return this.prisma.approvalLimit.findMany({ orderBy: [{ role_id: 'asc' }, { entity_type: 'asc' }] });
  }

  putLimit(ctx: ReqCtx, dto: ApprovalLimitDto) {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { code: dto.roleCode } });
      if (!role) throw notFound('Role');
      const max = parseMoney(dto.maxAmount, 'maxAmount');
      const before = await tx.approvalLimit.findUnique({
        where: { role_id_entity_type: { role_id: role.id, entity_type: dto.entityType } },
      });
      const after = await tx.approvalLimit.upsert({
        where: { role_id_entity_type: { role_id: role.id, entity_type: dto.entityType } },
        create: { role_id: role.id, entity_type: dto.entityType, max_amount: max, created_by: ctx.user.id, updated_by: ctx.user.id },
        update: { max_amount: max, updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.audit.log(tx, ctx, {
        action: 'SETTINGS_CHANGE', entityType: 'APPROVAL_LIMIT', entityCode: `${dto.roleCode}:${dto.entityType}`, before, after,
      });
      return after;
    });
  }
}
