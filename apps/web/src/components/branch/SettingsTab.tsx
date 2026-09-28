'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ActiveChip, ErrorBox, Sheet } from '../ui';
import { BranchForm } from './BranchForm';
import { applyManager, emptyManager, ManagerChooser, managerProblem, type ManagerChoice, type ManagerRole } from './manager';

/** Edit details, opening cash and rent, assign the manager, and switch the branch on or off. */
export function SettingsTab({ branch, onChanged }: { branch: any; onChanged: () => void }) {
  const { t } = useT();
  const [sheet, setSheet] = useState<'manager' | 'status' | 'remove' | null>(null);
  const [choice, setChoice] = useState<ManagerChoice>(emptyManager('existing'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // branches are run by a Branch Manager, godowns by a Stock / Purchase Manager; the head office has no manager
  const managerRole: ManagerRole | null = branch.type === 'BRANCH' ? 'BRANCH_MANAGER' : branch.type === 'GODOWN' ? 'STOCK_MANAGER' : null;
  const active = branch.status === 'ACTIVE';

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); setSheet(null); setChoice(emptyManager('existing')); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card lg:col-span-2" aria-label={t('editBranch')}>
        <h3 className="mb-3 font-semibold">{t('editBranch')}</h3>
        <BranchForm mode="edit" branch={branch} onDone={() => onChanged()} />
      </section>

      <div className="space-y-4">
        {managerRole && (
          <section className="card space-y-3" aria-label={t('manager')}>
            <h3 className="font-semibold">{t('manager')}</h3>
            {branch.manager ? (
              <div>
                <p className="font-medium">{branch.manager.fullName}</p>
                <p className="text-sm text-slate-500">@{branch.manager.username}{branch.manager.mobile ? ` · ${branch.manager.mobile}` : ''}</p>
              </div>
            ) : <p className="text-sm text-slate-500">{t('noManager')}</p>}
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => { setError(null); setSheet('manager'); }}>{branch.manager ? t('changeManager') : t('assignManager')}</button>
              {branch.manager && <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => { setError(null); setSheet('remove'); }}>{t('removeManager')}</button>}
            </div>
          </section>
        )}

        <section className="card space-y-3" aria-label={t('status')}>
          <div className="flex items-center justify-between"><h3 className="font-semibold">{t('status')}</h3><ActiveChip active={active} /></div>
          {active && <p className="text-sm text-slate-600">{t('deactivateHint')}</p>}
          <button className={`${active ? 'btn-danger' : 'btn-primary'} min-h-[40px] px-4 text-sm`} onClick={() => { setError(null); setSheet('status'); }}>
            {active ? t('deactivate') : t('activate')}
          </button>
        </section>
      </div>

      <Sheet open={sheet === 'manager'} onClose={() => setSheet(null)} title={branch.manager ? t('changeManager') : t('assignManager')}>
        <div className="space-y-4">
          <ManagerChooser value={choice} onChange={setChoice} allowNone={false} currentBranchId={branch.id} roleCode={managerRole ?? undefined} />
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setSheet(null)}>{t('cancel')}</button>
            <button
              className="btn-primary" disabled={busy || choice.mode === 'none'}
              onClick={() => {
                const problem = managerProblem(choice, t);
                if (problem) { setError(problem); return; }
                void run(() => applyManager(branch.id, choice, managerRole ?? undefined));
              }}
            >{t('confirm')}</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'remove'} onClose={() => setSheet(null)} title={t('removeManager')}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{branch.manager?.fullName}</p>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setSheet(null)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={busy} onClick={() => run(() => api.post(`/locations/${branch.id}/manager`, { userId: null }))}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'status'} onClose={() => setSheet(null)} title={active ? t('deactivate') : t('activate')}>
        <div className="space-y-4">
          {active && <p className="text-sm text-slate-600">{t('deactivateHint')}</p>}
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setSheet(null)}>{t('cancel')}</button>
            <button className={active ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={() => run(() => api.post(`/locations/${branch.id}/${active ? 'deactivate' : 'activate'}`))}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
