import { useState } from 'react';
import { StockCount } from '@/components/StockCount';
import { StockLevels } from '@/components/StockLevels';
import { StockVariancePanel, TransfersPanel, WastagePanel } from '@/components/StockOps';
import { DateStepper, Loading, Screen, SegTabs } from '@/components/ui';
import { useDay } from '@/lib/useDate';
import { useBranch, useSession } from '@/lib/session';

type Tab = 'count' | 'wastage' | 'stock' | 'transfers' | 'variance';

/** The branch manager's stock desk: daily count, wastage, purchases, stock on hand, transfers to receive, this branch's variances. */
export default function BranchStockScreen() {
  const { can } = useSession();
  const { locationId } = useBranch();
  const [tab, setTab] = useState<Tab>('count');
  const day = useDay();
  if (!locationId) return <Screen><Loading /></Screen>;
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'count', label: 'Count' }, { key: 'wastage', label: 'Wastage' }, { key: 'stock', label: 'Stock' }, { key: 'transfers', label: 'Transfers' }];
  if (can('count:view')) tabs.push({ key: 'variance', label: 'Variance' });
  return (
    <Screen
      top={(
        <>
          <SegTabs value={tab} onChange={setTab} tabs={tabs} />
          {tab === 'count' ? <DateStepper label={day.label} onPrev={day.prev} onNext={day.next} nextDisabled={day.isToday} /> : null}
        </>
      )}
    >
      {tab === 'count' ? <StockCount fixedLocationId={locationId} day={day} /> : tab === 'wastage' ? <WastagePanel fixedLocationId={locationId} /> : tab === 'stock' ? <StockLevels fixedLocationId={locationId} /> : tab === 'transfers' ? <TransfersPanel fixedLocationId={locationId} /> : <StockVariancePanel fixedLocationId={locationId} />}
    </Screen>
  );
}
