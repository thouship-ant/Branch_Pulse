import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Ctx, CurrentUser, AuthUser, Public, ReqCtx } from '../common/auth-user';
import { env } from '../config/env';
import { AuthService } from './auth.service';

class LoginDto {
  @IsString() @MaxLength(50) username: string;
  @IsString() @MaxLength(200) password: string;
  @IsOptional() @IsIn(['mobile', 'desktop']) client?: 'mobile' | 'desktop';
  @IsOptional() @IsString() @MaxLength(80) deviceLabel?: string;
}

const COOKIE = 'bp_refresh';
const COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setCookie(res: Response, c: { value: string; maxAgeMs: number }) {
    res.cookie(COOKIE, c.value, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: c.maxAgeMs,
    });
  }

  // login: 10 attempts / minute / IP (HLD s8); account lockout after 5 failures is in the service
  @Public()
  @Throttle({ default: { limit: env.loginRateLimit, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request & { requestId?: string }, @Res({ passthrough: true }) res: Response) {
    const rawIp = req.ip?.replace(/^::ffff:/, '');
    const { tokens, user } = await this.auth.login(dto, {
      ip: rawIp && isIP(rawIp) ? rawIp : undefined,
      userAgent: req.headers['user-agent'],
      deviceId: typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'].slice(0, 64) : undefined,
      requestId: req.requestId ?? randomUUID(),
    });
    this.setCookie(res, tokens.refreshCookie);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user: await this.auth.me(user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawIp = req.ip?.replace(/^::ffff:/, '');
    const r = await this.auth.refresh(req.cookies?.[COOKIE], { ip: rawIp && isIP(rawIp) ? rawIp : undefined });
    this.setCookie(res, r.refreshCookie);
    return { accessToken: r.accessToken, expiresIn: r.expiresIn, user: await this.auth.me(r.user) };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Ctx() ctx: ReqCtx, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx.user.sessionId, ctx);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    return { ok: true };
  }
}

@Controller()
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}
