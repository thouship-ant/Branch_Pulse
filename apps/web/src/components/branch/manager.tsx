'use client';

import { Select } from '@/components/Select';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Chips, TextField } from '../ui';

export interface ManagerChoice {
  mode: 'none' | 'existing' | 'new';
  userId: string;
  fullName: string;
  username: string;
  password: string;
  mobile: string;
}

export const emptyManager = (mode: ManagerChoice['mode'] = 'none'): ManagerChoice => ({ mode, userId: '', fullName: '', username: '', password: '', mobile: '' });

export type ManagerRole = 'BRANCH_MANAGER' | 'STOCK_MANAGER';

export interface EligibleManager { id: string; fullName: string; username: string; mobile: string | null; branchId: string | null; branchName: string | null }

/** Active users holding the given role, with the location each one currently runs. */
export function useEligibleManagers(pick: (en?: string | null, ta?: string | null) => string, roleCode: ManagerRole = 'BRANCH_MANAGER'): EligibleManager[] {
  const [list, setList] = useState<EligibleManager[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/users'), api.get('/locations')])
      .then(([users, locs]) => {
        if (!alive) return;
        setList(
          (users as any[])
            .filter((u) => u.status === 'ACTIVE' && u.roles.includes(roleCode))
            .map((u) => {
              const loc = (locs as any[]).find((l) => u.locationIds.includes(l.id));
              return { id: u.id, fullName: u.fullName, username: u.username, mobile: u.mobile ?? null, branchId: loc?.id ?? null, branchName: loc ? pick(loc.name, loc.nameTa) : null };
            }),
        );
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [pick, roleCode]);
  return list;
}

/** Client-side check so the owner gets a message before any request is sent. */
export function managerProblem(m: ManagerChoice, t: (k: any) => string): string | null {
  if (m.mode === 'existing' && !m.userId) return t('existingManager');
  if (m.mode === 'new') {
    if (!m.fullName.trim()) return t('fullName');
    if (!/^\d{10}$/.test(m.mobile)) return `${t('mobile')} (10 digits)`; // the mobile number is the sign-in name
  }
  return null;
}

/** Creates the manager's login when needed, then assigns them to the location. Throws ApiError on failure. */
export async function applyManager(branchId: string, m: ManagerChoice, roleCode: ManagerRole = 'BRANCH_MANAGER') {
  if (m.mode === 'none') return;
  let userId = m.userId;
  if (m.mode === 'new') {
    // managers sign in with their mobile number and an OTP: no username or password to set
    const user = await api.post('/users', { fullName: m.fullName.trim(), mobile: m.mobile.trim(), roleCodes: [roleCode], locationIds: [branchId] });
    userId = user.id;
  }
  await api.post(`/locations/${branchId}/manager`, { userId });
}

export function ManagerChooser({
  value, onChange, allowNone, currentBranchId, roleCode = 'BRANCH_MANAGER',
}: { value: ManagerChoice; onChange: (v: ManagerChoice) => void; allowNone: boolean; currentBranchId?: string; roleCode?: ManagerRole }) {
  const { t, pick } = useT();
  const eligible = useEligibleManagers(pick, roleCode);
  const set = (patch: Partial<ManagerChoice>) => onChange({ ...value, ...patch });
  const picked = eligible.find((e) => e.id === value.userId);
  const modes = [
    ...(allowNone ? [{ value: 'none' as const, label: t('noManager') }] : []),
    { value: 'existing' as const, label: t('existingManager') },
    { value: 'new' as const, label: t('createManager') },
  ];

  return (
    <div className="space-y-3">
      <Chips label={t('manager')} value={value.mode} onChange={(mode) => set({ mode })} options={modes} />
      {value.mode === 'existing' && (
        <div>
          <label htmlFor="mgr" className="label">{t('manager')}</label>
          <Select id="mgr" className="field" value={value.userId} onChange={(e) => set({ userId: e.target.value })}>
            <option value="">—</option>
            {eligible.map((e) => (
              <option key={e.id} value={e.id}>{e.fullName} ({e.mobile ?? e.username}){e.branchName ? ` · ${e.branchName}` : ''}</option>
            ))}
          </Select>
          {picked?.branchId && picked.branchId !== currentBranchId && (
            <p role="status" className="mt-2 rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              ⚠ {picked.fullName} {t('moveWarning', { branch: picked.branchName ?? '' })}
            </p>
          )}
        </div>
      )}
      {value.mode === 'new' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField id="mfn" label={t('fullName')} value={value.fullName} onChange={(e) => set({ fullName: e.target.value })} />
          <div>
            <TextField id="mmo" label={`${t('mobile')} *`} inputMode="numeric" placeholder="10 digits" value={value.mobile} onChange={(e) => set({ mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
            <p className="mt-1 text-xs text-slate-500">Signs in with this number and an OTP.</p>
          </div>
        </div>
      )}
    </div>
  );
}
