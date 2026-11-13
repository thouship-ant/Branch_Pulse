'use client';

import { useCallback, useEffect, useState } from 'react';
import { Reconciliation } from '@/components/inventory/Reconciliation';
import { StockVarianceReport } from '@/components/inventory/StockVarianceReport';
import { TransfersPanel } from '@/components/inventory/TransfersPanel';
import { WastagePanel } from '@/components/inventory/WastagePanel';
import { StockLevels } from '@/components/purchases/StockLevels';
import { Sheet, Warnings } from '@/components/ui';
import { api, type Warning } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { STATUS_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { useOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { useBranch } from '@/lib/useBranch';

type Tab = 'count' | 'wastage' | 'stock' | 'transfers' | 'variance';

/** Branch manager's stock desk: the daily count, wastage, purchases, stock on hand, transfers to receive, and this branch's variances. */
export default function StockPage() {
  const { t } = useT();
  const { can } = useSession();
  const { locationId } = useBranch();
  const [tab, setTab] = useState<Tab>('count');
  const tabs: Array<[Tab, string]> = [['count', t('tabRecon')], ['wastage', t('tabWastage')], ['stock', t('stockOnHand')], ['transfers', t('tabTransfers')]];
  if (can('count:view')) tabs.push(['variance', t('tabVariance')]);
  if (!locationId) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{t('stock')}</h2>
      <div className="flex w-full gap-1 overflow-x-auto" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className="shrink-0">{label}</button>
        ))}
      </div>
      {tab === 'count' && <Reconciliation locations={[]} fixedLocationId={locationId} />}
      {tab === 'wastage' && <WastagePanel locations={[]} fixedLocationId={locationId} analytics={false} />}
      {tab === 'stock' && <StockLevels locations={[]} fixedLocationId={locationId} />}
      {tab === 'transfers' && <TransfersPanel locations={[]} fixedLocationId={locationId} />}
      {tab === 'variance' && <StockVarianceReport locations={[]} fixedLocationId={locationId} />}
    </div>
  );
}
