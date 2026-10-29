import { useState } from 'react';
import { PeriodPill } from '@/components/PeriodPill';
import { PurchaseList, PurchaseOverview, SuppliersPanel } from '@/components/Purchasing';
import { Screen, SegTabs } from '@/components/ui';
import { todayIST } from '@/lib/dates';
import { resolvePeriod, type Period } from '@/lib/period';
import { useSession } from '@/lib/session';

type Tab = 'overview' | 'purchases' | 'suppliers';

/** Purchases: overview, the purchase list (with approvals and entry) and suppliers with their dues. */
export default function PurchasesScreen() {
  const { can } = useSession();
  const today = todayIST();
  const [tab, setTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'overview', label: 'Overview' }, { key: 'purchases', label: 'Purchases' }];
  if (can('supplier:view')) tabs.push({ key: 'suppliers', label: 'Suppliers' });
  return (
    <Screen title="Purchases" headerRight={tab === 'suppliers' ? undefined : <PeriodPill period={period} today={today} onChange={setPeriod} />}>
      <SegTabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'overview' ? <PurchaseOverview period={period} /> : tab === 'purchases' ? <PurchaseList period={period} /> : <SuppliersPanel />}
    </Screen>
  );
}
