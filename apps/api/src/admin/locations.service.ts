import { Injectable } from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { toDate } from '../common/dates';
import { MONEY_PATTERN, parseMoney } from '../common/money';
import { PrismaService } from '../common/prisma.service';

export class CreateLocationDto {
  @IsString() @MaxLength(10) code: string;
  @IsString() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(100) nameTa?: string;
  @IsEnum(['BRANCH', 'GODOWN', 'CENTRAL_OFFICE']) type: 'BRANCH' | 'GODOWN' | 'CENTRAL_OFFICE';
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() @MaxLength(15) phone?: string;
  @IsOptional() @IsUUID() managerUserId?: string;
  @IsOptional() @Matches(MONEY_PATTERN) defaultOpeningCash?: string;
  @IsOptional() @IsBoolean() cardEnabled?: boolean;
  @IsOptional() @IsString() openedOn?: string;
  @IsOptional() @Matches(MONEY_PATTERN) monthlyRent?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateLocationDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(100) nameTa?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() @MaxLength(15) phone?: string;
  @IsOptional() @IsUUID() managerUserId?: string;
  @IsOptional() @Matches(MONEY_PATTERN) defaultOpeningCash?: string;
  @IsOptional() @IsBoolean() cardEnabled?: boolean;
  @IsOptional() @Matches(MONEY_PATTERN) monthlyRent?: string;
  @IsOptional() @IsString() notes?: string;
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: ReqCtx, type?: string) {
    return this.prisma.runScoped(ctx.user, (tx) =>
      tx.location.findMany({
        where: type ? { type: type as any } : {},
        orderBy: { code: 'asc' },
      }),
    );
  }

  async get(ctx: ReqCtx, id: string) {
    const loc = await this.prisma.runScoped(ctx.user, (tx) => tx.location.findUnique({ where: { id } }));
    if (!loc) throw notFound('Location');
    return loc;
  }

  create(ctx: ReqCtx, dto: CreateLocationDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const exists = await tx.location.findUnique({ where: { code: dto.code } });
      if (exists) throw new AppException(409, 'DUPLICATE', `Location code ${dto.code} already exists`);
      const loc = await tx.location.create({
        data: {
          code: dto.code,
          name: dto.name,
          name_ta: dto.nameTa,
          type: dto.type,
          address: dto.address,
          phone: dto.phone,
          manager_user_id: dto.managerUserId,
          default_opening_cash: dto.defaultOpeningCash ? parseMoney(dto.defaultOpeningCash, 'defaultOpeningCash') : 0,
          card_enabled: dto.cardEnabled ?? true,
          opened_on: dto.openedOn ? toDate(dto.openedOn, 'openedOn') : null,
          monthly_rent: dto.monthlyRent ? parseMoney(dto.monthlyRent, 'monthlyRent') : null,
          notes: dto.notes,
          created_by: ctx.user.id,
          updated_by: ctx.user.id,
        },
      });
      await this.audit.log(tx, ctx, {
        action: 'CREATE', entityType: 'LOCATION', entityId: loc.id, entityCode: loc.code, locationId: loc.id, after: loc,
      });
      return loc;
    });
  }

  update(ctx: ReqCtx, id: string, dto: UpdateLocationDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.location.findUnique({ where: { id } });
      if (!before) throw notFound('Location');
      const after = await tx.location.update({
        where: { id },
        data: {
          name: dto.name,
          name_ta: dto.nameTa,
          address: dto.address,
          phone: dto.phone,
          manager_user_id: dto.managerUserId,
          default_opening_cash: dto.defaultOpeningCash ? parseMoney(dto.defaultOpeningCash, 'defaultOpeningCash') : undefined,
          card_enabled: dto.cardEnabled,
          monthly_rent: dto.monthlyRent ? parseMoney(dto.monthlyRent, 'monthlyRent') : undefined,
          notes: dto.notes,
          updated_by: ctx.user.id,
          version: { increment: 1 },
        },
      });
      await this.audit.log(tx, ctx, {
        action: 'UPDATE', entityType: 'LOCATION', entityId: id, entityCode: after.code, locationId: id, before, after,
      });
      return after;
    });
  }

  setActive(ctx: ReqCtx, id: string, active: boolean) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.location.findUnique({ where: { id } });
      if (!before) throw notFound('Location');
      if (!active) {
        const pending = await tx.dailyClosing.count({
          where: { location_id: id, status: { in: ['SUBMITTED'] } },
        });
        if (pending) throw validation('LOCATION_HAS_PENDING', 'Resolve submitted closings before deactivating');
      }
      const after = await tx.location.update({
        where: { id },
        data: { status: active ? 'ACTIVE' : 'INACTIVE', updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await this.audit.log(tx, ctx, {
        action: 'STATUS_CHANGE', entityType: 'LOCATION', entityId: id, entityCode: after.code, locationId: id, before, after,
      });
      return after;
    });
  }

  /** Branch audit timeline (LLD s11 GET /locations/:id/history). */
  history(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: { location_id: id },
        orderBy: { occurred_at: 'desc' },
        take: 200,
      });
      return rows;
    });
  }
}
