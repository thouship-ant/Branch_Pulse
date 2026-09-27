'use client';

import { useEffect, useState } from 'react';
import { ItemManager } from '@/components/inventory/ItemManager';
import { Reconciliation } from '@/components/inventory/Reconciliation';
import { StockVarianceReport } from '@/components/inventory/StockVarianceReport';
import { TransfersPanel } from '@/components/inventory/TransfersPanel';
import { WastagePanel } from '@/components/inventory/WastagePanel';
import type { LocationOption } from '@/components/purchases/PurchaseForm';
import { StockLevels } from '@/components/purchases/StockLevels';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Tab = 'recon' | 'stock' | 'transfers' | 'wastage' | 'variance' | 'items';

/** Owner / stock manager / accountant: daily stock reconciliation, stock on hand, transfers, wastage, variance report and the item list. */
export default function InventoryPage() {
  const { t } = useT();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('recon');
  const [locations, setLocations] = useState<LocationOption[]>([]);
  useEffect(() => { api.get('/locations').then((l) => setLocations((l as LocationOption[]).filter((x) => x.type !== 'CENTRAL_OFFICE'))).catch(() => undefined); }, []);
  if (!can('stock:view')) return <p className="card">{t('noAccess')}</p>;

  const tabs: Array<[Tab, string]> = [['recon', t('tabRecon')], ['stock', t('stockOnHand')]];
  if (can('transfer:view')) tabs.push(['transfers', t('tabTransfers')]);
  if (can('wastage:view')) tabs.push(['wastage', t('tabWastage')]);
  if (can('count:view')) tabs.push(['variance', t('tabVariance')]);
  if (can('item:manage')) tabs.push(['items', t('tabItems')]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('invTitle')}</h2>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-touch whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {tab === 'recon' && <Reconciliation locations={locations} />}
      {tab === 'stock' && <StockLevels locations={locations} />}
      {tab === 'transfers' && <TransfersPanel locations={locations} />}
      {tab === 'wastage' && <WastagePanel locations={locations} />}
      {tab === 'variance' && <StockVarianceReport locations={locations} />}
      {tab === 'items' && <ItemManager locations={locations} />}
    </div>
  );
}
