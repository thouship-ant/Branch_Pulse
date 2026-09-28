import { Injectable } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { PrismaService } from '../common/prisma.service';

export class CreateRoleDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,29}$/) code: string;
  @IsString() @MaxLength(60) name: string;
  @IsIn(['ALL', 'ASSIGNED']) scopeMode: string;
  @IsOptional() @IsArray() @IsString({ each: true }) permissionCodes?: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}

export class RolePermissionsDto {
  @IsArray() @IsString({ each: true }) permissionCodes: string[];
}

/** RBAC admin (LLD s12). Built-in roles (OWNER, ACCOUNTANT, ...) can be renamed and re-permissioned like any
 * other role, but a permission update may never leave zero active roles holding role:manage - that would lock
 * every user out of this screen with no way back in short of a database edit. */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(r: any) {
    return {
      id: r.id, code: r.code, name: r.name, scopeMode: r.scope_mode, isSystem: r.is_system, status: r.status,
      userCount: r._count?.users ?? 0, permissions: r.permissions.map((p: any) => p.permission.code),
    };
  }

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      orderBy: { code: 'asc' },
    });
    return roles.map((r) => this.view(r));
  }

  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
  }

  async createRole(ctx: ReqCtx, dto: CreateRoleDto) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.role.findUnique({ where: { code: dto.code } })) throw new AppException(409, 'DUPLICATE_ROLE', 'A role with this code already exists');
      const perms = dto.permissionCodes?.length ? await tx.permission.findMany({ where: { code: { in: dto.permissionCodes } } }) : [];
      const role = await tx.role.create({
        data: {
          code: dto.code, name: dto.name.trim(), scope_mode: dto.scopeMode, is_system: false,
          created_by: ctx.user.id, updated_by: ctx.user.id,
          permissions: { create: perms.map((p) => ({ permission_id: p.id })) },
        },
        include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'ROLE', entityId: role.id, entityCode: role.code, after: this.view(role) });
      return this.view(role);
    });
  }

  async updateRole(ctx: ReqCtx, id: string, dto: UpdateRoleDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
      if (!before) throw notFound('Role');
      if (dto.status === 'INACTIVE' && before._count.users > 0) {
        throw validation('ROLE_IN_USE', 'Reassign users off this role before deactivating it', 'status');
      }
      const after = await tx.role.update({
        where: { id },
        data: { name: dto.name?.trim() || undefined, status: dto.status as 'ACTIVE' | 'INACTIVE' | undefined, updated_by: ctx.user.id, version: { increment: 1 } },
        include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'ROLE', entityId: id, entityCode: after.code, before: this.view(before), after: this.view(after) });
      return this.view(after);
    });
  }

  async putRolePermissions(ctx: ReqCtx, id: string, dto: RolePermissionsDto) {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id } });
      if (!role) throw notFound('Role');
      const codes = [...new Set(dto.permissionCodes)];
      const perms = await tx.permission.findMany({ where: { code: { in: codes } } });
      if (perms.length !== codes.length) throw validation('INVALID_PERMISSION', 'Unknown permission code', 'permissionCodes');

      if (role.status === 'ACTIVE' && !codes.includes('role:manage')) {
        const others = await tx.role.count({
          where: { id: { not: id }, status: 'ACTIVE', permissions: { some: { permission: { code: 'role:manage' } } } },
        });
        if (others === 0) throw validation('LAST_ROLE_MANAGER', 'At least one active role must keep the "Manage roles" permission', 'permissionCodes');
      }

      const before = await tx.rolePermission.findMany({ where: { role_id: id }, include: { permission: true } });
      await tx.rolePermission.deleteMany({ where: { role_id: id } });
      if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ role_id: id, permission_id: p.id })) });
      await this.audit.log(tx, ctx, {
        action: 'PERMISSION_CHANGE', entityType: 'ROLE', entityId: id, entityCode: role.code,
        before: { permissions: before.map((b) => b.permission.code) }, after: { permissions: codes },
      });
      return { id, permissions: codes };
    });
  }
}
