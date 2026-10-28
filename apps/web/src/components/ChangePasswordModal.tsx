'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { PasswordChecklist } from './PasswordChecklist';
import { ErrorBox, Sheet } from './ui';
import { api, ApiError } from '@/lib/api';
import { passwordOk } from '@/lib/password';
import { useSession } from '@/lib/session';

const skipKey = (id: string) => `bp_pw_later_${id}`;

/**
 * Shown right after sign-in while the account still has the default / temporary password. Submit saves the new
 * password; Cancel hides the prompt for this browser session (it comes back at the next sign-in).
 */
export function ChangePasswordModal() {
  const { me, passwordChanged } = useSession();
  const [skipped, setSkipped] = useState(true);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!me) return;
    try { setSkipped(sessionStorage.getItem(skipKey(me.id)) === '1'); } catch { setSkipped(false); }
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me || (!me.mustChangePassword && !done) || (skipped && !done)) return null;

  const mismatch = confirm.length > 0 && pw !== confirm;
  const ready = passwordOk(pw) && pw === confirm;

  function cancel() {
    try { sessionStorage.setItem(skipKey(me!.id), '1'); } catch { /* private mode */ }
    setSkipped(true);
  }

  async function submit() {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      await api.post('/auth/change-password', { newPassword: pw, confirmPassword: confirm });
      setDone(true);
      passwordChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the password');
    } finally { setBusy(false); }
  }

  return (
    <Sheet open onClose={done ? () => setDone(false) : cancel} title={done ? 'Password changed' : 'Change your password'}>
      {done ? (
        <div className="space-y-4">
          <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800">✓ Your new password is saved. Use it the next time you sign in with a password.</p>
          <button className="btn-primary w-full" onClick={() => setDone(false)}>Done</button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <p className="text-sm text-slate-700">You are using a default password. Choose your own to keep your account safe.</p>
          <div>
            <label htmlFor="cp-new" className="label">New Password</label>
            <div className="relative">
              <input id="cp-new" className="field pr-12" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
              <button
                type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
                className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink"
              >
                <Icon name={show ? 'eyeOff' : 'eye'} size={19} />
              </button>
            </div>
          </div>
          <PasswordChecklist value={pw} />
          <div>
            <label htmlFor="cp-confirm" className="label">Confirm Password</label>
            <input id="cp-confirm" className="field" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch || undefined} />
            {mismatch && <p role="alert" className="mt-1 text-sm text-red-700">Passwords do not match</p>}
          </div>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={cancel} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!ready || busy}>{busy ? 'Saving…' : 'Submit'}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
