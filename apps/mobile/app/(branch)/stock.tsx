import { useState } from 'react';
import { PurchaseList } from '@/components/Purchasing';
import { StockCount } from '@/components/StockCount';
import { StockLevels } from '@/components/StockLevels';
import { StockVariancePanel, TransfersPanel, WastagePanel } from '@/components/StockOps';
import { Loading, Screen, SegTabs } from '@/components/ui';
import { useBranch, useSession } from '@/lib/session';

type Tab = 'count' | 'wastage' | 'purchases' | 'stock' | 'transfers' | 'variance';

/** The branch manager's stock desk: daily count, wastage, purchases, stock on hand, transfers to receive, this branch's variances. */
export default function BranchStockScreen() {
  const { can } = useSession();
  const { locationId } = useBranch();
  const [tab, setTab] = useState<Tab>('count');
  if (!locationId) return <Screen><Loading /></Screen>;
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'count', label: 'Count' }, { key: 'wastage', label: 'Wastage' }, { key: 'purchases', label: 'Purchases' }, { key: 'stock', label: 'Stock' }, { key: 'transfers', label: 'Transfers' }];
  if (can('count:view')) tabs.push({ key: 'variance', label: 'Variance' });
  return (
    <Screen>
      <SegTabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'count' ? <StockCount fixedLocationId={locationId} /> : tab === 'wastage' ? <WastagePanel fixedLocationId={locationId} /> : tab === 'purchases' ? <PurchaseList fixedLocationId={locationId} /> : tab === 'stock' ? <StockLevels fixedLocationId={locationId} /> : tab === 'transfers' ? <TransfersPanel fixedLocationId={locationId} /> : <StockVariancePanel fixedLocationId={locationId} />}
    </Screen>
  );
}
