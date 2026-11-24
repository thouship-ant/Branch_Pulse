import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { PeriodPill } from '@/components/PeriodPill';
import { PurchaseList, PurchaseOverview, SuppliersPanel } from '@/components/Purchasing';
import { Screen, SegTabs } from '@/components/ui';
import { todayIST } from '@/lib/dates';
import { type Period } from '@/lib/period';
import { usePeriodParams } from '@/lib/usePeriodParams';
import { useSession } from '@/lib/session';

type Tab = 'overview' | 'purchases' | 'suppliers';

/** Purchases: overview, the purchase list (with approvals and entry) and suppliers with their dues. */
export default function PurchasesScreen() {
  const { can } = useSession();
  const today = todayIST();
  // a Home card can open the purchase list directly; from More it starts on the overview, as always
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(tabParam === 'purchases' ? 'purchases' : 'overview');
  useEffect(() => { setTab(tabParam === 'purchases' ? 'purchases' : 'overview'); }, [tabParam]);
  const [period, setPeriod] = usePeriodParams(today);
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'overview', label: 'Overview' }, { key: 'purchases', label: 'Purchases' }];
  if (can('supplier:view')) tabs.push({ key: 'suppliers', label: 'Suppliers' });
  return (
    <Screen title="Purchases" headerRight={tab === 'suppliers' ? undefined : <PeriodPill period={period} today={today} onChange={setPeriod} />} top={<SegTabs value={tab} onChange={setTab} tabs={tabs} />}>
      {tab === 'overview' ? <PurchaseOverview period={period} /> : tab === 'purchases' ? <PurchaseList period={period} /> : <SuppliersPanel />}
    </Screen>
  );
}
