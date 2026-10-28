import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { generateTempPassword } from '../auth/passwords';
import { SmsService } from '../auth/sms.service';
import { AppException, notFound } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config/env';

export class SuperUpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) fullName?: string;
  /** the mobile number is also the sign-in name and where OTPs / temporary passwords go */
  @IsOptional() @Matches(/^\d{10}$/, { message: 'Mobile must be 10 digits' }) mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

/** Super Admin: look after any company's users - change their details and mobile number, reset their password. */
@Injectable()
export class SuperUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
  ) {}

  private view(u: any) {
    return {
      id: u.id, fullName: u.full_name, username: u.username, mobile: u.mobile, email: u.email, status: u.status,
      roles: u.roles.map((r: any) => r.role.code), lastLoginAt: u.last_login_at, mustChangePassword: u.must_change_password,
      locations: u.locations?.map((l: any) => l.location?.name).filter(Boolean) ?? [],
    };
  }

  async list(ctx: ReqCtx, companyId: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      if (!(await tx.company.findUnique({ where: { id: companyId }, select: { id: true } }))) throw notFound('Company');
      const users = await tx.user.findMany({
        where: { company_id: companyId },
        include: { roles: { include: { role: true } } },
        orderBy: [{ created_at: 'asc' }],
      });
      const locs = await tx.userLocation.findMany({ where: { user_id: { in: users.map((u) => u.id) } }, select: { user_id: true, location_id: true } });
      const names = new Map((await tx.location.findMany({ where: { company_id: companyId }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
      const order = ['ADMIN', 'ACCOUNTANT', 'STOCK_MANAGER', 'BRANCH_MANAGER', 'STAFF'];
      const rank = (roles: string[]) => { const i = order.findIndex((c) => roles.includes(c)); return i < 0 ? order.length : i; };
      return users
        .map((u) => ({ ...this.view({ ...u, locations: [] }), locations: locs.filter((l) => l.user_id === u.id).map((l) => names.get(l.location_id)).filter(Boolean) as string[] }))
        .sort((a, b) => rank(a.roles) - rank(b.roles) || a.fullName.localeCompare(b.fullName));
    });
  }

  async update(ctx: ReqCtx, id: string, dto: SuperUpdateUserDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
      if (!before || !before.company_id) throw notFound('User'); // the Super Admin's own account is not edited here
      const mobileChanged = !!dto.mobile && dto.mobile !== before.mobile;
      if (mobileChanged) {
        const taken = await tx.user.findFirst({ where: { id: { not: id }, OR: [{ mobile: dto.mobile }, { username: dto.mobile }] }, select: { id: true } });
        if (taken) throw new AppException(409, 'DUPLICATE', 'This mobile number is already registered');
      }
      const after = await tx.user.update({
        where: { id },
        data: {
          full_name: dto.fullName?.trim(), email: dto.email?.trim().toLowerCase(), status: dto.status, mobile: dto.mobile,
          // the mobile is the sign-in name
          username: mobileChanged && before.username === before.mobile ? dto.mobile : undefined,
          updated_by: ctx.user.id, version: { increment: 1 },
        },
        include: { roles: { include: { role: true } } },
      });
      // a changed number or a disabled account ends live sessions; OTPs requested for the old number can no longer be used
      if (mobileChanged || dto.status === 'INACTIVE') {
        await tx.session.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
      }
      await this.audit.log(tx, ctx, {
        action: 'UPDATE', entityType: 'USER', entityId: id, entityCode: after.username, companyId: before.company_id,
        before: { fullName: before.full_name, mobile: before.mobile, email: before.email, status: before.status },
        after: { fullName: after.full_name, mobile: after.mobile, email: after.email, status: after.status },
      });
      return this.view({ ...after, locations: [] });
    });
  }

  /**
   * Gives the user a new random temporary password, texts it to their mobile and makes them change it at the next sign-in.
   * In development (SMS gateway not configured) the password is also returned so the flow can be tried.
   */
  async resetPassword(ctx: ReqCtx, id: string) {
    const temp = generateTempPassword();
    const hash = await argon2.hash(temp);
    const user = await this.prisma.runScoped(ctx.user, async (tx) => {
      const u = await tx.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
      if (!u || !u.company_id) throw notFound('User');
      if (!u.mobile) throw new AppException(422, 'NO_MOBILE', 'This user has no mobile number to send the password to. Add one first.');
      await tx.user.update({
        where: { id },
        data: { password_hash: hash, must_change_password: true, failed_logins: 0, locked_until: null, updated_by: ctx.user.id, version: { increment: 1 } },
      });
      await tx.session.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
      await this.audit.log(tx, ctx, {
        action: 'UPDATE', entityType: 'USER', entityId: id, entityCode: u.username, companyId: u.company_id,
        reason: 'Password reset by Super Admin', after: { passwordReset: true },
      });
      return u;
    });

    let sent = false;
    try {
      sent = await this.sms.sendTempPassword(user.mobile!, temp);
    } catch {
      throw new AppException(502, 'SMS_FAILED', 'The password was reset but the SMS could not be sent. Try the reset again.');
    }
    const masked = `${user.mobile!.slice(0, 2)}******${user.mobile!.slice(-2)}`;
    return { sent, mobile: masked, ...(!sent && !env.isProd ? { tempPassword: temp } : {}) };
  }
}
