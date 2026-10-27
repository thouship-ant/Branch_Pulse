import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Ctx, CurrentUser, AuthUser, Public, ReqCtx } from '../common/auth-user';
import { env } from '../config/env';
import { AuthService } from './auth.service';

class IdentifyDto {
  @IsString() @MaxLength(50) identifier: string;
}

class LoginDto {
  /** Super Admin username, or an Admin's 10-digit mobile number */
  @IsString() @MaxLength(50) username: string;
  @IsString() @MaxLength(200) password: string;
  @IsOptional() @IsIn(['mobile', 'desktop']) client?: 'mobile' | 'desktop';
  @IsOptional() @IsString() @MaxLength(80) deviceLabel?: string;
}

class OtpRequestDto {
  @Matches(/^\d{10}$/, { message: 'Enter a 10-digit mobile number' }) mobile: string;
}

class OtpVerifyDto {
  @Matches(/^\d{10}$/, { message: 'Enter a 10-digit mobile number' }) mobile: string;
  @Matches(/^\d{6}$/, { message: 'The OTP is 6 digits' }) otp: string;
  @IsOptional() @IsIn(['mobile', 'desktop']) client?: 'mobile' | 'desktop';
  @IsOptional() @IsString() @MaxLength(80) deviceLabel?: string;
}

const COOKIE = 'bp_refresh';

/** The mobile app has no cookie jar: it sends X-Client: native and gets the refresh token in the body instead. */
const isNative = (req: Request) => req.headers['x-client'] === 'native';
const withRefresh = (req: Request, c: { value: string }) => (isNative(req) ? { refreshToken: c.value } : {});
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

  private meta(req: Request & { requestId?: string }) {
    const rawIp = req.ip?.replace(/^::ffff:/, '');
    return {
      ip: rawIp && isIP(rawIp) ? rawIp : undefined,
      userAgent: req.headers['user-agent'],
      deviceId: typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'].slice(0, 64) : undefined,
      requestId: req.requestId ?? randomUUID(),
    };
  }

  /** Which steps the sign-in screen should show for this mobile number / username. */
  @Public()
  @Throttle({ default: { limit: env.loginRateLimit, ttl: 60_000 } })
  @Post('identify')
  @HttpCode(200)
  identify(@Body() dto: IdentifyDto) {
    return this.auth.identify(dto.identifier);
  }

  // login: 10 attempts / minute / IP (HLD s8); account lockout after 5 failures is in the service
  // Super Admin -> signed in. Admin -> { otpRequired: true } and an OTP is sent; verify it at /auth/otp/verify.
  @Public()
  @Throttle({ default: { limit: env.loginRateLimit, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request & { requestId?: string }, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, this.meta(req));
    if ('otpRequired' in result) return { otpRequired: true, mobile: result.mobile, resendInSeconds: env.otpResendSeconds };
    this.setCookie(res, result.tokens.refreshCookie);
    return { accessToken: result.tokens.accessToken, expiresIn: result.tokens.expiresIn, ...withRefresh(req, result.tokens.refreshCookie), user: await this.auth.me(result.user) };
  }

  /** OTP-only users: send the code to their mobile. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: OtpRequestDto, @Req() req: Request & { requestId?: string }) {
    return this.auth.requestOtp(dto.mobile, this.meta(req));
  }

  /** Last step for everyone who uses an OTP (Admin after the password, other users directly). */
  @Public()
  @Throttle({ default: { limit: env.loginRateLimit, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() dto: OtpVerifyDto, @Req() req: Request & { requestId?: string }, @Res({ passthrough: true }) res: Response) {
    const { tokens, user } = await this.auth.verifyOtp(dto.mobile, dto.otp, dto, this.meta(req));
    this.setCookie(res, tokens.refreshCookie);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, ...withRefresh(req, tokens.refreshCookie), user: await this.auth.me(user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawIp = req.ip?.replace(/^::ffff:/, '');
    const fromBody = isNative(req) && typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
    const r = await this.auth.refresh(req.cookies?.[COOKIE] ?? fromBody, { ip: rawIp && isIP(rawIp) ? rawIp : undefined });
    this.setCookie(res, r.refreshCookie);
    return { accessToken: r.accessToken, expiresIn: r.expiresIn, ...withRefresh(req, r.refreshCookie), user: await this.auth.me(r.user) };
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
