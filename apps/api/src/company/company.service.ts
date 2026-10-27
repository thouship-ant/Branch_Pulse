import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { provisionCompanyDefaults } from '../admin/company-defaults';
import { assertStrongPassword } from '../admin/users.service';
import { AppException, notFound } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { PrismaService } from '../common/prisma.service';

/** 15-character GSTIN: 2 digits state, 10 character PAN, entity number, "Z", checksum. */
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export class CreateCompanyDto {
  @IsString() @MinLength(2) @MaxLength(120) companyName: string;
  /** the first Admin of the company */
  @IsString() @MinLength(2) @MaxLength(100) adminName: string;
  @Matches(/^\d{10}$/, { message: 'Mobile must be 10 digits' }) mobile: string;
  @IsEmail() email: string;
  /** main shop or head office address */
  @IsString() @MinLength(5) @MaxLength(500) address: string;
  @IsOptional() @ValidateIf((o) => o.gstin) @Matches(GSTIN, { message: 'GSTIN must be 15 characters, e.g. 33ABCDE1234F1Z5' }) gstin?: string;
  @IsOptional() @ValidateIf((o) => o.fssai) @Matches(/^\d{14}$/, { message: 'FSSAI licence number must be 14 digits' }) fssai?: string;
  /** the Admin signs in with password + OTP */
  @IsString() @MaxLength(200) password: string;
}

export class UpdateCompanyDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) companyName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(500) address?: string;
  @IsOptional() @ValidateIf((o) => o.gstin) @Matches(GSTIN, { message: 'GSTIN must be 15 characters' }) gstin?: string;
  @IsOptional() @ValidateIf((o) => o.fssai) @Matches(/^\d{14}$/, { message: 'FSSAI licence number must be 14 digits' }) fssai?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: ReqCtx) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const companies = await tx.company.findMany({ orderBy: { code: 'asc' } });
      const [branches, admins] = await Promise.all([
        tx.location.groupBy({ by: ['company_id'], where: { type: 'BRANCH', status: 'ACTIVE' }, _count: true }),
        tx.user.findMany({
          where: { company_id: { not: null }, roles: { some: { role: { code: 'ADMIN' } } } },
          select: { company_id: true, full_name: true, mobile: true, status: true },
          orderBy: { created_at: 'asc' },
        }),
      ]);
      return companies.map((c) => {
        const admin = admins.find((a) => a.company_id === c.id);
        return {
          id: c.id, code: c.code, name: c.name, address: c.address, gstin: c.gstin, fssai: c.fssai, email: c.email, status: c.status, createdAt: c.created_at,
          branchCount: branches.find((b) => b.company_id === c.id)?._count ?? 0,
          admin: admin ? { name: admin.full_name, mobile: admin.mobile, status: admin.status } : null,
        };
      });
    });
  }

  async create(ctx: ReqCtx, dto: CreateCompanyDto) {
    assertStrongPassword(dto.password);
    const name = dto.companyName.trim();
    return this.prisma.runScoped(ctx.user, async (tx) => {
      if (await tx.company.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })) {
        throw new AppException(409, 'DUPLICATE_COMPANY', 'A company with this name already exists');
      }
      if (await tx.user.findFirst({ where: { OR: [{ mobile: dto.mobile }, { username: dto.mobile }] } })) {
        throw new AppException(409, 'DUPLICATE', 'This mobile number is already registered');
      }

      const [{ n }] = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('seq_code_company') AS n`;
      const company = await tx.company.create({
        data: {
          code: `CMP${String(n).padStart(3, '0')}`, name, address: dto.address.trim(), email: dto.email.trim().toLowerCase(),
          gstin: dto.gstin?.trim().toUpperCase() || null, fssai: dto.fssai?.trim() || null, created_by: ctx.user.id, updated_by: ctx.user.id,
        },
      });

      // roles, approval limits, categories and settings for the new company
      const roleId = await provisionCompanyDefaults(tx, company.id, name);

      // the company's head office / main shop is its first location
      await tx.location.create({
        data: { company_id: company.id, code: 'HO001', name: 'Head Office', type: 'CENTRAL_OFFICE', address: dto.address.trim(), created_by: ctx.user.id, updated_by: ctx.user.id },
      });

      const admin = await tx.user.create({
        data: {
          company_id: company.id, username: dto.mobile, mobile: dto.mobile, full_name: dto.adminName.trim(), email: dto.email.trim().toLowerCase(),
          password_hash: await argon2.hash(dto.password), created_by: ctx.user.id, updated_by: ctx.user.id,
          roles: { create: [{ role_id: roleId.get('ADMIN')! }] },
        },
      });

      await this.audit.log(tx, ctx, {
        action: 'CREATE', entityType: 'COMPANY', entityId: company.id, entityCode: company.code, companyId: company.id,
        after: { code: company.code, name, address: company.address, gstin: company.gstin, fssai: company.fssai, admin: { name: admin.full_name, mobile: admin.mobile } },
      });
      return {
        id: company.id, code: company.code, name: company.name,
        admin: { id: admin.id, name: admin.full_name, mobile: admin.mobile, email: admin.email },
      };
    });
  }

  async update(ctx: ReqCtx, id: string, dto: UpdateCompanyDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.company.findUnique({ where: { id } });
      if (!before) throw notFound('Company');
      if (dto.companyName && dto.companyName.trim().toLowerCase() !== before.name.toLowerCase()) {
        if (await tx.company.findFirst({ where: { name: { equals: dto.companyName.trim(), mode: 'insensitive' }, id: { not: id } } })) {
          throw new AppException(409, 'DUPLICATE_COMPANY', 'A company with this name already exists');
        }
      }
      const after = await tx.company.update({
        where: { id },
        data: {
          name: dto.companyName?.trim(), email: dto.email?.trim().toLowerCase(), address: dto.address?.trim(),
          gstin: dto.gstin === undefined ? undefined : dto.gstin.trim().toUpperCase() || null,
          fssai: dto.fssai === undefined ? undefined : dto.fssai.trim() || null,
          status: dto.status, updated_by: ctx.user.id, version: { increment: 1 },
        },
      });
      // a deactivated company is locked out at the next request (see JwtStrategy); end its live sessions too
      if (dto.status === 'INACTIVE') {
        const users = await tx.user.findMany({ where: { company_id: id }, select: { id: true } });
        await tx.session.updateMany({ where: { user_id: { in: users.map((u) => u.id) }, revoked_at: null }, data: { revoked_at: new Date() } });
      }
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'COMPANY', entityId: id, entityCode: after.code, companyId: id, before, after });
      return after;
    });
  }

  /** Branches of one company, for the "Company - Data Upload" branch dropdown. */
  async branches(ctx: ReqCtx, companyId: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      if (!(await tx.company.findUnique({ where: { id: companyId }, select: { id: true } }))) throw notFound('Company');
      const rows = await tx.location.findMany({
        where: { company_id: companyId, type: 'BRANCH', status: 'ACTIVE' },
        select: { id: true, code: true, name: true, address: true },
        orderBy: { code: 'asc' },
      });
      return rows;
    });
  }

  /** A throwaway password for users who only sign in with OTP (kept so the column is never empty). */
  static randomPasswordHash() {
    return argon2.hash(randomBytes(24).toString('hex'));
  }
}

