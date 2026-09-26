'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ExpensesTab } from '@/components/branch/ExpensesTab';
import { HistoryTab } from '@/components/branch/HistoryTab';
import { ReportsTab } from '@/components/branch/ReportsTab';
import { SettingsTab } from '@/components/branch/SettingsTab';
import { ActiveChip, ErrorBox, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useT, type MessageKey } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Tab = 'settings' | 'expenses' | 'history' | 'reports';
const TABS: Array<[Tab, MessageKey]> = [['settings', 'tabSettings'], ['expenses', 'expenses'], ['history', 'history'], ['reports', 'tabReports']];

export default function BranchDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, pick } = useT();
  const { can } = useSession();
  const [branch, setBranch] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('settings');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setBranch(await api.get(`/locations/${id}`)); setError(null); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (!can('location:manage')) return <p className="card">{t('noAccess')}</p>;
  if (!branch) return error ? <ErrorBox error={error} /> : <Skeleton className="h-64" />;
  const isBranch = branch.type === 'BRANCH';
  // history is available for every location; expenses and reports only make sense for a trading branch
  const tabs = TABS.filter(([k]) => isBranch || k === 'settings' || k === 'history');

  return (
    <div className="space-y-4">
      <Link href="/branches" className="text-sm text-brand underline">← {t('branches')}</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-slate-500">{branch.code}</p>
          <h2 className="text-2xl font-bold">{pick(branch.name, branch.nameTa)}</h2>
          {isBranch && <p className="text-sm text-slate-500">{t('manager')}: {branch.manager ? branch.manager.fullName : t('noManager')}</p>}
        </div>
        <ActiveChip active={branch.status === 'ACTIVE'} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
        {tabs.map(([k, key]) => (
          <button
            key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-touch border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}
          >{t(key)}</button>
        ))}
      </div>

      {tab === 'settings' && <SettingsTab branch={branch} onChanged={load} />}
      {tab === 'expenses' && <ExpensesTab branch={branch} />}
      {tab === 'history' && <HistoryTab branchId={branch.id} />}
      {tab === 'reports' && <ReportsTab branch={branch} />}
    </div>
  );
}
