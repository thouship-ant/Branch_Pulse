'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && me) router.replace(isBranchUser ? '/b/home' : '/dashboard');
  }, [loading, me, isBranchUser, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-3xl text-white" aria-hidden>◉</div>
        <h1 className="text-2xl font-bold">{t('appName')}</h1>
      </div>
      <form onSubmit={onSubmit} className="card space-y-4">
        <TextField id="username" label={t('username')} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <TextField id="password" label={t('password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={busy || !username || !password}>{busy ? t('loading') : t('login')}</button>
      </form>
      <button className="text-sm text-slate-600 underline" onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}>{t('language')}</button>
    </main>
  );
}
