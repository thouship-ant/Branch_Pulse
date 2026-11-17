import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';
import { ClosingBacklog } from '@/components/ClosingBacklog';
import { DateStepper, Empty, ErrorBox, ListRow, Loading, Screen, SegTabs, Sheet, StatusPill } from '@/components/ui';
import { TeaShopHeaderActions } from '@/components/TeaShopHeaderActions';
import { api } from '@/lib/api';
import { prettyTime } from '@/lib/dates';
import { dec, formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import { useSession } from '@/lib/session';
import { useAttention } from '@/lib/useAttention';
import { useDay } from '@/lib/useDate';
import { useLive } from '@/lib/live';

/** Every branch's closing for one day: status, sales, cash variance. Tap one to review it. */
export default function ClosingsScreen() {
  const th = useTheme();
  const router = useRouter();
  const { me } = useSession();
  const teaShop = me?.company?.businessType === 'TEA_SHOP';
  const attention = useAttention();
  const day = useDay();
  const [view, setView] = useState<'backlog' | 'day'>('backlog');
  const [hideAmounts, setHideAmounts] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get(`/closings?date=${day.date}`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [day.date]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  useLive(load, ['DAILY_CLOSING', 'DAILY_SALES', 'CASH_RECONCILIATION']);

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
  const dailyContent = (
    <>
      <DateStepper date={day.date} label={day.label} onPrev={day.prev} onNext={day.next} nextDisabled={day.isToday} />
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text="No branches." /> : rows.map((r) => {
        const v = r.cashVariance;
        const neg = v != null && dec(v).isNegative();
        return (
          <ListRow
            key={r.locationId} title={r.locationName}
            lines={[`Sales: ${hideAmounts ? '••••' : formatINR(r.totalSales, { decimals: false })}`, `Cash variance: ${v == null ? '—' : `${neg ? '▼ ' : ''}${hideAmounts ? '••••' : formatINR(v, { decimals: false })}`}`, r.reopenCount > 0 && `↺ reopened ×${r.reopenCount}`]}
            right={<><StatusPill status={r.status} />{r.submittedAt ? <Text style={{ color: th.faint, fontSize: 12 }}>{prettyTime(r.submittedAt)}</Text> : null}</>}
            onPress={() => { setDayOpen(false); router.push(`/more/closing/${r.locationId}/${day.date}` as any); }}
          />
        );
      })}
    </>
  );

  if (teaShop) {
    return (
      <Screen hero onRefresh={load} headerRight={headerRight}>
        <View style={{ gap: 14 }}>
          <View style={{ justifyContent: 'center', paddingHorizontal: 6 }}>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: '#8f421b', alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="clipboard-check-outline" size={30} color="#fff4e8" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: '#32190f', fontSize: 24, fontWeight: '800' }}>Branch Closings</Text>
                <Text numberOfLines={2} style={{ color: '#4a3020', fontSize: 12, lineHeight: 16 }}>Track and manage daily branch closings</Text>
              </View>
            </View>
          </View>
          <ClosingBacklog hidden={hideAmounts} onOpen={() => setDayOpen(true)} />
          <Sheet open={dayOpen} onClose={() => setDayOpen(false)} title="Closings by day">{dailyContent}</Sheet>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      title="Closings" onRefresh={load}
      top={(
        <>
          <SegTabs value={view} onChange={setView} tabs={[{ key: 'backlog', label: 'Backlog' }, { key: 'day', label: 'By day' }]} />
          {view === 'day' ? <DateStepper date={day.date} label={day.label} onPrev={day.prev} onNext={day.next} nextDisabled={day.isToday} /> : null}
        </>
      )}
    >
      {view === 'backlog' ? <ClosingBacklog /> : <>
      {dailyContent}
      </>}
    </Screen>
  );
}
