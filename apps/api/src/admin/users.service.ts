import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ArrayMinSize, IsArray, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { PrismaService } from '../common/prisma.service';

export class CreateUserDto {
  @IsString() @MaxLength(50) username: string;
  @IsString() @MaxLength(200) password: string;
  @IsString() @MaxLength(100) fullName: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) roleCodes: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) locationIds?: string[];
  @IsOptional() @IsIn(['en', 'ta']) preferredLanguage?: 'en' | 'ta';
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(100) fullName?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(200) password?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) roleCodes?: string[];
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) locationIds?: string[];
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsIn(['en', 'ta']) preferredLanguage?: 'en' | 'ta';
}

// V28: minimal breached-password screen; swap for a k-anonymity HIBP check when online.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', '12345678', '123456789', 'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'abc12345', 'letmein123',
]);

export function assertStrongPassword(pw: string) {
  if (pw.length < 8 || COMMON_PASSWORDS.has(pw.toLowerCase())) {
    throw validation('WEAK_PASSWORD', 'Password must be at least 8 characters and not a common password', 'password');
  }
}

const BRANCH_ROLES = new Set(['BRANCH_MANAGER', 'STAFF']);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(u: any) {
    return {
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      mobile: u.mobile,
      email: u.email,
      preferredLanguage: u.preferred_language,
      status: u.status,
      lastLoginAt: u.last_login_at,
      roles: u.roles.map((r: any) => r.role.code),
      locationIds: u.locations.map((l: any) => l.location_id),
    };
  }

  async list() {
    const users = await this.prisma.user.findMany({
      include: { roles: { include: { role: true } }, locations: true },
      orderBy: { username: 'asc' },
    });
    return users.map((u) => this.view(u));
  }

  async create(ctx: ReqCtx, dto: CreateUserDto) {
    assertStrongPassword(dto.password);
    if (dto.mobile && !/^\d{10}$/.test(dto.mobile)) throw validation('INVALID_MOBILE', 'Mobile must be 10 digits', 'mobile');
    const roles = await this.resolveRoles(dto.roleCodes);
    this.assertScopeRules(roles, dto.locationIds ?? []);

    return this.prisma.$transaction(async (tx) => {
      const taken = await tx.user.findFirst({
        where: { OR: [{ username: dto.username }, ...(dto.mobile ? [{ mobile: dto.mobile }] : [])] },
      });
      if (taken) throw new AppException(409, 'DUPLICATE', 'Username or mobile already in use');
      const user = await tx.user.create({
        data: {
          username: dto.username,
          full_name: dto.fullName,
          mobile: dto.mobile,
          email: dto.email,
          password_hash: await argon2.hash(dto.password),
          preferred_language: dto.preferredLanguage ?? 'en',
          created_by: ctx.user.id,
          updated_by: ctx.user.id,
          roles: { create: roles.map((r) => ({ role_id: r.id })) },
          locations: { create: (dto.locationIds ?? []).map((location_id) => ({ location_id })) },
        },
        include: { roles: { include: { role: true } }, locations: true },
      });
      await this.audit.log(tx, ctx, {
        action: 'CREATE', entityType: 'USER', entityId: user.id, entityCode: user.username,
        after: { username: user.username, roles: dto.roleCodes, locationIds: dto.locationIds ?? [] },
      });
      return this.view(user);
    });
  }

  async update(ctx: ReqCtx, id: string, dto: UpdateUserDto) {
    if (dto.password) assertStrongPassword(dto.password);
    if (dto.mobile && !/^\d{10}$/.test(dto.mobile)) throw validation('INVALID_MOBILE', 'Mobile must be 10 digits', 'mobile');

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        include: { roles: { include: { role: true } }, locations: true },
      });
      if (!before) throw notFound('User');

      const roleCodes = dto.roleCodes ?? before.roles.map((r) => r.role.code);
      const locationIds = dto.locationIds ?? before.locations.map((l) => l.location_id);
      const roles = await this.resolveRoles(roleCodes);
      this.assertScopeRules(roles, locationIds);

      const access = dto.roleCodes || dto.locationIds;
      if (dto.roleCodes) {
        await tx.userRole.deleteMany({ where: { user_id: id } });
        await tx.userRole.createMany({ data: roles.map((r) => ({ user_id: id, role_id: r.id })) });
      }
      if (dto.locationIds) {
        await tx.userLocation.deleteMany({ where: { user_id: id } });
        await tx.userLocation.createMany({ data: locationIds.map((location_id) => ({ user_id: id, location_id })) });
      }
      const after = await tx.user.update({
        where: { id },
        data: {
          full_name: dto.fullName,
          mobile: dto.mobile,
          email: dto.email,
          preferred_language: dto.preferredLanguage,
          status: dto.status,
          password_hash: dto.password ? await argon2.hash(dto.password) : undefined,
          failed_logins: dto.password ? 0 : undefined,
          locked_until: dto.password ? null : undefined,
          updated_by: ctx.user.id,
          version: { increment: 1 },
        },
        include: { roles: { include: { role: true } }, locations: true },
      });

      // force re-login when access changes, the account is disabled, or the password is reset
      if (access || dto.status === 'INACTIVE' || dto.password) {
        await tx.session.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
      }
      await this.audit.log(tx, ctx, {
        action: access ? 'PERMISSION_CHANGE' : 'UPDATE',
        entityType: 'USER', entityId: id, entityCode: after.username,
        before: { ...this.view(before), password: undefined },
        after: { ...this.view(after), password: dto.password ? '***' : undefined },
      });
      return this.view(after);
    });
  }

  private async resolveRoles(codes: string[]) {
    const roles = await this.prisma.role.findMany({ where: { code: { in: codes }, status: 'ACTIVE' } });
    if (roles.length !== new Set(codes).size) throw validation('INVALID_ROLE', 'Unknown or inactive role', 'roleCodes');
    return roles;
  }

  /** Branch Manager / Staff belong to exactly one branch; all-scope roles need no assignments. */
  private assertScopeRules(roles: Array<{ code: string; scope_mode: string }>, locationIds: string[]) {
    if (roles.some((r) => BRANCH_ROLES.has(r.code)) && locationIds.length !== 1) {
      throw validation('INVALID_LOCATION_SCOPE', 'Branch managers and staff must be assigned exactly one branch', 'locationIds');
    }
    if (roles.every((r) => r.scope_mode === 'ASSIGNED') && locationIds.length === 0) {
      throw validation('INVALID_LOCATION_SCOPE', 'Assign at least one location for this role', 'locationIds');
    }
  }
}
