import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppException, notFound } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { AuthUser, ReqCtx } from '../common/auth-user';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config/env';
import { JwtStrategy } from './jwt.strategy';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface LoginInput {
  username: string;
  password: string;
  client?: 'mobile' | 'desktop';
  deviceLabel?: string;
}

export interface SessionTokens {
  accessToken: string;
  expiresIn: string;
  refreshCookie: { value: string; maxAgeMs: number };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly strategy: JwtStrategy,
  ) {}

  async login(input: LoginInput, meta: { ip?: string; userAgent?: string; deviceId?: string; requestId: string }) {
    const invalid = new AppException(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: input.username }, { mobile: input.username }] },
    });
    const ctxBase = { ip: meta.ip, userAgent: meta.userAgent, deviceId: meta.deviceId, requestId: meta.requestId };

    if (!user || user.status !== 'ACTIVE') {
      // burn comparable time so unknown users are not distinguishable by latency
      await argon2.hash(input.password).catch(() => undefined);
      await this.auditLoginFailure(null, input.username, ctxBase);
      throw invalid;
    }
    if (user.locked_until && user.locked_until > new Date()) {
      throw new AppException(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.', {
        lockedUntil: user.locked_until,
      });
    }

    const ok = await argon2.verify(user.password_hash, input.password).catch(() => false);
    if (!ok) {
      const failed = user.failed_logins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failed_logins: failed >= MAX_FAILED ? 0 : failed,
          locked_until: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await this.auditLoginFailure(user.id, input.username, ctxBase);
      throw invalid;
    }

    const tokens = await this.createSession(user.id, input, meta);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failed_logins: 0, locked_until: null, last_login_at: new Date() },
    });
    const authUser = (await this.strategy.loadAuthUser(user.id, tokens.sessionId))!;
    await this.prisma.$transaction((tx) =>
      this.audit.log(tx, { ...ctxBase, user: authUser, source: 'WEB' } as ReqCtx, {
        action: 'LOGIN',
        entityType: 'USER',
        entityId: user.id,
        entityCode: user.username,
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
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({ where: { id: sessionId, revoked_at: null }, data: { revoked_at: new Date() } });
      await this.audit.log(tx, ctx, { action: 'LOGOUT', entityType: 'USER', entityId: ctx.user.id, entityCode: ctx.user.username });
    });
  }

  async revokeUserSessions(userId: string, ctx: ReqCtx) {
    const res = await this.prisma.$transaction(async (tx) => {
      const r = await tx.session.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } });
      await this.audit.log(tx, ctx, { action: 'PERMISSION_CHANGE', entityType: 'USER', entityId: userId, reason: 'force logout' });
      return r;
    });
    return { revoked: res.count };
  }

  /** Profile with roles, permissions and the locations the caller may see (loaded under RLS). */
  async me(user: AuthUser) {
    const profile = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!profile) throw notFound('User');
    const locations = await this.prisma.runScoped(user, (tx) =>
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
      language: profile.preferred_language,
      roles: user.roles,
      permissions: user.permissions,
      allLocations: user.allLocations,
      locations,
    };
  }

  private async createSession(
    userId: string,
    input: LoginInput,
    meta: { ip?: string; userAgent?: string },
  ): Promise<SessionTokens & { sessionId: string }> {
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

  private async auditLoginFailure(
    userId: string | null,
    username: string,
    ctx: { ip?: string; userAgent?: string; deviceId?: string; requestId: string },
  ) {
    await this.prisma.auditLog.create({
      data: {
        actor_id: userId,
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
    });
  }
}
