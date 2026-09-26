'use client';

import { useState } from 'react';
import { CategoryManager } from '@/components/expenses/CategoryManager';
import { ExpenseLedger } from '@/components/expenses/ExpenseLedger';
import { ExpenseOverview } from '@/components/expenses/ExpenseOverview';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Tab = 'overview' | 'ledger' | 'categories';

/** Owner / accountant: expense analytics, the full expense ledger, and the category configuration. */
export default function ExpensesPage() {
  const { t } = useT();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  if (!can('expense:view')) return <p className="card">{t('noAccess')}</p>;

  const tabs: Array<[Tab, string]> = [['overview', t('tabOverview')], ['ledger', t('tabLedger')]];
  if (can('settings:manage')) tabs.push(['categories', t('tabCategories')]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('expenses')}</h2>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-touch whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {tab === 'overview' && <ExpenseOverview />}
      {tab === 'ledger' && <ExpenseLedger />}
      {tab === 'categories' && <CategoryManager />}
    </div>
  );
}
