import { useState } from 'react';
import { ItemsPanel } from '@/components/ItemsRecipes';
import { StockCount } from '@/components/StockCount';
import { StockLevels } from '@/components/StockLevels';
import { StockVariancePanel, TransfersPanel, WastagePanel } from '@/components/StockOps';
import { Screen, SegTabs } from '@/components/ui';
import { useSession } from '@/lib/session';

type Tab = 'stock' | 'count' | 'wastage' | 'transfers' | 'variance' | 'items';

/** Inventory: stock on hand, the daily count and its approvals, wastage, transfers, variances and the item list. */
export default function InventoryScreen() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('stock');
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'stock', label: 'Stock' }, { key: 'count', label: 'Count' }];
  if (can('wastage:view')) tabs.push({ key: 'wastage', label: 'Wastage' });
  if (can('transfer:view')) tabs.push({ key: 'transfers', label: 'Transfers' });
  if (can('count:view')) tabs.push({ key: 'variance', label: 'Variance' });
  if (can('item:manage')) tabs.push({ key: 'items', label: 'Items' });
  return (
    <Screen title="Inventory">
      <SegTabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'stock' ? <StockLevels /> : tab === 'count' ? <StockCount /> : tab === 'wastage' ? <WastagePanel /> : tab === 'transfers' ? <TransfersPanel /> : tab === 'variance' ? <StockVariancePanel /> : <ItemsPanel />}
    </Screen>
  );
}
