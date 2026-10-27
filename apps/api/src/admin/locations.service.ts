import { Injectable } from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { toDate } from '../common/dates';
import { MONEY_PATTERN, parseMoney } from '../common/money';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { Envelope } from '../common/response';
import { TransliterationService } from './transliteration.service';

export class AssignManagerDto {
  /** null / omitted clears the manager. */
  @IsOptional() @IsUUID() userId?: string | null;
}

export class CreateLocationDto {
  // unique, upper-case, fixed once created (PATCH cannot change it); the UI suggests the next free code
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/, { message: 'code must be 2-10 upper-case letters/digits, starting with a letter' }) code: string;
  @IsString() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(100) nameTa?: string;
  @IsEnum(['BRANCH', 'GODOWN', 'CENTRAL_OFFICE']) type: 'BRANCH' | 'GODOWN' | 'CENTRAL_OFFICE';
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() @MaxLength(15) phone?: string;
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
    private readonly settings: SettingsService,
    private readonly translit: TransliterationService,
  ) {}

  /** Attach the manager's display fields (users are not location-scoped, so a plain lookup is fine). */
  private async withManagers<T extends { manager_user_id: string | null }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.manager_user_id).filter((x): x is string => !!x))];
    const users = ids.length
      ? await this.prisma.runCurrent((tx) => tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, full_name: true, username: true, mobile: true, status: true } }))
      : [];
    return rows.map((r) => ({ ...r, manager: users.find((u) => u.id === r.manager_user_id) ?? null }));
  }

  async list(ctx: ReqCtx, type?: string) {
    const rows = await this.prisma.runScoped(ctx.user, (tx) =>
      tx.location.findMany({ where: type ? { type: type as any } : {}, orderBy: { code: 'asc' } }),
    );
    return this.withManagers(rows);
  }

  async get(ctx: ReqCtx, id: string) {
    const loc = await this.prisma.runScoped(ctx.user, (tx) => tx.location.findUnique({ where: { id } }));
    if (!loc) throw notFound('Location');
    return (await this.withManagers([loc]))[0];
  }

  /**
   * Suggest the next free code for a location type: <prefix><n>, e.g. BR007. The branch prefix is a
   * setting (`branch.code_prefix`) so it is configurable, never hard-coded; codes themselves are data.
   */
  async nextCode(ctx: ReqCtx, type: string) {
    const prefix =
      type === 'GODOWN' ? 'GDN' : type === 'CENTRAL_OFFICE' ? 'HO' : String(await this.settings.get('branch.code_prefix')).toUpperCase();
    const codes = await this.prisma.runScoped(ctx.user, (tx) =>
      tx.location.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } }),
    );
    const re = new RegExp(`^${prefix}(\\d+)$`);
    const max = codes.reduce((m, c) => Math.max(m, Number(re.exec(c.code)?.[1] ?? 0)), 0);
    return { code: `${prefix}${String(max + 1).padStart(3, '0')}`, prefix };
  }

  /**
   * Make `userId` the manager of a branch or godown (or clear it with null). A manager runs exactly one
   * location, so the user's other assignment is moved, and the previous manager loses access to it.
   * Branches are run by a Branch Manager; a godown by a Stock / Purchase Manager.
   */
  assignManager(ctx: ReqCtx, locationId: string, userId: string | null | undefined) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: locationId } });
      if (!loc) throw notFound('Location');
      if (loc.type !== 'BRANCH' && loc.type !== 'GODOWN') throw validation('INVALID_LOCATION', 'Only branches and godowns have a manager', 'locationId');
      const requiredRole = loc.type === 'BRANCH' ? 'BRANCH_MANAGER' : 'STOCK_MANAGER';

      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
        if (!user || user.status !== 'ACTIVE') throw notFound('User');
        if (!user.roles.some((r) => r.role.code === requiredRole)) {
          throw validation('INVALID_MANAGER', `Choose a user with the ${requiredRole === 'BRANCH_MANAGER' ? 'Branch Manager' : 'Stock / Purchase Manager'} role`, 'userId');
        }
        // one location per manager: clear any location they managed before and replace their assignment
        await tx.location.updateMany({ where: { manager_user_id: userId, id: { not: locationId } }, data: { manager_user_id: null } });
        await tx.userLocation.deleteMany({ where: { user_id: userId } });
        await tx.userLocation.create({ data: { user_id: userId, location_id: locationId } });
      }

      const previous = loc.manager_user_id;
      if (previous && previous !== userId) {
        // the outgoing manager no longer works at this branch
        await tx.userLocation.deleteMany({ where: { user_id: previous, location_id: locationId } });
      }

      const after = await tx.location.update({
        where: { id: locationId },
        data: { manager_user_id: userId ?? null, updated_by: ctx.user.id, version: { increment: 1 } },
      });
      // the history shows people, not ids
      const nameOf = async (id?: string | null) =>
        id ? (await tx.user.findUnique({ where: { id }, select: { full_name: true } }))?.full_name ?? null : null;
      await this.audit.log(tx, ctx, {
        action: 'PERMISSION_CHANGE', entityType: 'LOCATION', entityId: locationId, entityCode: loc.code, locationId,
        before: { manager: await nameOf(previous) }, after: { manager: await nameOf(userId) },
        reason: userId ? 'manager assigned' : 'manager cleared',
      });
      return (await this.withManagers([after]))[0];
    });
  }

  /** Suggest the Tamil form of a name (used by the Add branch form when the name field loses focus). */
  transliterate(text: string) {
    return this.translit.toTamil(text ?? '');
  }

  async create(ctx: ReqCtx, dto: CreateLocationDto) {
    // scripted callers may omit the Tamil name: fill it in the same way the form does (outside the transaction: it can call out)
    const nameTa = dto.nameTa?.trim() ? dto.nameTa.trim() : (await this.translit.toTamil(dto.name)).tamil || undefined;
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const exists = await tx.location.findFirst({ where: { code: dto.code } }); // RLS limits this to the caller's company
      if (exists) throw new AppException(409, 'DUPLICATE', `Location code ${dto.code} already exists`);
      const loc = await tx.location.create({
        data: {
          code: dto.code,
          name: dto.name,
          name_ta: nameTa,
          type: dto.type,
          address: dto.address,
          phone: dto.phone,
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

  /**
   * Branch audit timeline (LLD s11 GET /locations/:id/history): everything recorded against this branch,
   * newest first, with the actor's name. Cursor-paged by audit id (`before`).
   */
  async history(ctx: ReqCtx, id: string, opts: { limit?: number; before?: string; entityType?: string } = {}) {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const rows = await this.prisma.runScoped(ctx.user, (tx) =>
      tx.auditLog.findMany({
        where: {
          location_id: id,
          ...(opts.entityType ? { entity_type: opts.entityType } : {}),
          ...(opts.before && /^\d+$/.test(opts.before) ? { id: { lt: BigInt(opts.before) } } : {}),
        },
        orderBy: { id: 'desc' },
        take: limit + 1,
      }),
    );
    const page = rows.slice(0, limit);
    const actorIds = [...new Set(page.map((r) => r.actor_id).filter((x): x is string => !!x))];
    const users = actorIds.length
      ? await this.prisma.runCurrent((tx) => tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, full_name: true } }))
      : [];
    const data = page.map((r) => ({ ...r, actor_name: users.find((u) => u.id === r.actor_id)?.full_name ?? null }));
    return new Envelope(data, [], { hasMore: rows.length > limit, next: page.length ? String(page[page.length - 1].id) : null });
  }
}
