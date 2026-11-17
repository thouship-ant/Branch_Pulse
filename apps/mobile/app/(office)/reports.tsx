import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { SalesClosingCards } from '@/components/SalesClosingCards';
import { DashboardCharts } from '@/components/DashboardCharts';
import { TeaShopHeaderActions } from '@/components/TeaShopHeaderActions';
import { PageTitle, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useAttention } from '@/lib/useAttention';

export default function ReportsScreen() {
  const router = useRouter();
  const { me } = useSession();
  const teaShop = me?.company?.businessType === 'TEA_SHOP';
  const attention = useAttention();
  const [hideAmounts, setHideAmounts] = useState(false);

  const headerRight = teaShop ? (
    <TeaShopHeaderActions
      hidden={hideAmounts}
      onToggleHidden={() => setHideAmounts((hidden) => !hidden)}
      onNotifications={() => router.push('/approvals' as any)}
      onProfile={() => router.push('/account' as any)}
      notifications={attention.waiting}
      initials={me?.fullName?.trim().split(/\s+/).map((part) => part[0]).slice(0, 1).join('').toUpperCase() || 'A'}
    />
  ) : undefined;

  return (
    <Screen
      hero
      title={teaShop ? undefined : 'Reports'}
      headerSubtitle={teaShop ? 'Operations & Analytics' : undefined}
      headerRight={headerRight}
    >
      {teaShop ? <PageTitle icon="chart-box-outline" title="Reports" subtitle="Sales, closings and charts across all branches" /> : null}
      <SalesClosingCards hideAmounts={hideAmounts} />
      <DashboardCharts hideAmounts={hideAmounts} />
    </Screen>
  );
}
