const isProd = process.env.NODE_ENV === 'production';

function required(name: string, devDefault?: string): string {
  const v = process.env[name] ?? (isProd ? undefined : devDefault);
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3300').split(',').map((s) => s.trim()),
  jwtSecret: required('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me-32chars'),
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTtlMobileHours: Number(process.env.REFRESH_TTL_MOBILE_HOURS ?? 168), // 7 days
  refreshTtlDesktopHours: Number(process.env.REFRESH_TTL_DESKTOP_HOURS ?? 12),
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT ?? 10), // per IP per minute (HLD s8)
  cookieSecure: (process.env.COOKIE_SECURE ?? String(isProd)) === 'true',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  // ---- OTP sign-in (company users). OTP_FIXED_CODE is for development only: every OTP is that code and no SMS is sent.
  otpFixedCode: process.env.OTP_FIXED_CODE || undefined,
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 10),
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
  otpResendSeconds: Number(process.env.OTP_RESEND_SECONDS ?? 30),
  // ---- SMS Fortius (DLT-registered OTP SMS). Without these the OTP is only written to the server log.
  sms: {
    apiKey: process.env.SMS_FORTIUS_API_KEY,
    senderId: process.env.SMS_FORTIUS_SENDER_ID,
    templateId: process.env.SMS_FORTIUS_TEMPLATE_ID,
    baseUrl: process.env.SMS_FORTIUS_BASE_URL,
    // must match the DLT-approved template text exactly; {otp} is replaced with the code
    otpTemplate: process.env.SMS_OTP_TEMPLATE ?? 'Your Branch Pulse OTP is {otp}. Valid for 10 minutes. Do not share it.',
  },
  // AES-256-GCM key for encrypting employee bank details at rest: 64 hex characters (32 bytes).
  bankDetailsKey: required('BANK_DETAILS_KEY', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
};

// A fixed OTP would let anyone sign in as anyone: refuse to run with it in production.
if (env.isProd && env.otpFixedCode && process.env.ALLOW_FIXED_OTP !== 'true') {
  throw new Error('OTP_FIXED_CODE must not be set in production (set ALLOW_FIXED_OTP=true only for a throwaway demo)');
}
