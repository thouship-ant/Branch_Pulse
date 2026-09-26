'use client';

import { useEffect, useState } from 'react';
import { PurchaseForm, type LocationOption } from '@/components/purchases/PurchaseForm';
import { PurchaseLedger } from '@/components/purchases/PurchaseLedger';
import { PurchaseOverview } from '@/components/purchases/PurchaseOverview';
import { StockLevels } from '@/components/purchases/StockLevels';
import { SupplierManager } from '@/components/purchases/SupplierManager';
import { SupplierReports } from '@/components/purchases/SupplierReports';
import { Sheet, Warnings } from '@/components/ui';
import { api, type Warning } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Tab = 'overview' | 'purchases' | 'suppliers' | 'reports' | 'stock';

/** Owner / accountant / stock manager: purchases, suppliers and what is owed to them, and the stock the purchases feed. */
export default function PurchasesPage() {
  const { t } = useT();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ queued: boolean; warnings: Warning[] } | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh((n) => n + 1);

  useEffect(() => { api.get('/locations').then((l) => setLocations(l as LocationOption[])).catch(() => undefined); }, []);
  if (!can('purchase:view')) return <p className="card">{t('noAccess')}</p>;

  const receiving = locations.filter((l) => l.type !== 'CENTRAL_OFFICE');
  const tabs: Array<[Tab, string]> = [['overview', t('tabOverview')], ['purchases', t('tabPurchases')]];
  if (can('supplier:view')) tabs.push(['suppliers', t('tabSuppliers')]);
  if (can('supplier:pay')) tabs.push(['reports', t('supplierReports')]);
  if (can('stock:view')) tabs.push(['stock', t('tabStock')]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">{t('purchases')}</h2>
        {can('purchase:create') && <button className="btn-primary" onClick={() => { setNotice(null); setAdding(true); }}>+ {t('newPurchase')}</button>}
      </div>
      {notice && (
        <div role="status" className="space-y-2 rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p>✓ {t('purchaseSaved')}</p>
          <Warnings items={notice.warnings} />
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); if (k !== 'purchases') setPendingOnly(false); }}
            className={`min-h-touch whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && <PurchaseOverview locations={receiving} refreshKey={refresh} onShowPending={() => { setPendingOnly(true); setTab('purchases'); }} />}
      {tab === 'purchases' && <PurchaseLedger key={pendingOnly ? 'pending' : 'all'} locations={receiving} initialStatus={pendingOnly ? 'SUBMITTED' : ''} refreshKey={refresh} onChanged={bump} />}
      {tab === 'suppliers' && <SupplierManager payLocations={locations} onChanged={bump} />}
      {tab === 'reports' && <SupplierReports locations={receiving} />}
      {tab === 'stock' && <StockLevels locations={receiving} refreshKey={refresh} />}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('newPurchase')}>
        <PurchaseForm locations={receiving} onSaved={(r) => { setAdding(false); setNotice(r); bump(); setTab('purchases'); setPendingOnly(false); }} />
      </Sheet>
    </div>
  );
}
