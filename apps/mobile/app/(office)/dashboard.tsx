import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ImageBackground, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';
import { DashboardCharts } from '@/components/DashboardCharts';
import { DashboardOrders } from '@/components/DashboardOrders';
import { PeriodPill } from '@/components/PeriodPill';
import { Banner, Button, Card, Chip, ErrorBox, H3, HeroCard, Loading, Muted, Screen, Sheet, StatCard, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { periodLabel, periodQuery, resolvePeriod, type Period } from '@/lib/period';
import { dec, formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';
import { useLive } from '@/lib/live';

interface Exc { code: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; locationName?: string; businessDate?: string; metric?: string }
interface PendingClosing { locationId: string; locationName: string; businessDate: string; status: string }

const SEV = { CRITICAL: { tone: 'bad', icon: '⛔' }, WARNING: { tone: 'warn', icon: '⚠' }, INFO: { tone: 'sky', icon: 'ⓘ' } } as const;
const whole = (v: string | number | null | undefined) => formatINR(v == null ? null : String(v), { decimals: false });
const TEA_SHOP_IMAGES = [
  { image: require('../../assets/tea-shop/tea-1.jpg'), title: 'Chai & cookies', caption: 'A little tea-time favourite' },
  { image: require('../../assets/tea-shop/bread-omelette.png'), title: 'Bread omelette', caption: 'A filling tea-time bite' },
  { image: require('../../assets/tea-shop/tea-3.jpg'), title: 'Iced tea', caption: 'A refreshing shop special' },
  { image: require('../../assets/tea-shop/tea-4.jpg'), title: 'Ginger tea', caption: 'Fresh ginger with warm tea' },
  { image: require('../../assets/tea-shop/vada.jpg'), title: 'Medhu Vada', caption: 'A crisp, savoury snack' },
  { image: require('../../assets/tea-shop/samosa.jpg'), title: 'Samosa', caption: 'A golden, flaky favourite' },
  { image: require('../../assets/tea-shop/fries.jpg'), title: 'French fries', caption: 'Hot and crispy' },
  { image: require('../../assets/tea-shop/tea-2.jpg'), title: 'Freshly brewed', caption: 'Made for a relaxing break' },
];

export default function DashboardScreen() {
  const th = useTheme();
  const today = todayIST();
  const [teaShopIndex, setTeaShopIndex] = useState(0);
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('today', today));
  const [summary, setSummary] = useState<any>(null);
  const [exceptions, setExceptions] = useState<Exc[]>([]);
  const [pending, setPending] = useState<PendingClosing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingPage, setPendingPage] = useState(1);
  const branchList = useBranches();
  const [awaitingRows, setAwaitingRows] = useState<any[]>([]);
  const [sales, setSales] = useState<{ dates: string[]; total: Array<string | null> } | null>(null);
  const [wait, setWait] = useState({ expenses: 0, amount: 0, closings: 0, requests: 0, oldestExpense: null as string | null, oldestClosing: null as string | null, overdue: 0 });

  const load = useCallback(async () => {
    try {
      const [s, ex, pc] = await Promise.all([
        api.get(`/dashboard/summary?${periodQuery(period)}`),
        api.full.get<Exc[]>('/exceptions').catch(() => ({ data: [] as Exc[] })),
        api.get<PendingClosing[]>('/pending-closings').catch(() => [] as PendingClosing[]),
      ]);
      const [we, wc, wr, pu, sl] = await Promise.all([
        api.get<any[]>('/expenses?status=SUBMITTED&pageSize=100').catch(() => [] as any[]),
        api.get<any[]>('/closings/awaiting').catch(() => [] as any[]),
        api.get<any[]>('/backdate-requests?status=PENDING').catch(() => [] as any[]),
        api.get<any>(`/purchases/summary?from=${addDays(todayIST(), -29)}&to=${todayIST()}`).catch(() => null),
        api.get<any>(`/dashboard/charts/daily-sales-trend?from=${addDays(todayIST(), -6)}&to=${todayIST()}`).catch(() => null),
      ]);
      setAwaitingRows(wc); setSales(sl);
      setWait({
        expenses: we.length, amount: we.reduce((a, r) => a + Number(r.amount), 0), closings: wc.length, requests: wr.length,
        oldestExpense: we.map((r) => String(r.createdAt)).sort()[0] ?? null,
        oldestClosing: wc.map((r) => String(r.submittedAt ?? r.businessDate)).sort()[0] ?? null,
        overdue: pu ? Number(pu.outstanding?.overdue ?? 0) : 0,
      });
      setSummary(s); setPending(pc); setExceptions(ex.data.filter((e) => e.code !== 'CLOSING_PENDING')); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [period]);

  useFocusEffect(useCallback(() => { setSummary(null); void load(); }, [load]));
  useLive(load);

  useEffect(() => {
    const timer = setInterval(() => {
      setTeaShopIndex((index) => (index + 1) % TEA_SHOP_IMAGES.length);
    }, 3500);
    return () => clearInterval(timer);
  }, []);

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

      <View style={{ gap: 10 }}>
        <Text style={{ color: th.ink, fontSize: 18, fontWeight: '800' }}>Tea shop</Text>
        <Card style={{ width: '100%', padding: 0, gap: 0, overflow: 'hidden' }}>
          <ImageBackground
            source={TEA_SHOP_IMAGES[teaShopIndex].image}
            resizeMode="cover"
            style={{ width: '100%', height: 160, justifyContent: 'flex-end' }}
            accessibilityLabel={TEA_SHOP_IMAGES[teaShopIndex].title}
          >
            <View style={{ width: '100%', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(15, 23, 42, 0.64)' }}>
              <Text style={{ width: '100%', color: '#fff', fontSize: 15, fontWeight: '800' }}>{TEA_SHOP_IMAGES[teaShopIndex].title}</Text>
              <Text style={{ width: '100%', color: '#f1f5f9', fontSize: 12 }}>{TEA_SHOP_IMAGES[teaShopIndex].caption}</Text>
            </View>
          </ImageBackground>
        </Card>
        <View accessibilityLabel={`Image ${teaShopIndex + 1} of ${TEA_SHOP_IMAGES.length}`} style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          {TEA_SHOP_IMAGES.map((item, index) => (
            <View key={item.title} style={{ width: index === teaShopIndex ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: index === teaShopIndex ? th.brand : th.border }} />
          ))}
        </View>
      </View>

      <ErrorBox error={error} />

      {(() => {
        const days = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);
        const lakh = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(1)} L` : formatINR(String(n), { decimals: false }));
        const oldestUnclosed = [...pendingDates].sort()[0] ?? null;
        const unclosedBranches = new Set(pending.map((p) => p.locationId)).size;
        const lines: Array<{ key: string; dot: string; text: string; age: number; cta: string; go: () => void }> = [];
        if (wait.closings > 0) lines.push({ key: 'c', dot: '#dc2626', text: `${wait.closings} closing${wait.closings === 1 ? '' : 's'} wait for your approval`, age: days(wait.oldestClosing), cta: 'Review', go: () => router.push('/approvals?tab=closing' as any) });
        if (wait.expenses > 0) lines.push({ key: 'e', dot: '#dc2626', text: `${wait.expenses} expense${wait.expenses === 1 ? '' : 's'} wait for your approval, ${whole(wait.amount)}`, age: days(wait.oldestExpense), cta: 'Review', go: () => router.push('/approvals?tab=expenses' as any) });
        if (wait.requests > 0) lines.push({ key: 'r', dot: '#f59e0b', text: `${wait.requests} request${wait.requests === 1 ? '' : 's'} to enter a missed day`, age: 0, cta: 'Review', go: () => router.push('/approvals?tab=backdate' as any) });
        if (unclosedBranches > 0) lines.push({ key: 'u', dot: '#f59e0b', text: `${unclosedBranches} branch${unclosedBranches === 1 ? '' : 'es'} not closed since ${prettyDate(oldestUnclosed!)}`, age: days(oldestUnclosed), cta: 'View', go: () => { setPendingPage(1); setPendingOpen(true); } });
        if (wait.overdue > 0) lines.push({ key: 'd', dot: '#dc2626', text: `${lakh(wait.overdue)} overdue to suppliers`, age: 0, cta: 'Plan', go: () => router.push('/more/purchases' as any) });
        if (lines.length === 0) return null;
        return (
          <Card style={{ gap: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ color: th.ink, fontSize: 18, fontWeight: '800' }}>Needs your attention</Text>
              <View style={{ minWidth: 28, height: 24, borderRadius: 12, paddingHorizontal: 8, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#b91c1c', fontSize: 12, fontWeight: '800' }}>{lines.length}</Text>
              </View>
            </View>
            {lines.map((l, i) => (
              <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: th.border }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: l.dot }} />
                <Text style={{ flex: 1, color: th.ink, fontSize: 14, lineHeight: 20 }}>{l.text}</Text>
                {l.age > 0 ? (
                  <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: '#fef3c7' }}>
                    <Text style={{ color: '#92400e', fontSize: 12, fontWeight: '800' }}>{l.age} days</Text>
                  </View>
                ) : null}
                <Pressable onPress={l.go} accessibilityRole="button" style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: th.brandLight, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: th.brand, fontWeight: '800', fontSize: 14 }}>{l.cta}</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        );
      })()}

      {(() => {
        const t = todayIST();
        const days7 = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
        const bars = sales ? sales.dates.map((d, i) => ({ d, v: sales.total[i] === null || sales.total[i] === undefined ? null : Number(sales.total[i]) })) : [];
        const max = Math.max(1, ...bars.map((b) => b.v ?? 0));
        const total = bars.reduce((a, b) => a + (b.v ?? 0), 0);
        const lakhs = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(1)} L` : formatINR(String(n), { decimals: false }));
        const open = new Set(pending.map((p) => `${p.locationId}|${String(p.businessDate).slice(0, 10)}`));
        const waiting = new Set(awaitingRows.map((x) => `${x.locationId}|${String(x.businessDate).slice(0, 10)}`));
        const grid = branchList.map((b) => ({ id: b.id, name: b.name, cells: days7.map((d) => (open.has(`${b.id}|${d}`) ? 'open' : waiting.has(`${b.id}|${d}`) ? 'wait' : 'done')) }));
        const unclosed = grid.filter((g) => g.cells.includes('open')).length;
        const CELL = { open: { bg: '#fee2e2', fg: '#b91c1c', ch: '!' }, wait: { bg: '#fef3c7', fg: '#92400e', ch: '◔' }, done: { bg: '#ecfdf5', fg: '#047857', ch: '✓' } } as const;
        return (
          <>
            {bars.length > 0 && (
              <Card style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Text style={{ color: th.ink, fontSize: 18, fontWeight: '800' }}>Sales, last 7 days</Text>
                  <Text style={{ color: th.muted, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{lakhs(total)}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 140 }}>
                  {bars.map((b) => (
                    <View key={b.d} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
                      <View style={{ height: b.v === null ? '100%' : `${Math.max(6, (b.v / max) * 100)}%`, borderRadius: 6, backgroundColor: b.v === null ? th.border : th.brand, opacity: b.v === null ? 0.6 : 0.7 }} />
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {bars.map((b) => <Text key={b.d} style={{ flex: 1, textAlign: 'center', color: th.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{b.d.slice(8)}</Text>)}
                </View>
                <Text style={{ color: th.muted, fontSize: 12 }}>▨ Not closed yet, so not counted</Text>
              </Card>
            )}
            {grid.length > 0 && unclosed > 0 && (
              <Card style={{ gap: 10 }}>
                <View>
                  <Text style={{ color: th.ink, fontSize: 18, fontWeight: '800' }}>{unclosed} branch{unclosed === 1 ? '' : 'es'} not closed since</Text>
                  <Text style={{ color: th.muted, fontSize: 13 }}>Last 7 days. One line per branch, not one alert per day.</Text>
                </View>
                <Pressable onPress={() => router.push('/more/closings' as any)} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: th.brandLight, justifyContent: 'center' }}>
                  <Text style={{ color: th.brand, fontWeight: '800' }}>Open closing backlog</Text>
                </Pressable>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: th.brandLight, borderRadius: 8, paddingVertical: 8 }}>
                      <Text style={{ width: 112, paddingLeft: 10, color: th.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>BRANCH</Text>
                      {days7.map((d) => <Text key={d} style={{ width: 42, textAlign: 'center', color: th.muted, fontSize: 12, fontWeight: '700' }}>{d.slice(8)}</Text>)}
                    </View>
                    {grid.map((g) => (
                      <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: th.border }}>
                        <Text numberOfLines={1} style={{ width: 112, paddingLeft: 10, color: th.ink, fontWeight: '700' }}>{g.name}</Text>
                        {g.cells.map((c, i) => {
                          const k = CELL[c as keyof typeof CELL];
                          return (
                            <View key={days7[i]} style={{ width: 42, alignItems: 'center' }}>
                              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: k.bg, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: k.fg, fontWeight: '800', fontSize: 13 }}>{k.ch}</Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
                <Text style={{ color: th.muted, fontSize: 12 }}>! Not closed   ◔ Waiting for you   ✓ Closed</Text>
              </Card>
            )}
          </>
        );
      })()}

      {pendingDates.length + wait.closings + wait.expenses > 0 && (() => {
        const oldest = [...pendingDates].sort()[0];
        const branches = new Set(pending.map((p) => p.locationId)).size;
        const parts: string[] = [];
        if (wait.closings) parts.push(`${wait.closings} closing${wait.closings === 1 ? '' : 's'} wait for your approval.`);
        if (wait.expenses) parts.push(`${wait.expenses} expense${wait.expenses === 1 ? '' : 's'} wait for your approval.`);
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: th.warn.border, backgroundColor: th.warn.bg }}>
            <Feather name="alert-triangle" size={20} color={th.warn.text} />
            <Text style={{ flex: 1, color: th.warn.text, fontSize: 14, lineHeight: 21 }}>
              {pendingDates.length > 0 ? <Text style={{ fontWeight: '800' }}>{`${branches} branch${branches === 1 ? '' : 'es'} not closed since ${prettyDate(oldest)}. `}</Text> : null}
              {parts.join(' ')}
            </Text>
            <Button
              title="Review" small
              onPress={() => { if (pendingDates.length > 0) { setPendingPage(1); setPendingOpen(true); } else router.push('/approvals' as any); }}
            />
          </View>
        );
      })()}
      <Sheet open={pendingOpen} onClose={() => setPendingOpen(false)} title={`Closing pending (${pending.length})`}>
        {pendingDates.slice((pendingPage - 1) * 10, pendingPage * 10).map((d) => (
          <View key={d} style={{ gap: 8 }}>
            <Text style={{ color: th.ink, fontWeight: '700' }}>{prettyDate(d)}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {pending.filter((p) => p.businessDate === d).map((p) => (
                <Pressable
                  key={p.locationId} accessibilityRole="button"
                  onPress={() => { setPendingOpen(false); router.push(`/more/closing/${p.locationId}/${d}` as any); }}
                  style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, justifyContent: 'center', borderColor: th.bad.border, backgroundColor: th.bad.bg }}
                >
                  <Text style={{ color: th.bad.text, fontWeight: '600' }}>⛔ {p.locationName}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {pendingDates.length > 10 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Button title="Previous" variant="secondary" style={{ flex: 1 }} disabled={pendingPage <= 1} onPress={() => setPendingPage((p) => p - 1)} />
            <Text style={{ color: th.muted }}>{pendingPage} / {Math.ceil(pendingDates.length / 10)}</Text>
            <Button title="Next" variant="secondary" style={{ flex: 1 }} disabled={pendingPage >= Math.ceil(pendingDates.length / 10)} onPress={() => setPendingPage((p) => p + 1)} />
          </View>
        ) : null}
      </Sheet>

      {tl ? (
        <>
          <Text style={{ color: th.ink, fontSize: 20, fontWeight: '800' }}>Overview</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            <StatCard icon="shopping-bag" mdi="cart-outline" accent="purple" value={whole(tl.totalPurchases)} label="Purchases" />
            <StatCard icon="dollar-sign" mdi="purse-outline" accent="green" value={whole(tl.cash)} label="Cash" />
            <StatCard icon="smartphone" mdi="qrcode-scan" accent="sky" value={whole(tl.upi)} label="UPI" />
            <StatCard icon="credit-card" mdi="credit-card-outline" accent="blue" value={whole(tl.card)} label="Card" />
            <StatCard icon="trash-2" mdi="delete-outline" accent="red" value={whole(tl.wastage)} label="Wastage" />
            <StatCard icon="alert-triangle" mdi="scale-balance" accent="green" tone={tl.hasCashShortage ? 'bad' : 'neutral'} alert={tl.hasCashShortage} value={whole(tl.cashVariance)} label="Cash variance" sub={tl.hasCashShortage ? '▼ Shortage' : dec(tl.cashVariance).isZero() ? '✓ Tallied' : undefined} />
            <StatCard icon="clock" mdi="clock-outline" accent="amber" tone={tl.pendingClosings > 0 ? 'warn' : 'ok'} value={`${tl.pendingClosings} / ${tl.branchCount}`} label="Not submitted Closings" />
            <StatCard icon="box" mdi="package-variant-closed" accent="sky" value={whole(tl.totalStockValue)} label="Stock value" />
            <StatCard icon="alert-triangle" mdi="clipboard-alert-outline" accent="rose" tone={dec(tl.stockVariance).isNegative() ? 'bad' : 'neutral'} value={whole(tl.stockVariance)} label="Stock variance" sub={dec(tl.stockVariance).isNegative() ? '▼ Shortage' : dec(tl.stockVariance).isZero() ? undefined : '▲ Excess'} />
            <StatCard icon="user" mdi="account-cash-outline" accent="purple" value={whole(tl.salaryPayable)} label="Salary payable" />
            <StatCard icon="shopping-bag" mdi="storefront-outline" accent="blue" value={whole(tl.supplierOutstanding)} label="Supplier outstanding" />
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

          <DashboardOrders refreshKey={summary} />
          <DashboardCharts />
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
