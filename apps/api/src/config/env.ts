const isProd = process.env.NODE_ENV === 'production';

function required(name: string, devDefault?: string): string {
  const v = process.env[name] ?? (isProd ? undefined : devDefault);
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  jwtSecret: required('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me-32chars'),
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTtlMobileHours: Number(process.env.REFRESH_TTL_MOBILE_HOURS ?? 168), // 7 days
  refreshTtlDesktopHours: Number(process.env.REFRESH_TTL_DESKTOP_HOURS ?? 12),
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT ?? 10), // per IP per minute (HLD s8)
  cookieSecure: (process.env.COOKIE_SECURE ?? String(isProd)) === 'true',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  // AES-256-GCM key for encrypting employee bank details at rest: 64 hex characters (32 bytes).
  bankDetailsKey: required('BANK_DETAILS_KEY', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
};
