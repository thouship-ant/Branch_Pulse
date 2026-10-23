'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BranchForm } from '@/components/branch/BranchForm';
import { Icon } from '@/components/Icon';
import { ActiveChip, Chips, ErrorBox, Sheet, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

type Filter = 'ALL' | 'BRANCH' | 'GODOWN' | 'CENTRAL_OFFICE';

export default function BranchesPage() {
  const { t, pick } = useT();
  const { can } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [showInactive, setShowInactive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api.get('/locations')); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => (rows ?? []).filter((r) => (filter === 'ALL' || r.type === filter) && (showInactive || r.status === 'ACTIVE')),
    [rows, filter, showInactive],
  );

  async function confirmToggle() {
    if (!toggling) return;
    setBusy(true);
    try {
      await api.post(`/locations/${toggling.id}/${toggling.status === 'ACTIVE' ? 'deactivate' : 'activate'}`);
      setToggling(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
      setToggling(null);
    } finally { setBusy(false); }
  }

  if (!can('location:manage')) return <p className="card">{t('noAccess')}</p>;
  const typeLabel = (x: string) => (x === 'BRANCH' ? t('typeBranch') : x === 'GODOWN' ? t('typeGodown') : t('typeOffice'));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">{t('branches')}</h2>
        <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('addBranch')}</button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Chips
          value={filter} onChange={setFilter} label={t('typeLabel')}
          options={[{ value: 'ALL', label: t('allTypes') }, { value: 'BRANCH', label: t('typeBranch') }, { value: 'GODOWN', label: t('typeGodown') }, { value: 'CENTRAL_OFFICE', label: t('typeOffice') }]}
        />
        <label className="flex min-h-touch items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          {t('showInactive')}
        </label>
      </div>
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-64" /> : visible.length === 0 ? (
        <p className="card text-slate-600">{t('noBranches')}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('branchCode')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('branch')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('typeLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('manager')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('openingCash')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((b) => (
                <tr key={b.id} className={`hover:bg-slate-50 ${b.status !== 'ACTIVE' ? 'text-slate-500' : ''}`}>
                  <td className="px-3 py-3 font-mono text-xs font-semibold">{b.code}</td>
                  <th scope="row" className="px-3 py-3 text-left font-medium">
                    <Link href={`/branches/${b.id}`} className="hover:underline">{pick(b.name, b.nameTa)}</Link>
                  </th>
                  <td className="px-3 py-3">{typeLabel(b.type)}</td>
                  <td className="px-3 py-3">{b.type === 'BRANCH' ? (b.manager ? b.manager.fullName : <span className="text-slate-500">{t('noManager')}</span>) : '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{b.type === 'BRANCH' ? formatINR(b.defaultOpeningCash, { decimals: false }) : '—'}</td>
                  <td className="px-3 py-3"><ActiveChip active={b.status === 'ACTIVE'} /></td>
                  <td className="px-3 py-3 text-right">
                    <button className="btn-secondary min-h-[36px] whitespace-nowrap px-3 text-sm" onClick={() => setToggling(b)}>
                      {b.status === 'ACTIVE' ? t('deactivate') : t('activate')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('addBranch')}>
        <BranchForm mode="add" onDone={(b) => { setAdding(false); router.push(`/branches/${b.id}`); }} />
      </Sheet>

      <Sheet open={!!toggling} onClose={() => setToggling(null)} title={toggling ? `${toggling.status === 'ACTIVE' ? t('deactivate') : t('activate')} · ${pick(toggling.name, toggling.nameTa)}` : ''}>
        <div className="space-y-4">
          {toggling?.status === 'ACTIVE' && <p className="text-sm text-slate-600">{t('deactivateHint')}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setToggling(null)}>{t('cancel')}</button>
            <button className={toggling?.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={confirmToggle}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
