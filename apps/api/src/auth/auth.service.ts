import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { AppException, notFound } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { AuthUser, ReqCtx } from '../common/auth-user';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config/env';
import { JwtStrategy } from './jwt.strategy';
import { SmsService } from './sms.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const otpHash = (mobile: string, code: string) => sha256(`${env.jwtSecret}|${mobile}|${code}`);
const isMobile = (v: string) => /^\d{10}$/.test(v);

/**
 * How a person signs in, by who they are:
 *   PASSWORD      Super Admin: username + password, nothing else
 *   PASSWORD_OTP  Admin: mobile + password, then an OTP sent to the mobile
 *   OTP           every other company user: mobile + OTP
 */
export type SignInMethod = 'PASSWORD' | 'PASSWORD_OTP' | 'OTP';

export interface ClientInfo {
  client?: 'mobile' | 'desktop';
  deviceLabel?: string;
}

export interface LoginInput extends ClientInfo {
  username: string;
  password: string;
}

export interface SessionTokens {
  accessToken: string;
  expiresIn: string;
  refreshCookie: { value: string; maxAgeMs: number };
}

type Meta = { ip?: string; userAgent?: string; deviceId?: string; requestId: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly strategy: JwtStrategy,
    private readonly sms: SmsService,
  ) {}

  // ------------------------------------------------------------------ who is signing in
  private findUser(identifier: string) {
    return this.prisma.runAuth((tx) =>
      tx.user.findFirst({
        where: { OR: [{ username: identifier }, { mobile: identifier }] },
        include: { roles: { include: { role: true } } },
      }),
    );
  }

  /**
   * Tells the sign-in screen which steps to show. Unknown numbers get the plain OTP answer, so it cannot be used to
   * discover who has an account.
   */
  async identify(identifier: string): Promise<{ method: SignInMethod }> {
    const user = await this.findUser(identifier.trim());
    const codes = user?.roles.map((r) => r.role.code) ?? [];
    if (codes.includes('SUPER_ADMIN')) return { method: 'PASSWORD' };
    if (codes.includes('ADMIN')) return { method: 'PASSWORD_OTP' };
    return { method: 'OTP' };
  }

  // ------------------------------------------------------------------ password step
  /**
   * Super Admin: signs in. Admin: the password is checked and an OTP is sent (no session yet).
   * Everyone else must use OTP only.
   */
  async login(input: LoginInput, meta: Meta): Promise<{ tokens: SessionTokens & { sessionId: string }; user: AuthUser } | { otpRequired: true; mobile: string }> {
    const invalid = new AppException(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
    const user = await this.findUser(input.username.trim());

    if (!user || user.status !== 'ACTIVE') {
      // burn comparable time so unknown users are not distinguishable by latency
      await argon2.hash(input.password).catch(() => undefined);
      await this.auditLoginFailure(null, input.username, meta, null);
      throw invalid;
    }
    if (user.locked_until && user.locked_until > new Date()) {
      throw new AppException(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.', { lockedUntil: user.locked_until });
    }

    const codes = user.roles.map((r) => r.role.code);
    const isSuper = codes.includes('SUPER_ADMIN');
    const isAdmin = codes.includes('ADMIN');
    if (!isSuper && !isAdmin) {
      // other users have no password sign-in: same answer as a wrong password
      await argon2.hash(input.password).catch(() => undefined);
      throw invalid;
    }

    const ok = await argon2.verify(user.password_hash, input.password).catch(() => false);
    if (!ok) {
      await this.recordFailure(user.id, user.failed_logins, user.company_id);
      await this.auditLoginFailure(user.id, input.username, meta, user.company_id);
      throw invalid;
    }

    if (isSuper) {
      return this.startSession(user.id, input, meta);
    }
    // Admin: password accepted, now the OTP
    if (!user.mobile) throw new AppException(400, 'NO_MOBILE', 'This account has no mobile number for the OTP. Ask the Super Admin to add one.');
    await this.issueOtp(user.mobile, true, meta.ip);
    return { otpRequired: true, mobile: user.mobile };
  }

  private async recordFailure(userId: string, failedSoFar: number, companyId: string | null) {
    const failed = failedSoFar + 1;
    await this.prisma.runAuth((tx) =>
      tx.user.update({
        where: { id: userId },
        data: { failed_logins: failed >= MAX_FAILED ? 0 : failed, locked_until: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      }),
    );
    void companyId;
  }

  // ------------------------------------------------------------------ OTP
  /**
   * Creates and sends a one-time code. `passwordOk` marks an Admin who already passed the password step; an OTP asked for
   * directly (passwordOk=false) can never complete an Admin sign-in.
   */
  private async issueOtp(mobile: string, passwordOk: boolean, ip?: string) {
    const last = await this.prisma.runAuth((tx) => tx.otpCode.findFirst({ where: { mobile }, orderBy: { created_at: 'desc' } }));
    if (last && Date.now() - last.created_at.getTime() < env.otpResendSeconds * 1000) {
      throw new AppException(429, 'OTP_TOO_SOON', `Please wait ${env.otpResendSeconds} seconds before asking for another OTP`);
    }
    const code = env.otpFixedCode ?? String(randomInt(100000, 1000000));
    await this.prisma.runAuth((tx) =>
      tx.otpCode.create({
        data: { mobile, code_hash: otpHash(mobile, code), password_ok: passwordOk, expires_at: new Date(Date.now() + env.otpTtlMinutes * 60_000), ip: ip ?? null },
      }),
    );
    if (!env.otpFixedCode) {
      await this.sms.sendOtp(mobile, code).catch(() => {
        throw new AppException(502, 'SMS_FAILED', 'Could not send the OTP right now. Please try again.');
      });
    }
  }

  /** OTP-only users: send the code. Always answers the same, whether or not the number is registered or may use OTP alone. */
  async requestOtp(mobile: string, meta: { ip?: string }) {
    if (!isMobile(mobile)) throw new AppException(400, 'INVALID_MOBILE', 'Enter a 10-digit mobile number');
    const user = await this.findUser(mobile);
    const codes = user?.roles.map((r) => r.role.code) ?? [];
    if (user && user.status === 'ACTIVE' && !codes.includes('ADMIN') && !codes.includes('SUPER_ADMIN')) {
      await this.issueOtp(mobile, false, meta.ip);
    }
    return { sent: true, resendInSeconds: env.otpResendSeconds };
  }

  /** Second step: check the code and open the session. */
  async verifyOtp(mobile: string, code: string, client: ClientInfo, meta: Meta) {
    const invalid = new AppException(401, 'INVALID_OTP', 'That OTP is wrong or has expired');
    const user = await this.findUser(mobile);
    const row = await this.prisma.runAuth((tx) =>
      tx.otpCode.findFirst({ where: { mobile, consumed_at: null, expires_at: { gt: new Date() } }, orderBy: { created_at: 'desc' } }),
    );
    if (!user || user.status !== 'ACTIVE' || !row || row.attempts >= env.otpMaxAttempts) {
      await this.auditLoginFailure(user?.id ?? null, mobile, meta, user?.company_id ?? null);
      throw invalid;
    }

    const presented = Buffer.from(otpHash(mobile, code));
    const stored = Buffer.from(row.code_hash);
    const match = presented.length === stored.length && timingSafeEqual(presented, stored);
    const needsPassword = user.roles.some((r) => r.role.code === 'ADMIN');
    if (!match || (needsPassword && !row.password_ok)) {
      await this.prisma.runAuth((tx) => tx.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } }));
      await this.auditLoginFailure(user.id, mobile, meta, user.company_id);
      throw invalid;
    }
    await this.prisma.runAuth((tx) => tx.otpCode.update({ where: { id: row.id }, data: { consumed_at: new Date() } }));
    return this.startSession(user.id, client, meta);
  }

  // ------------------------------------------------------------------ session
  private async startSession(userId: string, client: ClientInfo, meta: Meta) {
    const tokens = await this.createSession(userId, client, meta);
    const authUser = (await this.strategy.loadAuthUser(userId, tokens.sessionId))!;
    if (!authUser) throw new AppException(403, 'COMPANY_INACTIVE', 'This account or its company is not active');
    await this.prisma.runAuth((tx) => tx.user.update({ where: { id: userId }, data: { failed_logins: 0, locked_until: null, last_login_at: new Date() } }));
    await this.prisma.runScoped({ all: true, locationIds: [], companyId: authUser.companyId, isSuper: authUser.isSuper }, (tx) =>
      this.audit.log(tx, { ...meta, user: authUser, source: 'WEB' } as ReqCtx, {
        action: 'LOGIN', entityType: 'USER', entityId: userId, entityCode: authUser.username,
      }),
    );
    return { tokens, user: authUser };
  }

  async refresh(cookie: string | undefined, meta: { ip?: string; userAgent?: string }) {
    const bad = new AppException(401, 'INVALID_REFRESH', 'Session expired, please sign in again');
    const [sessionId, token] = (cookie ?? '').split('.');
    if (!sessionId || !token) throw bad;

    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.revoked_at || session.expires_at < new Date()) throw bad;

    const presented = Buffer.from(sha256(token));
    const stored = Buffer.from(session.refresh_token_hash);
    if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
      // a stale token for a live session means it was replayed after rotation: kill the session
      await this.prisma.session.update({ where: { id: sessionId }, data: { revoked_at: new Date() } });
      throw bad;
    }

    const ttlMs = (session.device_label?.startsWith('desktop:') ? env.refreshTtlDesktopHours : env.refreshTtlMobileHours) * 3_600_000;
    const next = randomBytes(48).toString('base64url');
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { refresh_token_hash: sha256(next), expires_at: new Date(Date.now() + ttlMs), ip: meta.ip ?? session.ip },
    });
    const user = await this.strategy.loadAuthUser(session.user_id, sessionId);
    if (!user) throw bad;
    return {
      accessToken: await this.signAccess(session.user_id, sessionId),
      expiresIn: env.accessTtl,
      refreshCookie: { value: `${sessionId}.${next}`, maxAgeMs: ttlMs },
      user,
    };
  }

  async logout(sessionId: string, ctx: ReqCtx) {
    await this.prisma.runCurrent(async (tx) => {
      await tx.session.updateMany({ where: { id: sessionId, revoked_at: null }, data: { revoked_at: new Date() } });
      await this.audit.log(tx, ctx, { action: 'LOGOUT', entityType: 'USER', entityId: ctx.user.id, entityCode: ctx.user.username });
    });
  }

  async revokeUserSessions(userId: string, ctx: ReqCtx) {
    const res = await this.prisma.runCurrent(async (tx) => {
      const r = await tx.session.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } });
      await this.audit.log(tx, ctx, { action: 'PERMISSION_CHANGE', entityType: 'USER', entityId: userId, reason: 'force logout' });
      return r;
    });
    return { revoked: res.count };
  }

  /** Profile with roles, permissions, the company and the locations the caller may see (loaded under RLS). */
  async me(user: AuthUser) {
    const profile = await this.prisma.runAuth((tx) => tx.user.findUnique({ where: { id: user.id } }));
    if (!profile) throw notFound('User');
    const company = user.companyId
      ? await this.prisma.runAuth((tx) => tx.company.findUnique({ where: { id: user.companyId! }, select: { id: true, code: true, name: true } }))
      : null;
    const locations = user.isSuper
      ? []
      : await this.prisma.runScoped(user, (tx) =>
          tx.location.findMany({
            where: { status: 'ACTIVE' },
            select: { id: true, code: true, name: true, name_ta: true, type: true, card_enabled: true, default_opening_cash: true },
            orderBy: { code: 'asc' },
          }),
        );
    return {
      id: user.id,
      username: user.username,
      fullName: profile.full_name,
      mobile: profile.mobile,
      language: profile.preferred_language,
      roles: user.roles,
      permissions: user.permissions,
      allLocations: user.allLocations,
      isSuper: user.isSuper,
      company,
      locations,
    };
  }

  private async createSession(userId: string, input: ClientInfo, meta: { ip?: string; userAgent?: string }): Promise<SessionTokens & { sessionId: string }> {
    const desktop = input.client === 'desktop';
    const ttlMs = (desktop ? env.refreshTtlDesktopHours : env.refreshTtlMobileHours) * 3_600_000;
    const token = randomBytes(48).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        user_id: userId,
        refresh_token_hash: sha256(token),
        device_label: `${desktop ? 'desktop' : 'mobile'}:${(input.deviceLabel ?? '').slice(0, 80)}`,
        user_agent: meta.userAgent?.slice(0, 300),
        ip: meta.ip,
        expires_at: new Date(Date.now() + ttlMs),
      },
    });
    return {
      sessionId: session.id,
      accessToken: await this.signAccess(userId, session.id),
      expiresIn: env.accessTtl,
      refreshCookie: { value: `${session.id}.${token}`, maxAgeMs: ttlMs },
    };
  }

  private signAccess(userId: string, sessionId: string) {
    return this.jwt.signAsync({ sub: userId, sid: sessionId });
  }

  private async auditLoginFailure(userId: string | null, username: string, ctx: { ip?: string; userAgent?: string; deviceId?: string; requestId: string }, companyId: string | null) {
    await this.prisma.runAuth((tx) =>
      tx.auditLog.create({
        data: {
          actor_id: userId,
          company_id: companyId,
          action: 'LOGIN_FAILED',
          entity_type: 'USER',
          entity_id: userId,
          entity_code: username.slice(0, 40),
          request_id: ctx.requestId,
          ip: ctx.ip ?? null,
          user_agent: ctx.userAgent?.slice(0, 300) ?? null,
          device_id: ctx.deviceId ?? null,
          source: 'WEB',
          changed_fields: [],
        },
      }),
    );
  }
}
