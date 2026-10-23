'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ActiveChip, ErrorBox, Skeleton, TextField } from '../ui';

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

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const common = { fullName: draft.fullName.trim(), mobile: draft.mobile.trim() || undefined, email: draft.email.trim() || undefined, roleCodes: draft.roleCodes, locationIds: draft.locationIds };
      if (draft.id) {
        await api.patch(`/users/${draft.id}`, { ...common, active: undefined, status: draft.active ? 'ACTIVE' : 'INACTIVE', password: draft.password || undefined });
      } else {
        await api.post('/users', { ...common, username: draft.username.trim(), password: draft.password });
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
        <button className="btn-primary" onClick={() => { setFormError(null); setDraft({ ...emptyDraft }); }}>+ {t('addUser')}</button>
      </div>
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {users.length === 0 ? <p className="card text-sm text-slate-500">{t('noUsers')}</p> : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className={`card space-y-2 ${u.status !== 'ACTIVE' ? 'opacity-70' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{u.fullName} <span className="font-normal text-slate-500">· {u.username}</span></p>
                  <p className="text-xs text-slate-500">
                    {u.roles.join(', ')}
                    {u.locationIds.length > 0 && ` · ${u.locationIds.map((id) => { const l = locs.find((x) => x.id === id); return l ? pick(l.name, l.nameTa) : id; }).join(', ')}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ActiveChip active={u.status === 'ACTIVE'} />
                  <button className="btn-secondary min-h-[36px] px-3 text-sm" onClick={() => revoke(u.id)} disabled={busy}>{t('revokeSessions')}</button>
                  <button className="btn-secondary min-h-[36px] px-3 text-sm" onClick={() => { setFormError(null); setDraft(fromUser(u)); }}>{t('edit')}</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 backdrop-blur-sm sm:items-center" onClick={() => setDraft(null)}>
          <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-[24px] border border-slate-200/70 bg-surface p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{draft.id ? t('editUser') : t('addUser')}</h2>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField id="ufn" label={t('fullName')} value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} maxLength={100} />
                <TextField id="uun" label={t('loginName')} autoCapitalize="none" autoComplete="off" value={draft.username} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, username: e.target.value })} maxLength={50} />
                <TextField id="upw" label={draft.id ? `${t('passwordNew')} (${t('useDefault')})` : t('passwordNew')} type="password" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
                <TextField id="umo" label={t('mobile')} inputMode="numeric" value={draft.mobile} onChange={(e) => setDraft({ ...draft, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
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
              <div className="flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => setDraft(null)}>{t('cancel')}</button>
                <button className="btn-primary" disabled={busy || !draft.fullName.trim() || !draft.username.trim() || (!draft.id && draft.password.length < 8) || draft.roleCodes.length === 0} onClick={save}>
                  {busy ? t('loading') : t('save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
