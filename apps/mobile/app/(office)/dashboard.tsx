import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Banner, Card, Chip, DateStepper, ErrorBox, H3, Loading, Muted, Screen, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { dec, formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';

interface Exc { code: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; locationName?: string; businessDate?: string; metric?: string }
interface PendingClosing { locationId: string; locationName: string; businessDate: string; status: string }

const SEV = { CRITICAL: { tone: 'bad', icon: '⛔' }, WARNING: { tone: 'warn', icon: '⚠' }, INFO: { tone: 'sky', icon: 'ⓘ' } } as const;

export default function DashboardScreen() {
  const th = useTheme();
  const today = todayIST();
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState<any>(null);
  const [exceptions, setExceptions] = useState<Exc[]>([]);
  const [pending, setPending] = useState<PendingClosing[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, ex, pc] = await Promise.all([
        api.get(`/dashboard/summary?date=${date}`),
        api.full.get<Exc[]>('/exceptions').catch(() => ({ data: [] as Exc[] })),
        api.get<PendingClosing[]>('/pending-closings').catch(() => [] as PendingClosing[]),
      ]);
      setSummary(s); setPending(pc); setExceptions(ex.data.filter((e) => e.code !== 'CLOSING_PENDING')); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [date]);

  useFocusEffect(useCallback(() => { setSummary(null); void load(); }, [load]));

  const tl = summary?.tiles;
  const change = summary?.vsLastWeek.salesChangePct;
  const pendingDates = [...new Set(pending.map((p) => p.businessDate))];

  const tiles = tl ? [
    { label: 'Total sales', value: formatINR(tl.totalSales, { decimals: false }), sub: change == null ? undefined : `${Number(change) >= 0 ? '▲' : '▼'} ${Math.abs(Number(change))}% vs last week` },
    { label: 'Expenses', value: formatINR(tl.totalExpenses, { decimals: false }) },
    { label: 'Net operating', value: formatINR(tl.netOperating, { decimals: false }), bad: dec(tl.netOperating).isNegative() },
    { label: 'Cash', value: formatINR(tl.cash, { decimals: false }) },
    { label: 'UPI', value: formatINR(tl.upi, { decimals: false }) },
    { label: 'Purchases', value: formatINR(tl.totalPurchases, { decimals: false }) },
    { label: 'Wastage', value: formatINR(tl.wastage, { decimals: false }) },
    { label: 'Cash variance', value: formatINR(tl.cashVariance, { decimals: false }), bad: tl.hasCashShortage },
  ] : [];

  return (
    <Screen onRefresh={load}>
      <DateStepper
        date={date} label={date === today ? `Today · ${prettyDate(date)}` : prettyDate(date)}
        onPrev={() => setDate((d) => addDays(d, -1))} onNext={() => setDate((d) => addDays(d, 1))} nextDisabled={date >= today}
      />
      <ErrorBox error={error} />

      {pendingDates.length > 0 && (
        <Banner tone="bad">⛔ Closing pending — {pendingDates.slice(0, 6).map(prettyDate).join(', ')}{pendingDates.length > 6 ? ', …' : ''}</Banner>
      )}

      {!summary ? (error ? null : <Loading />) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {tiles.map((t) => (
              <Card key={t.label} tone={t.bad ? 'bad' : undefined} style={{ width: '47.5%', gap: 2, padding: 12 }}>
                <Text style={{ color: th.muted, fontSize: 12, fontWeight: '600' }}>{t.label}</Text>
                <Text style={{ color: t.bad ? th.bad.text : th.ink, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{t.value}</Text>
                {t.sub ? <Text style={{ color: th.muted, fontSize: 11 }}>{t.sub}</Text> : null}
              </Card>
            ))}
          </View>

          <View style={{ gap: 8 }}>
            <H3>Branches ({tl.pendingClosings} closing{tl.pendingClosings === 1 ? '' : 's'} open)</H3>
            {summary.branches.length === 0 && <Muted>No branches yet.</Muted>}
            {summary.branches.map((b: any) => (
              <Card key={b.locationId} style={{ gap: 8, padding: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '700', fontSize: 16, flex: 1 }}>{b.name}</Text>
                  <StatusPill status={b.closingStatus} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Metric label="Sales" value={formatINR(b.sales, { decimals: false })} />
                  <Metric label="Expenses" value={formatINR(b.expenses, { decimals: false })} />
                  <Metric label="Net" value={formatINR(b.net, { decimals: false })} bad={dec(b.net).isNegative()} />
                  <Metric label="Cash diff" value={b.cashVariance == null ? '—' : formatINR(b.cashVariance, { decimals: false })} bad={b.cashVariance != null && dec(b.cashVariance).isNegative()} />
                </View>
              </Card>
            ))}
          </View>

          {exceptions.length > 0 && (
            <View style={{ gap: 8 }}>
              <H3>Needs attention ({exceptions.length})</H3>
              {exceptions.slice(0, 20).map((e, i) => {
                const s = SEV[e.severity];
                return (
                  <Pressable key={`${e.code}-${i}`}>
                    <Chip tone={s.tone} icon={s.icon} text={`${e.locationName ?? e.title}${e.businessDate ? ` · ${prettyDate(e.businessDate)}` : ''}${e.code.startsWith('CASH') && e.metric ? ` · ${formatINR(String(Math.abs(Number(e.metric))), { decimals: false })}` : ''}`} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function Metric({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  const th = useTheme();
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Text style={{ color: th.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: bad ? th.bad.text : th.ink, fontWeight: '600', fontSize: 13, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}
