'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { LogoMark } from '@/components/Logo';
import { ErrorBox, TextField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function LoginPage() {
  const { t, lang, setLang } = useT();
  const { me, loading, login, isBranchUser } = useSession();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && me) router.replace(isBranchUser ? '/b/home' : '/dashboard');
  }, [loading, me, isBranchUser, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.isNetwork ? 'No internet connection' : err.code === 'ACCOUNT_LOCKED' ? 'Too many attempts. Try again in 15 minutes.' : err.message
          : 'Could not sign in',
      );
      setBusy(false); // only a failure re-enables the button; after a success it stays disabled until the redirect leaves the page
    }
  }

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
            <h2 className="text-2xl font-extrabold tracking-tight">{t('loginTitle')}</h2>
            <p className="mt-1 text-slate-600">{t('loginSub')}</p>
          </div>
          <form onSubmit={onSubmit} className="card space-y-4 p-5">
            <TextField id="username" label={t('username')} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <div>
              <label htmlFor="password" className="label">{t('password')}</label>
              <div className="relative">
                <input
                  id="password" className="field pr-12" type={show ? 'text' : 'password'} autoComplete="current-password"
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
            <button className="btn-primary w-full" disabled={busy || !username || !password}>{busy ? t('loading') : t('login')}</button>
          </form>
          <button className="mx-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100" onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}>
            <Icon name="globe" size={16} />{t('language')}
          </button>
        </div>
      </section>
    </main>
  );
}
