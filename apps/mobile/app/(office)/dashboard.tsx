import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { PeriodPill } from '@/components/PeriodPill';
import { Banner, Card, Chip, ErrorBox, H3, HeroCard, Loading, Muted, Screen, StatCard, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { periodLabel, periodQuery, resolvePeriod, type Period } from '@/lib/period';
import { dec, formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';

interface Exc { code: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; locationName?: string; businessDate?: string; metric?: string }
interface PendingClosing { locationId: string; locationName: string; businessDate: string; status: string }

const SEV = { CRITICAL: { tone: 'bad', icon: '⛔' }, WARNING: { tone: 'warn', icon: '⚠' }, INFO: { tone: 'sky', icon: 'ⓘ' } } as const;
const whole = (v: string | number | null | undefined) => formatINR(v == null ? null : String(v), { decimals: false });

export default function DashboardScreen() {
  const th = useTheme();
  const today = todayIST();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('today', today));
  const [summary, setSummary] = useState<any>(null);
  const [exceptions, setExceptions] = useState<Exc[]>([]);
  const [pending, setPending] = useState<PendingClosing[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, ex, pc] = await Promise.all([
        api.get(`/dashboard/summary?${periodQuery(period)}`),
        api.full.get<Exc[]>('/exceptions').catch(() => ({ data: [] as Exc[] })),
        api.get<PendingClosing[]>('/pending-closings').catch(() => [] as PendingClosing[]),
      ]);
      setSummary(s); setPending(pc); setExceptions(ex.data.filter((e) => e.code !== 'CLOSING_PENDING')); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [period]);

  useFocusEffect(useCallback(() => { setSummary(null); void load(); }, [load]));

  const tl = summary?.tiles;
  const change = summary?.vsLastWeek.salesChangePct;
  const pendingDates = [...new Set(pending.map((p) => p.businessDate))];
  const when = periodLabel(period);
  const vs = summary?.vsLastWeek.comparedWith === 'PREVIOUS_PERIOD' ? 'vs previous period' : 'vs last week';

  return (
    <Screen hero onRefresh={load} headerRight={<PeriodPill period={period} today={today} onChange={setPeriod} />}>
      {/* the headline card overlaps the curved header */}
      {tl ? (
        <HeroCard
          icon="trending-up" label={`Total Sales (${when})`} value={whole(tl.totalSales)}
          sub={change == null ? undefined : `${Number(change) >= 0 ? '▲' : '▼'} ${Math.abs(Number(change))}% ${vs}`}
          columns={[
            { label: 'Net Operating', value: whole(tl.netOperating), color: dec(tl.netOperating).isNegative() ? th.bad.text : th.ok.text },
            { label: 'Expenses', value: whole(tl.totalExpenses), color: th.warn.text },
          ]}
        />
      ) : (
        <Card><Loading /></Card>
      )}

      <ErrorBox error={error} />

      {pendingDates.length > 0 && (
        <Banner tone="bad">⛔ Closing pending — {pendingDates.slice(0, 6).map(prettyDate).join(', ')}{pendingDates.length > 6 ? ', …' : ''}</Banner>
      )}

      {tl ? (
        <>
          <Text style={{ color: th.ink, fontSize: 20, fontWeight: '800' }}>Overview</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            <StatCard icon="dollar-sign" tone="ok" value={whole(tl.cash)} label="Cash" />
            <StatCard icon="smartphone" tone="violet" value={whole(tl.upi)} label="UPI" />
            <StatCard icon="shopping-bag" tone="sky" value={whole(tl.totalPurchases)} label="Purchases" />
            <StatCard icon="trash-2" tone="warn" value={whole(tl.wastage)} label="Wastage" />
            <StatCard icon="alert-triangle" tone={tl.hasCashShortage ? 'bad' : 'neutral'} alert={tl.hasCashShortage} value={whole(tl.cashVariance)} label="Cash variance" />
            <StatCard icon="clock" tone={tl.pendingClosings > 0 ? 'bad' : 'ok'} value={String(tl.pendingClosings)} label="Closings open" sub={`of ${tl.branchCount} branches`} />
          </View>

          <Text style={{ color: th.ink, fontSize: 20, fontWeight: '800' }}>Branches</Text>
          {summary.branches.length === 0 && <Muted>No branches yet.</Muted>}
          {summary.branches.map((b: any) => (
            <Card key={b.locationId} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '800', fontSize: 17, flex: 1 }}>{b.name}</Text>
                <StatusPill status={b.closingStatus} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Metric label="Sales" value={whole(b.sales)} />
                <Metric label="Expenses" value={whole(b.expenses)} />
                <Metric label="Net" value={whole(b.net)} bad={dec(b.net).isNegative()} />
                <Metric label="Cash diff" value={b.cashVariance == null ? '—' : whole(b.cashVariance)} bad={b.cashVariance != null && dec(b.cashVariance).isNegative()} />
              </View>
            </Card>
          ))}

          {exceptions.length > 0 && (
            <View style={{ gap: 8 }}>
              <H3>Needs attention ({exceptions.length})</H3>
              {exceptions.slice(0, 20).map((e, i) => {
                const s = SEV[e.severity];
                return (
                  <Chip
                    key={`${e.code}-${i}`} tone={s.tone} icon={s.icon}
                    text={`${e.locationName ?? e.title}${e.businessDate ? ` · ${prettyDate(e.businessDate)}` : ''}${e.code.startsWith('CASH') && e.metric ? ` · ${whole(Math.abs(Number(e.metric)))}` : ''}`}
                  />
                );
              })}
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}

function Metric({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  const th = useTheme();
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Text style={{ color: th.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: bad ? th.bad.text : th.ink, fontWeight: '700', fontSize: 14, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}
