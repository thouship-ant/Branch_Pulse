'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { OtpInput } from '@/components/OtpInput';
import { TextField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession, type SignInMethod } from '@/lib/session';

type Step = 'id' | 'password' | 'otp';
const RESEND_SECONDS = 30;

const friendly = (err: unknown) =>
  err instanceof ApiError
    ? err.isNetwork ? 'No internet connection' : err.code === 'ACCOUNT_LOCKED' ? 'Too many attempts. Try again in 15 minutes.' : err.message
    : err instanceof Error ? err.message : 'Could not sign in';

/**
 * Sign in: type the mobile number, then
 *   - Super Admin (username)      -> password
 *   - Admin                       -> password, then an OTP
 *   - everyone else               -> an OTP
 */
export default function LoginPage() {
  const { t, lang, setLang } = useT();
  const { me, loading, identify, loginWithPassword, requestOtp, verifyOtp, isBranchUser } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>('id');
  const [method, setMethod] = useState<SignInMethod>('OTP');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0); // seconds until "Resend OTP" works
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loading || !me) return;
    router.replace(me.isSuper ? '/super' : isBranchUser ? '/b/home' : '/dashboard');
  }, [loading, me, isBranchUser, router]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  useEffect(() => { if (step === 'otp') otpRef.current?.focus(); }, [step]);

  const id = identifier.trim();
  const isMobile = /^\d{10}$/.test(id);

  /**
   * Run one step. A failure re-enables the form. When the step signs the user in (fn returns true) the form stays disabled
   * until the redirect leaves the page, so it cannot be submitted twice.
   */
  async function run(fn: () => Promise<boolean | void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const signedIn = await fn();
      if (!signedIn) setBusy(false);
    } catch (err) {
      // "wait 30 seconds before another OTP" is not an error to read: the button simply counts down
      if (err instanceof ApiError && err.code === 'OTP_TOO_SOON') setWait(Number(/(\d+)\s*second/.exec(err.message)?.[1]) || RESEND_SECONDS);
      else setError(friendly(err));
      setBusy(false);
    }
  }

  const onIdentify = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const m = await identify(id);
      setMethod(m);
      if (m === 'OTP') {
        if (!isMobile) throw new Error('Enter your 10-digit mobile number');
        await requestOtp(id);
        setWait(RESEND_SECONDS);
        setStep('otp');
      } else setStep('password');
    });
  };

  const onPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await loginWithPassword(id, password);
      if (r === 'OTP_SENT') { setWait(RESEND_SECONDS); setOtp(''); setStep('otp'); return false; }
      return true; // Super Admin: signed in
    });
  };

  const onOtp = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => { await verifyOtp(id, otp); return true; });
  };

  const resend = () =>
    run(async () => {
      if (method === 'PASSWORD_OTP') await loginWithPassword(id, password); // sends a fresh OTP after re-checking the password
      else await requestOtp(id);
      setOtp('');
      setWait(RESEND_SECONDS);
    });

  const back = () => { setStep('id'); setPassword(''); setOtp(''); setError(null); setWait(0); };

  // shown right under the button of the step that failed (no pop-up); announced to screen readers
  const inlineError = error ? (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium leading-snug text-red-700">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      <span className="whitespace-pre-line">{error}</span>
    </p>
  ) : null;

  return (
    <main className="app-background loginBackdrop tea-shop flex min-h-dvh items-center justify-center overflow-x-hidden px-4 py-8">
      <section className="w-full max-w-md rounded-[28px] border border-white/60 bg-surface/95 px-6 py-8 shadow-2xl backdrop-blur-md sm:px-8">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">{step === 'otp' ? t('enterOtp') : t('loginTitle')}</h2>
            <p className="mt-1 text-slate-600">
              {step === 'otp' ? <>{t('otpSentTo')} <b className="tabular-nums">{isMobile ? `+91 ${id.slice(0, 2)}******${id.slice(-2)}` : id}</b></> : t('loginSub')}
            </p>
          </div>

          {step === 'id' && (
            <form onSubmit={onIdentify} className="card space-y-4 p-5">
              <TextField
                id="identifier" label={t('mobileOrUsername')} autoComplete="username" autoCapitalize="none" inputMode="tel" autoFocus
                value={identifier} onChange={(e) => { const v = e.target.value.replace(/\s/g, ''); setIdentifier(/^\d/.test(v) ? v.replace(/\D/g, '').slice(0, 10) : v); }} required
                prefix={!identifier || /^\d/.test(identifier) ? '+91' : undefined}
              />
              <button className="btn-primary w-full" disabled={busy || !id || wait > 0}>{busy ? t('loading') : wait > 0 ? `${t('resendIn')} ${wait}s` : t('continueLabel')}</button>
              {inlineError}
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={onPassword} className="card space-y-4 p-5">
              <div className="flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2 text-sm">
                <span className="truncate font-semibold tabular-nums">{isMobile ? `+91 ${id}` : id}</span>
                <button type="button" className="shrink-0 rounded-full px-3 py-1 text-sm font-semibold text-brand transition hover:bg-brand-light" onClick={back}>{t('changeNumber')}</button>
              </div>
              <div>
                <label htmlFor="password" className="label">{t('password')}{method === 'PASSWORD' ? ` · ${t('superAdminHint')}` : ''}</label>
                <div className="relative">
                  <input
                    id="password" className="field pr-12" type={show ? 'text' : 'password'} autoComplete="current-password" autoFocus
                    value={password} onChange={(e) => setPassword(e.target.value)} required
                  />
                  <button
                    type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('hidePassword') : t('showPassword')} aria-pressed={show}
                    className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink"
                  >
                    <Icon name={show ? 'eyeOff' : 'eye'} size={19} />
                  </button>
                </div>
              </div>
              <button className="btn-primary w-full" disabled={busy || !password || wait > 0}>{busy ? t('loading') : wait > 0 ? `${t('resendIn')} ${wait}s` : method === 'PASSWORD' ? t('login') : t('continueLabel')}</button>
              {inlineError}
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={onOtp} className="card space-y-4 p-5">
              <div>
                <label className="label mb-2 block">{t('otpLabel')}</label>
                <OtpInput value={otp} onChange={setOtp} autoFocus />
              </div>
              <button className="btn-primary w-full" disabled={busy || otp.length !== 6}>{busy ? t('loading') : t('verifyOtp')}</button>
              {inlineError}
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="-ml-3 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100" onClick={back}><Icon name="chevronLeft" size={16} />{t('changeNumber')}</button>
                <button type="button" className="font-semibold text-brand disabled:text-slate-400" disabled={busy || wait > 0} onClick={() => void resend()}>
                  {wait > 0 ? `${t('resendIn')} ${wait}s` : t('resendOtp')}
                </button>
              </div>
            </form>
          )}

          <button className="mx-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100" onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}>
            <Icon name="globe" size={16} />{t('language')}
          </button>
        </div>
      </section>
    </main>
  );
}
