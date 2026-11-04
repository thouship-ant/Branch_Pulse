'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../Icon';
import { PasswordChecklist } from '../PasswordChecklist';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { passwordOk } from '@/lib/password';
import { useT } from '@/lib/i18n';
import { ActiveChip, ErrorBox, Sheet, Skeleton, TextField } from '../ui';

interface UserRow {
  id: string; username: string; fullName: string; mobile: string | null; email: string | null;
  status: string; lastLoginAt: string | null; roles: string[]; locationIds: string[];
}
interface RoleRow { id: string; code: string; name: string; scopeMode: string; status: string }
interface Loc { id: string; code: string; name: string; nameTa: string | null }
interface Draft {
  id?: string; username: string; fullName: string; mobile: string; email: string; password: string;
  roleCodes: string[]; locationIds: string[]; active: boolean;
}

const emptyDraft: Draft = { username: '', fullName: '', mobile: '', email: '', password: '', roleCodes: [], locationIds: [], active: true };

/** Owner: create logins, assign roles and branches, reset passwords, sign a user out everywhere. */
export function UsersManager() {
  const { t, pick } = useT();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [locs, setLocs] = useState<Loc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, r, l] = await Promise.all([api.get('/users'), api.get('/roles'), api.get('/locations')]);
      setUsers(u); setRoles(r); setLocs(l); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fromUser = (u: UserRow): Draft => ({
    id: u.id, username: u.username, fullName: u.fullName, mobile: u.mobile ?? '', email: u.email ?? '',
    password: '', roleCodes: u.roles, locationIds: u.locationIds, active: u.status === 'ACTIVE',
  });

  function toggleRole(code: string) {
    if (!draft) return;
    setDraft({ ...draft, roleCodes: draft.roleCodes.includes(code) ? draft.roleCodes.filter((c) => c !== code) : [...draft.roleCodes, code] });
  }
  function toggleLocation(id: string) {
    if (!draft) return;
    setDraft({ ...draft, locationIds: draft.locationIds.includes(id) ? draft.locationIds.filter((l) => l !== id) : [...draft.locationIds, id] });
  }

  const [nameTouched, setNameTouched] = useState(false);

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const common = { fullName: draft.fullName.trim(), mobile: draft.mobile.trim(), email: draft.email.trim() || undefined, roleCodes: draft.roleCodes, locationIds: draft.locationIds };
      // blank = the role's default password (Admin@1234, Account@1234 ...); every user changes it at the first sign-in
      const password = draft.roleCodes.includes('ADMIN') ? draft.password || undefined : undefined; // only Admins sign in with a password
      if (draft.id) {
        await api.patch(`/users/${draft.id}`, { ...common, active: undefined, status: draft.active ? 'ACTIVE' : 'INACTIVE', password });
      } else {
        await api.post('/users', { ...common, password });
      }
      setDraft(null);
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save');
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true);
    try { await api.post(`/users/${id}/sessions/revoke`); setNotice(t('sessionsRevoked')); setTimeout(() => setNotice(null), 3000); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!users) return error ? <ErrorBox error={error} /> : <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">{t('roleCodesLabel')} · {t('branchesAssignedLabel')}</p>
        <button className="btn-primary" onClick={() => { setFormError(null); setNameTouched(false); setDraft({ ...emptyDraft }); }}>+ {t('addUser')}</button>
      </div>
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {users.length === 0 ? <p className="card text-sm text-slate-500">{t('noUsers')}</p> : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {users.map((u) => {
            const where = u.locationIds.map((id) => { const l = locs.find((x) => x.id === id); return l ? pick(l.name, l.nameTa) : id; }).join(', ');
            return (
              <li key={u.id} className="flex">
                {/* the whole card opens the user (edit, sign out everywhere) - same as the mobile app's list */}
                <button
                  type="button" onClick={() => { setFormError(null); setNameTouched(false); setDraft(fromUser(u)); }}
                  className={`card flex h-full w-full items-stretch gap-3 text-left transition duration-200 hover:-translate-y-px hover:border-brand/40 hover:shadow-lg ${u.status !== 'ACTIVE' ? 'opacity-70' : ''}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="block truncate text-base font-bold">{u.fullName}</span>
                    <span className="block text-sm text-slate-600">{u.roles.map((c) => roles.find((r) => r.code === c)?.name ?? c).join(', ')} · <span className="tabular-nums">{u.mobile ?? u.username}</span></span>
                    {where && <span className="block text-sm text-slate-600">{where}</span>}
                    <span className="mt-auto block pt-1 text-sm text-slate-500">{u.lastLoginAt ? `${t('lastSignIn')} ${prettyDate(u.lastLoginAt.slice(0, 10))}` : t('neverSignedIn')}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 self-center">
                    <ActiveChip active={u.status === 'ACTIVE'} />
                    <Icon name="chevronRight" size={20} className="text-slate-400" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {draft && (
        <Sheet open onClose={() => setDraft(null)} title={draft.id ? t('editUser') : t('addUser')}>
            <div className="space-y-4">
              <div className="grid items-end gap-3 sm:grid-cols-2">
                <div>
                  <TextField id="ufn" label={`${t('fullName')} *`} required aria-required="true" aria-invalid={nameTouched && !draft.fullName.trim()} value={draft.fullName} onBlur={() => setNameTouched(true)} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} maxLength={100} className={nameTouched && !draft.fullName.trim() ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''} />
                  {nameTouched && !draft.fullName.trim() && <p role="alert" className="mt-1 text-xs font-medium text-red-700">Full name is required</p>}
                </div>
                <TextField
                  id="umo" label={`${t('mobile')} *`} hint="This is the sign-in name; the OTP is sent to it." inputMode="numeric" value={draft.mobile} placeholder="10 digits"
                  onChange={(e) => setDraft({ ...draft, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                />
                {draft.roleCodes.includes('ADMIN') && (
                <div>
                  <TextField
                    id="upw" label={t('passwordNew')} type="password" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    hint={draft.id ? `Leave blank to keep the current password (${t('useDefault')}).` : 'Optional. Leave blank to use the role default; the user must change it at the first sign-in.'}
                  />
                  {draft.password && <div className="mt-1"><PasswordChecklist value={draft.password} /></div>}
                </div>
                )}
                <TextField id="uem" label="Email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </div>
              <div>
                <span className="label">{t('roleCodesLabel')}</span>
                <div className="flex flex-wrap gap-2">
                  {roles.filter((r) => r.status === 'ACTIVE').map((r) => (
                    <button key={r.code} type="button" onClick={() => toggleRole(r.code)}
                      className={`min-h-[36px] rounded-full border px-3 text-sm font-semibold ${draft.roleCodes.includes(r.code) ? 'border-transparent bg-brand text-white' : 'border-slate-300 text-ink hover:bg-slate-50'}`}>
                      {draft.roleCodes.includes(r.code) && '✓ '}{r.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="label">{t('branchesAssignedLabel')}</span>
                <div className="flex flex-wrap gap-2">
                  {locs.map((l) => (
                    <button key={l.id} type="button" onClick={() => toggleLocation(l.id)}
                      className={`min-h-[36px] rounded-full border px-3 text-sm font-semibold ${draft.locationIds.includes(l.id) ? 'border-transparent bg-brand text-white' : 'border-slate-300 text-ink hover:bg-slate-50'}`}>
                      {draft.locationIds.includes(l.id) && '✓ '}{pick(l.name, l.nameTa)}
                    </button>
                  ))}
                </div>
              </div>
              {draft.id && (
                <label className="flex min-h-touch items-center gap-3 px-1">
                  <input type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                  <span>{t('active')}</span>
                </label>
              )}
              <ErrorBox error={formError} />
              <div className="flex flex-wrap items-center justify-end gap-2">
                {draft.id && (
                  <button type="button" className="btn-secondary mr-auto gap-1.5" disabled={busy} onClick={async () => { const id = draft.id!; setDraft(null); await revoke(id); }}>
                    <Icon name="logout" size={16} />{t('revokeSessions')}
                  </button>
                )}
                <button className="btn-secondary" onClick={() => setDraft(null)}>{t('cancel')}</button>
                <button className="btn-primary" disabled={busy || !draft.fullName.trim() || !/^\d{10}$/.test(draft.mobile) || (draft.roleCodes.includes('ADMIN') && draft.password !== '' && !passwordOk(draft.password)) || draft.roleCodes.length === 0} onClick={save}>
                  {busy ? t('loading') : t('save')}
                </button>
              </div>
            </div>
        </Sheet>
      )}
    </div>
  );
}
