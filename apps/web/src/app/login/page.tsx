'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { LogoMark } from '@/components/Logo';
import { ErrorBox, TextField } from '@/components/ui';
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
      setError(friendly(err));
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

  const points = [t('loginP1'), t('loginP2'), t('loginP3')];

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel: full height on desktop, a compact banner on a phone */}
      <section className="relative isolate flex flex-col justify-between overflow-hidden bg-gradient-to-br from-[#18236f] via-[#1e2a8a] to-[#2f3fb5] px-6 pb-16 pt-8 text-white lg:px-14 lg:py-14">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-indigo-300/20 blur-3xl" aria-hidden />
        <svg className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 w-full opacity-[0.16]" viewBox="0 0 800 160" preserveAspectRatio="none" aria-hidden>
          <path d="M0 100h190l24-64 40 118 28-78 14 24h504" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="flex items-center gap-3">
          <LogoMark size={44} />
          <span className="text-2xl font-extrabold tracking-tight">{t('appName')}</span>
        </div>
        <div className="mt-10 max-w-lg space-y-5 lg:mt-0">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight lg:text-5xl">{t('loginTagline')}</h1>
          <p className="hidden text-lg text-white/80 lg:block">{t('loginHero')}</p>
          <ul className="hidden space-y-3 lg:block">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-white/90">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20"><Icon name="check" size={14} strokeWidth={3} /></span>{p}
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-sm text-white/60 lg:block">© Branch Pulse</p>
      </section>

      {/* sign-in card overlaps the banner on a phone */}
      <section className="relative -mt-8 flex flex-col justify-center rounded-t-[28px] bg-[rgb(var(--slate-50))] px-6 pb-10 pt-8 lg:mt-0 lg:rounded-none lg:px-16">
        <div className="mx-auto w-full max-w-sm space-y-6">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">{step === 'otp' ? t('enterOtp') : t('loginTitle')}</h2>
            <p className="mt-1 text-slate-600">
              {step === 'otp' ? <>{t('otpSentTo')} <b className="tabular-nums">{isMobile ? `${id.slice(0, 2)}******${id.slice(-2)}` : id}</b></> : t('loginSub')}
            </p>
          </div>

          {step === 'id' && (
            <form onSubmit={onIdentify} className="card space-y-4 p-5">
              <TextField
                id="identifier" label={t('mobileOrUsername')} autoComplete="username" autoCapitalize="none" inputMode="tel" autoFocus
                value={identifier} onChange={(e) => setIdentifier(e.target.value.replace(/\s/g, ''))} required
              />
              <ErrorBox error={error} />
              <button className="btn-primary w-full" disabled={busy || !id}>{busy ? t('loading') : t('continueLabel')}</button>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={onPassword} className="card space-y-4 p-5">
              <div className="flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2 text-sm">
                <span className="truncate font-semibold tabular-nums">{id}</span>
                <button type="button" className="shrink-0 font-semibold text-brand" onClick={back}>{t('changeNumber')}</button>
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
              <ErrorBox error={error} />
              <button className="btn-primary w-full" disabled={busy || !password}>{busy ? t('loading') : method === 'PASSWORD' ? t('login') : t('continueLabel')}</button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={onOtp} className="card space-y-4 p-5">
              <div>
                <label htmlFor="otp" className="label">{t('otpLabel')}</label>
                <input
                  ref={otpRef} id="otp" className="field text-center text-2xl font-bold tracking-[0.5em] tabular-nums" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" required
                />
              </div>
              <ErrorBox error={error} />
              <button className="btn-primary w-full" disabled={busy || otp.length !== 6}>{busy ? t('loading') : t('verifyOtp')}</button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="font-semibold text-slate-600 hover:underline" onClick={back}>← {t('changeNumber')}</button>
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
