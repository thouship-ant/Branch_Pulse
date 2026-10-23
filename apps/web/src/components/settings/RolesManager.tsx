'use client';

import { Select } from '@/components/Select';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ActiveChip, ErrorBox, Skeleton, TextField } from '../ui';

interface RoleRow { id: string; code: string; name: string; scopeMode: string; isSystem: boolean; status: string; userCount: number; permissions: string[] }
interface Perm { code: string; module: string; description: string | null }
interface NewRoleDraft { code: string; name: string; scopeMode: 'ALL' | 'ASSIGNED' }

const bucketName = (m: string) => m.replace(/^./, (c) => c.toUpperCase());

/** Owner: pick which permissions each role holds, and add new custom roles. Permission codes are the ones
 * checked throughout the API (e.g. expense:create) - this only assigns them to roles, it cannot invent new ones. */
export function RolesManager() {
  const { t } = useT();
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<NewRoleDraft | null>(null);

  const load = useCallback(async () => {
    try { const [r, p] = await Promise.all([api.get('/roles'), api.get('/permissions')]); setRoles(r); setPerms(p); setError(null); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byModule = perms.reduce<Record<string, Perm[]>>((acc, p) => { (acc[p.module] ??= []).push(p); return acc; }, {});

  function open(r: RoleRow) { setFormError(null); setOpenId(r.id); setSelected(r.permissions); }
  function toggle(code: string) { setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code])); }

  async function savePerms() {
    if (!openId) return;
    setBusy(true); setFormError(null);
    try {
      await api.put(`/roles/${openId}/permissions`, { permissionCodes: selected });
      setOpenId(null);
      setNotice(t('permissionsSaved'));
      setTimeout(() => setNotice(null), 3000);
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not save');
    } finally { setBusy(false); }
  }

  async function toggleActive(r: RoleRow) {
    setBusy(true); setError(null);
    try { await api.patch(`/roles/${r.id}`, { status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); await load(); }
    catch (e: any) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }

  async function createRole() {
    if (!newRole) return;
    setBusy(true); setFormError(null);
    try {
      await api.post('/roles', { code: newRole.code.trim().toUpperCase(), name: newRole.name.trim(), scopeMode: newRole.scopeMode });
      setNewRole(null);
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not save');
    } finally { setBusy(false); }
  }

  if (!roles) return error ? <ErrorBox error={error} /> : <Skeleton className="h-64" />;
  const openRole = roles.find((r) => r.id === openId);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => { setFormError(null); setNewRole({ code: '', name: '', scopeMode: 'ASSIGNED' }); }}>+ {t('addRole')}</button>
      </div>
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      <ul className="space-y-2">
        {roles.map((r) => (
          <li key={r.id} className={`card space-y-2 ${r.status !== 'ACTIVE' ? 'opacity-70' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{r.name} <span className="font-normal text-slate-500">· {r.code}</span></p>
                <p className="text-xs text-slate-500">
                  {r.scopeMode === 'ALL' ? t('scopeAll') : t('scopeAssigned')} · {r.permissions.length} {t('permissionsLabel').toLowerCase()}
                  {r.isSystem && ` · ${t('systemRoleHint')}`} · {r.userCount} {t('roleUsersCount')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ActiveChip active={r.status === 'ACTIVE'} />
                <button className="btn-secondary min-h-[36px] px-3 text-sm" disabled={busy || (r.status === 'ACTIVE' && r.userCount > 0)}
                  title={r.status === 'ACTIVE' && r.userCount > 0 ? `${r.userCount} ${t('roleInUseHint')}` : undefined}
                  onClick={() => toggleActive(r)}>
                  {r.status === 'ACTIVE' ? t('inactive') : t('active')}
                </button>
                <button className="btn-secondary min-h-[36px] px-3 text-sm" onClick={() => open(r)}>{t('permissionsLabel')}</button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {openRole && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 backdrop-blur-sm sm:items-center" onClick={() => setOpenId(null)}>
          <div className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-[24px] border border-slate-200/70 bg-surface p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold">{openRole.name}</h2>
            <p className="mb-4 text-sm text-slate-500">{t('permissionsLabel')}</p>
            <div className="space-y-4">
              {Object.entries(byModule).map(([mod, list]) => (
                <div key={mod}>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{bucketName(mod)}</p>
                  <div className="flex flex-wrap gap-2">
                    {list.map((p) => (
                      <button key={p.code} type="button" onClick={() => toggle(p.code)}
                        className={`min-h-[34px] rounded-full border px-3 text-xs font-semibold ${selected.includes(p.code) ? 'border-transparent bg-brand text-white' : 'border-slate-300 text-ink hover:bg-slate-50'}`}>
                        {selected.includes(p.code) && '✓ '}{p.code}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <ErrorBox error={formError} />
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setOpenId(null)}>{t('cancel')}</button>
                <button className="btn-primary" disabled={busy} onClick={savePerms}>{busy ? t('loading') : t('savePermissions')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {newRole && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 backdrop-blur-sm sm:items-center" onClick={() => setNewRole(null)}>
          <div className="w-full max-w-md rounded-t-[24px] border border-slate-200/70 bg-surface p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{t('addRole')}</h2>
            <div className="space-y-4">
              <TextField id="rc" label={t('roleCodeLabel')} value={newRole.code} onChange={(e) => setNewRole({ ...newRole, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 30) })} maxLength={30} />
              <TextField id="rn" label={t('roleNameLabel')} value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} maxLength={60} />
              <div>
                <label htmlFor="rs" className="label">{t('scopeModeLabel')}</label>
                <Select id="rs" className="field" value={newRole.scopeMode} onChange={(e) => setNewRole({ ...newRole, scopeMode: e.target.value as 'ALL' | 'ASSIGNED' })}>
                  <option value="ASSIGNED">{t('scopeAssigned')}</option>
                  <option value="ALL">{t('scopeAll')}</option>
                </Select>
              </div>
              <ErrorBox error={formError} />
              <div className="flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => setNewRole(null)}>{t('cancel')}</button>
                <button className="btn-primary" disabled={busy || !newRole.code.trim() || !newRole.name.trim()} onClick={createRole}>{busy ? t('loading') : t('save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
