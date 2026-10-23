'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { amt } from '@/lib/money';
import { AutoTextarea, Chips, ErrorBox, MoneyInput, TextField } from '../ui';
import { applyManager, emptyManager, ManagerChooser, managerProblem, type ManagerChoice, type ManagerRole } from './manager';

type LocType = 'BRANCH' | 'GODOWN' | 'CENTRAL_OFFICE';

interface Values {
  code: string; type: LocType; name: string; nameTa: string; address: string; phone: string;
  openingCash: string; monthlyRent: string; cardEnabled: boolean; notes: string;
}

const fromBranch = (b: any): Values => ({
  code: b.code, type: b.type, name: b.name, nameTa: b.nameTa ?? '', address: b.address ?? '', phone: b.phone ?? '',
  openingCash: b.defaultOpeningCash ?? '', monthlyRent: b.monthlyRent ?? '', cardEnabled: b.cardEnabled, notes: b.notes ?? '',
});

/**
 * Add (with optional manager) or edit a branch. Codes are never typed from a fixed list: the next free ID is
 * suggested from the configurable prefix and the owner may overwrite it before creating.
 */
export function BranchForm({ mode, branch, onDone }: { mode: 'add' | 'edit'; branch?: any; onDone: (b: any) => void }) {
  const { t } = useT();
  const [v, setV] = useState<Values>(
    branch ? fromBranch(branch) : { code: '', type: 'BRANCH', name: '', nameTa: '', address: '', phone: '', openingCash: '', monthlyRent: '', cardEnabled: true, notes: '' },
  );
  const [manager, setManager] = useState<ManagerChoice>(emptyManager('none'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<any>(null); // branch exists but the manager step failed
  const [saved, setSaved] = useState(false);
  const [idFailed, setIdFailed] = useState(false); // the ID is read-only unless the server could not suggest one
  const [tamilBusy, setTamilBusy] = useState(false);
  const [tamilFor, setTamilFor] = useState(''); // the name the current Tamil value was made from
  const [tamilApprox, setTamilApprox] = useState(false);
  const [tamilEdited, setTamilEdited] = useState(false); // typed by hand: automatic filling no longer overwrites it
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((x) => ({ ...x, [k]: val }));

  // suggest the next free ID whenever the type changes (add mode only)
  useEffect(() => {
    if (mode !== 'add') return;
    setIdFailed(false);
    api.get(`/locations/next-code?type=${v.type}`).then((r) => set('code', r.code)).catch(() => setIdFailed(true));
  }, [mode, v.type]);

  /** Add mode: the Tamil name follows the English one and is filled in when the name field loses focus. */
  async function fillTamil() {
    if (mode !== 'add') return;
    const name = v.name.trim();
    if (name === tamilFor || (tamilEdited && v.nameTa.trim())) return;
    if (!name) { set('nameTa', ''); setTamilFor(''); setTamilApprox(false); return; }
    setTamilBusy(true);
    try {
      const r = await api.get(`/locations/transliterate?text=${encodeURIComponent(name)}`);
      set('nameTa', r.tamil);
      setTamilFor(name);
      setTamilApprox(r.source === 'local');
    } catch { /* leave it empty: the server fills it in when the branch is saved */ }
    finally { setTamilBusy(false); }
  }

  const codeOk = /^[A-Z][A-Z0-9]{1,9}$/.test(v.code);
  // branches are run by a Branch Manager, godowns by a Stock / Purchase Manager; the head office has no manager
  const managerRole: ManagerRole | null = v.type === 'BRANCH' ? 'BRANCH_MANAGER' : v.type === 'GODOWN' ? 'STOCK_MANAGER' : null;

  async function submit() {
    setBusy(true); setError(null); setSaved(false);
    try {
      // in add mode a Tamil value made for an older spelling of the name is dropped; the server then makes a fresh one
      const staleTamil = mode === 'add' && !tamilEdited && v.name.trim() !== tamilFor;
      const body = {
        name: v.name.trim(), nameTa: staleTamil ? undefined : v.nameTa.trim(), address: v.address, phone: v.phone, notes: v.notes,
        defaultOpeningCash: amt(v.openingCash), monthlyRent: amt(v.monthlyRent), cardEnabled: v.cardEnabled,
      };
      if (mode === 'edit') {
        const after = await api.patch(`/locations/${branch.id}`, body);
        setSaved(true);
        onDone(after);
        return;
      }
      const problem = managerRole ? managerProblem(manager, t) : null;
      if (problem) { setError(problem); return; }
      const loc = await api.post('/locations', { ...body, code: v.code, type: v.type });
      if (managerRole && manager.mode !== 'none') {
        try { await applyManager(loc.id, manager, managerRole); }
        catch (e) { setCreated(loc); setError(`${t('managerFailed')}: ${e instanceof ApiError ? e.message : ''}`); return; }
      }
      onDone(loc);
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {mode === 'add' && (
        <>
          <Chips
            label={t('typeLabel')} value={v.type} onChange={(x) => set('type', x)}
            options={[{ value: 'BRANCH', label: t('typeBranch') }, { value: 'GODOWN', label: t('typeGodown') }, { value: 'CENTRAL_OFFICE', label: t('typeOffice') }]}
          />
          <div>
            {/* the ID is assigned for you and cannot be edited; it only opens up if the server could not suggest one */}
            <TextField
              id="code" label={t('branchCode')} value={v.code} readOnly={!idFailed} maxLength={10} autoCapitalize="characters"
              onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} aria-invalid={idFailed && !codeOk && v.code !== ''}
            />
            <p className="mt-1 text-xs text-slate-500">{idFailed ? t('idFailed') : t('idAuto')}</p>
          </div>
        </>
      )}
      {mode === 'edit' && <p className="text-sm text-slate-500">{t('branchCode')}: <b className="text-ink">{v.code}</b> · {t('codeHint')}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="bn" label={t('branchNameEn')} value={v.name} onChange={(e) => set('name', e.target.value)} onBlur={fillTamil} required />
        <div>
          <TextField
            id="bnt" label={t('branchNameTa')} value={tamilBusy ? '' : v.nameTa} placeholder={tamilBusy ? '…' : undefined}
            onChange={(e) => { set('nameTa', e.target.value); setTamilEdited(e.target.value.trim() !== ''); setTamilApprox(false); }} aria-busy={tamilBusy}
          />
          {mode === 'add' && <p className="mt-1 text-xs text-slate-500">{tamilApprox ? t('tamilApprox') : t('tamilAuto')}</p>}
        </div>

        {/* address is multi-line like notes: it grows to show every line and spans both columns */}
        <div className="sm:col-span-2">
          <AutoTextarea id="ba" label={t('address')} value={v.address} onChange={(x) => set('address', x)} />
        </div>

        <TextField id="bp" label={t('phone')} inputMode="tel" placeholder="9876543210" value={v.phone} onChange={(e) => set('phone', e.target.value.replace(/[^\d+\s-]/g, ''))} />
        <MoneyInput id="boc" label={t('openingCash')} value={v.openingCash} onChange={(x) => set('openingCash', x)} hint={t('openingCashHint')} />
        <MoneyInput id="brent" label={t('monthlyRent')} value={v.monthlyRent} onChange={(x) => set('monthlyRent', x)} />
        <label className="flex min-h-touch items-center gap-3 self-start rounded-card border border-slate-300 px-3 sm:mt-6">
          <input type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={v.cardEnabled} onChange={(e) => set('cardEnabled', e.target.checked)} />
          <span>{t('cardEnabled')}</span>
        </label>
      </div>

      <AutoTextarea id="bnotes" label={t('notesLabel')} value={v.notes} onChange={(x) => set('notes', x)} />


      {mode === 'add' && managerRole && !created && (
        <div className="rounded-card border border-slate-200 p-3"><ManagerChooser value={manager} onChange={setManager} allowNone roleCode={managerRole} /></div>
      )}

      <ErrorBox error={error} />
      {saved && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ {t('saved')}</p>}
      {created ? (
        <Link href={`/branches/${created.id}`} className="btn-primary w-full">{t('openBranch')}</Link>
      ) : (
        <button className="btn-primary w-full" disabled={busy || !v.name.trim() || (mode === 'add' && !codeOk)} onClick={submit}>
          {busy ? t('loading') : mode === 'add' ? t('addBranch') : t('save')}
        </button>
      )}
    </div>
  );
}
