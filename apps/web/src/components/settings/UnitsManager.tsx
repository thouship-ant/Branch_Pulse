'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { ErrorBox, Skeleton, TextField } from '../ui';

interface UnitRow { id: string; code: string; name: string; baseUnitId: string | null; factorToBase: string }
interface Draft { id?: string; code: string; name: string; baseUnitId: string; factorToBase: string }

const emptyDraft: Draft = { code: '', name: '', baseUnitId: '', factorToBase: '1' };

/** Owner: units of measure and how non-base units convert into the stock (base) unit. */
export function UnitsManager() {
  const { t } = useT();
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setUnits(await api.get('/units')); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      if (draft.id) {
        await api.patch(`/units/${draft.id}`, { name: draft.name.trim(), factorToBase: draft.baseUnitId ? draft.factorToBase : undefined });
      } else {
        await api.post('/units', { code: draft.code.trim().toUpperCase(), name: draft.name.trim(), baseUnitId: draft.baseUnitId || undefined, factorToBase: draft.baseUnitId ? draft.factorToBase : undefined });
      }
      setDraft(null);
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not save');
    } finally { setBusy(false); }
  }

  if (!units) return error ? <ErrorBox error={error} /> : <Skeleton className="h-64" />;
  const baseUnits = units.filter((u) => !u.baseUnitId);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => { setFormError(null); setDraft({ ...emptyDraft }); }}>+ {t('addUnit')}</button>
      </div>
      <ErrorBox error={error} />

      {units.length === 0 ? <p className="card text-sm text-slate-500">{t('noUnits')}</p> : (
        <ul className="divide-y rounded-card border border-slate-200 text-sm">
          {units.map((u) => {
            const base = units.find((b) => b.id === u.baseUnitId);
            return (
              <li key={u.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <span><b>{u.code}</b> · {u.name}{base && <span className="text-slate-500"> · 1 {u.code} = {u.factorToBase} {base.code}</span>}{!base && <span className="text-slate-400"> · {t('isBaseUnitHint')}</span>}</span>
                <button className="min-h-[32px] rounded-card border border-slate-300 px-2 text-xs hover:bg-slate-100"
                  onClick={() => { setFormError(null); setDraft({ id: u.id, code: u.code, name: u.name, baseUnitId: u.baseUnitId ?? '', factorToBase: u.factorToBase }); }}>
                  {t('edit')}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 backdrop-blur-sm sm:items-center" onClick={() => setDraft(null)}>
          <div className="w-full max-w-md rounded-t-[24px] border border-slate-200/70 bg-surface p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{draft.id ? t('editUnit') : t('addUnit')}</h2>
            <div className="space-y-4">
              <TextField id="unc" label={t('unitCodeLabel')} value={draft.code} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().slice(0, 10) })} maxLength={10} />
              <TextField id="unn" label={t('unitNameLabel')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={30} />
              {!draft.id && (
                <div>
                  <label htmlFor="unb" className="label">{t('unitConvertsToLabel')}</label>
                  <select id="unb" className="field" value={draft.baseUnitId} onChange={(e) => setDraft({ ...draft, baseUnitId: e.target.value })}>
                    <option value="">{t('isBaseUnitHint')}</option>
                    {baseUnits.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                  </select>
                </div>
              )}
              {draft.baseUnitId && (
                <TextField id="unf" label={t('factorToBaseLabel')} inputMode="decimal" value={draft.factorToBase} onChange={(e) => setDraft({ ...draft, factorToBase: e.target.value.replace(/[^0-9.]/g, '') })} />
              )}
              <ErrorBox error={formError} />
              <div className="flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => setDraft(null)}>{t('cancel')}</button>
                <button className="btn-primary" disabled={busy || !draft.code.trim() || !draft.name.trim()} onClick={save}>{busy ? t('loading') : t('save')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
