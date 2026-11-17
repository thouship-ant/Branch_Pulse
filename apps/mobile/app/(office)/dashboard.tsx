import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/Text';
import { DashboardOrders } from '@/components/DashboardOrders';
import { PeriodPill } from '@/components/PeriodPill';
import { ProfilePill } from '@/components/TeaShopHeaderActions';
import { ACCENT, Banner, Button, Card, Chip, ErrorBox, H3, HeroCard, Loading, Muted, Screen, Sheet, StatCard, StatusPill, cardLook, type AccentName, type IconName, type MdiName } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { periodLabel, periodQuery, resolvePeriod, type Period } from '@/lib/period';
import { dec, formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import { useSession } from '@/lib/session';
import { useBranches } from '@/lib/useLookups';
import { useLive } from '@/lib/live';

interface Exc { code: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; locationName?: string; businessDate?: string; metric?: string }
interface PendingClosing { locationId: string; locationName: string; businessDate: string; status: string }

const SEV = { CRITICAL: { tone: 'bad', icon: '⛔' }, WARNING: { tone: 'warn', icon: '⚠' }, INFO: { tone: 'sky', icon: 'ⓘ' } } as const;
const whole = (v: string | number | null | undefined) => formatINR(v == null ? null : String(v), { decimals: false });
const compactMoney = (v: string | number | null | undefined) => {
  const amount = Number(v);
  if (!Number.isFinite(amount)) return whole(v);
  if (Math.abs(amount) >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(1)} Cr`;
  if (Math.abs(amount) >= 100_000) return `₹${(amount / 100_000).toFixed(1)} L`;
  return whole(v);
};
export default function DashboardScreen() {
  const th = useTheme();
  const { width } = useWindowDimensions();
  const { me } = useSession();
  const isTeaShop = me?.company?.businessType === 'TEA_SHOP';
  const today = todayIST();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('today', today));
  const [summary, setSummary] = useState<any>(null);
  const [exceptions, setExceptions] = useState<Exc[]>([]);
  const [pending, setPending] = useState<PendingClosing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingPage, setPendingPage] = useState(1);
  const [hideAmounts, setHideAmounts] = useState(false);
  const branchList = useBranches();
  const [wait, setWait] = useState({ expenses: 0, amount: 0, closings: 0, requests: 0, oldestExpense: null as string | null, oldestClosing: null as string | null, overdue: 0 });

  const load = useCallback(async () => {
    try {
      const [s, ex, pc] = await Promise.all([
        api.get(`/dashboard/summary?${periodQuery(period)}`),
        api.full.get<Exc[]>('/exceptions').catch(() => ({ data: [] as Exc[] })),
        api.get<PendingClosing[]>('/pending-closings').catch(() => [] as PendingClosing[]),
      ]);
      const [we, wc, wr, pu] = await Promise.all([
        api.get<any[]>('/expenses?status=SUBMITTED&pageSize=100').catch(() => [] as any[]),
        api.get<any[]>('/closings/awaiting').catch(() => [] as any[]),
        api.get<any[]>('/backdate-requests?status=PENDING').catch(() => [] as any[]),
        api.get<any>(`/purchases/summary?from=${addDays(todayIST(), -29)}&to=${todayIST()}`).catch(() => null),
      ]);
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

  const tl = summary?.tiles;
  const change = summary?.vsLastWeek.salesChangePct;
  const pendingDates = [...new Set(pending.map((p) => p.businessDate))];
  const pendingBranchCount = new Set(pending.map((p) => p.locationId)).size;
  const oldestPendingDate = [...pendingDates].sort()[0];
  const when = periodLabel(period);
  const vs = summary?.vsLastWeek.comparedWith === 'PREVIOUS_PERIOD' ? 'vs previous period' : 'vs last week';
  const teaShopVs = period.id === 'today' ? 'vs same day last week' : vs;
  const amount = (value: string | number | null | undefined) => hideAmounts ? '••••' : whole(value);
  const compactAmount = (value: string | number | null | undefined) => hideAmounts ? '••••' : compactMoney(value);
  const attentionSummary = [
    pendingBranchCount > 0 ? `${pendingBranchCount} branches not closed${oldestPendingDate ? ` since ${prettyDate(oldestPendingDate)}` : ''}.` : '',
    wait.closings > 0 ? `${wait.closings} closings wait for your approval.` : '',
    wait.expenses > 0 ? `${wait.expenses} expenses wait for approval.` : '',
    wait.requests > 0 ? `${wait.requests} request${wait.requests === 1 ? '' : 's'} to enter a missed day.` : '',
    wait.overdue > 0 ? `${compactAmount(wait.overdue)} overdue to suppliers.` : '',
  ].filter(Boolean).join(' ');
  const showAttention = pendingBranchCount > 0 || wait.closings > 0 || wait.expenses > 0 || wait.requests > 0 || wait.overdue > 0;
  const notifications = wait.closings + wait.expenses + wait.requests;
  const headerRight = (
    // the profile pill on top, the period (date) picker right below it
    <View style={{ alignItems: 'flex-end', gap: 6 }}>
      {/* top row: eye, bell, then the profile; the date picker sits below */}
      {isTeaShop ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Pressable onPress={() => setHideAmounts((hidden) => !hidden)} accessibilityRole="button" accessibilityLabel={hideAmounts ? 'Show amounts' : 'Hide amounts'} hitSlop={4} style={{ width: 32, height: 34, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={hideAmounts ? 'eye-off' : 'eye'} size={19} color="#fff7ed" />
          </Pressable>
          <Pressable onPress={() => router.push('/approvals' as any)} accessibilityRole="button" accessibilityLabel={`Approvals${notifications ? `, ${notifications} pending` : ''}`} hitSlop={4} style={{ width: 32, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: 2 }}>
              <Feather name="bell" size={19} color="#fff7ed" />
              {notifications > 0 ? (
                <View style={{ position: 'absolute', top: 1, right: -1, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' }}>
                  <Text allowFontScaling={false} style={{ color: '#fff', fontSize: 9, lineHeight: 11, fontWeight: '800' }}>{notifications > 99 ? '99+' : notifications}</Text>
                </View>
              ) : null}
          </Pressable>
          <ProfilePill onPress={() => router.push('/account' as any)} />
        </View>
      ) : null}
      <PeriodPill period={period} today={today} onChange={setPeriod} />
    </View>
  );

  return (
    <Screen hero onRefresh={load} headerSubtitle={isTeaShop ? 'All Figures' : undefined} headerRight={headerRight}>
      {isTeaShop && tl ? (
        <View style={{ gap: 12 }}>
          <View style={{ minHeight: 78, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8 }}>
            
            <Text numberOfLines={2} style={{ color: '#32190f', fontSize: 24, lineHeight: 30, fontWeight: '800' }}>
              {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'}, {me?.fullName} 👋
            </Text>
            <Text numberOfLines={2} style={{ color: '#4a3020', fontSize: 13, lineHeight: 18 }}>
              {prettyDate(today)} · {Math.max(0, Number(tl.branchCount ?? branchList.length) - Number(tl.pendingClosings ?? pendingBranchCount))}/{Number(tl.branchCount ?? branchList.length)} branches closed today
            </Text>
          </View>
          {showAttention && (
            <View style={{ minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: '#f4c976', backgroundColor: 'rgba(255,235,194,0.96)' }}>
              <Feather name="alert-triangle" size={18} color="#8f4a12" />
              <Text numberOfLines={4} style={{ flex: 1, color: '#45220f', fontSize: 13, lineHeight: 18 }}>
                <Text style={{ fontWeight: '800' }}>{attentionSummary.split('. ')[0]}{attentionSummary.includes('. ') ? '.' : ''}</Text>
                {attentionSummary.includes('. ') ? ` ${attentionSummary.slice(attentionSummary.indexOf('. ') + 2)}` : ''}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => {
                if (wait.overdue > 0 && wait.closings === 0 && wait.expenses === 0 && pending.length === 0) router.push('/more/purchases' as any);
                else if (pending.length > 0 && wait.closings === 0 && wait.expenses === 0) { setPendingPage(1); setPendingOpen(true); }
                else router.push('/approvals' as any);
              }} style={{ minHeight: 34, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#54210d', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ color: '#fff7ed', fontSize: 11, fontWeight: '700' }}>Review</Text>
                <Feather name="arrow-right" size={13} color="#fff7ed" />
              </Pressable>
            </View>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 }}>
            <HomeShopMetric label={`Total sales · ${when}`} value={amount(tl.totalSales)} icon="trending-up" background="#b65317" onPress={() => router.push('/more/pl' as any)} />
            <HomeShopMetric label="Cash" value={amount(tl.cash)} icon="dollar-sign" mdi="purse-outline" background="#23933d" onPress={() => router.push('/more/cash' as any)} />
            <HomeShopMetric label={`Expenses · ${when}`} value={amount(tl.totalExpenses)} icon="credit-card" background="#8436a8" onPress={() => router.push('/more/expenses' as any)} />
            <HomeShopMetric label="Supplier outstanding" value={compactAmount(tl.supplierOutstanding)} sub={wait.overdue > 0 ? `${compactAmount(wait.overdue)} overdue` : undefined} icon="shopping-bag" mdi="storefront-outline" background="#bd3549" onPress={() => router.push('/more/purchases' as any)} />
          </View>
        </View>
      ) : !isTeaShop && tl ? (
        <>
        <HeroCard
          icon="trending-up" label={`Total Sales (${when})`} value={amount(tl.totalSales)}
          sub={change == null ? undefined : `${Number(change) >= 0 ? '▲' : '▼'} ${Math.abs(Number(change))}% ${vs}`}
          columns={[
            { label: 'Net Operating', value: amount(tl.netOperating), color: dec(tl.netOperating).isNegative() ? th.bad.text : th.ok.text },
            { label: 'Expenses', value: amount(tl.totalExpenses), color: th.warn.text },
          ]}
        />
        </>
      ) : !tl ? (
        <Card><Loading /></Card>
      ) : null}

      <ErrorBox error={error} />

      {(() => {
        const days = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);
        const lakh = (n: number) => hideAmounts ? '••••' : n >= 100000 ? `₹${(n / 100000).toFixed(1)} L` : formatINR(String(n), { decimals: false });
        const oldestUnclosed = [...pendingDates].sort()[0] ?? null;
        const unclosedBranches = new Set(pending.map((p) => p.locationId)).size;
        const lines: Array<{ key: string; dot: string; text: string; age: number; cta: string; go: () => void }> = [];
        if (wait.closings > 0) lines.push({ key: 'c', dot: '#dc2626', text: `${wait.closings} closing${wait.closings === 1 ? '' : 's'} wait for your approval`, age: days(wait.oldestClosing), cta: 'Review', go: () => router.push('/approvals?tab=closing' as any) });
        if (wait.expenses > 0) lines.push({ key: 'e', dot: '#dc2626', text: `${wait.expenses} expense${wait.expenses === 1 ? '' : 's'} wait for your approval, ${amount(wait.amount)}`, age: days(wait.oldestExpense), cta: 'Review', go: () => router.push('/approvals?tab=expenses' as any) });
        if (wait.requests > 0) lines.push({ key: 'r', dot: '#f59e0b', text: `${wait.requests} request${wait.requests === 1 ? '' : 's'} to enter a missed day`, age: 0, cta: 'Review', go: () => router.push('/approvals?tab=backdate' as any) });
        if (unclosedBranches > 0) lines.push({ key: 'u', dot: '#f59e0b', text: `${unclosedBranches} branch${unclosedBranches === 1 ? '' : 'es'} not closed since ${prettyDate(oldestUnclosed!)}`, age: days(oldestUnclosed), cta: 'View', go: () => { setPendingPage(1); setPendingOpen(true); } });
        if (wait.overdue > 0) lines.push({ key: 'd', dot: '#dc2626', text: `${lakh(wait.overdue)} overdue to suppliers`, age: 0, cta: 'Plan', go: () => router.push('/more/purchases' as any) });
        if (lines.length === 0) return null;
        return (
          <Card style={{ gap: 0, padding: 12, borderRadius: 18, backgroundColor: 'rgba(255,250,244,0.96)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#f8ead9', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="bell" size={15} color="#6a351c" />
                </View>
                <Text style={{ color: th.ink, fontSize: 16, fontWeight: '800' }}>Needs your attention</Text>
              </View>
              <View style={{ minWidth: 28, height: 24, borderRadius: 12, paddingHorizontal: 8, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#b91c1c', fontSize: 12, fontWeight: '800' }}>{lines.length}</Text>
              </View>
            </View>
            {lines.map((l, i) => (
              <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: th.border }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: l.dot }} />
                <Text style={{ flex: 1, color: th.ink, fontSize: 12, lineHeight: 16 }}>{l.text}</Text>
                {l.age > 0 ? (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#fef0b8' }}>
                    <Text style={{ color: '#8a4b0d', fontSize: 10, fontWeight: '800' }}>{l.age} days</Text>
                  </View>
                ) : null}
                <Pressable onPress={l.go} accessibilityRole="button" style={{ minHeight: 32, paddingHorizontal: 11, borderRadius: 999, backgroundColor: '#f8e9df', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                  <Text style={{ color: '#54210d', fontWeight: '700', fontSize: 11 }}>{l.cta}</Text>
                  <Feather name="arrow-right" size={12} color="#54210d" />
                </Pressable>
              </View>
            ))}
          </Card>
        );
      })()}

      {isTeaShop && tl ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 }}>
            <ShopMetric label="Total sales" value={amount(tl.totalSales)} icon="trending-up" accent="blue" subColor={change == null ? undefined : Number(change) >= 0 ? th.ok.text : th.bad.text} sub={change == null ? undefined : `${Number(change) >= 0 ? '▲' : '▼'} ${Math.abs(Number(change))}% ${teaShopVs}`} onPress={() => router.push('/more/pl' as any)} />
            <ShopMetric label="Expenses" value={amount(tl.totalExpenses)} icon="credit-card" accent="amber" onPress={() => router.push('/more/expenses' as any)} />
            <ShopMetric label="Net" value={amount(tl.netOperating)} icon="bar-chart-2" accent="green" onPress={() => router.push('/more/pl' as any)} />
            <ShopMetric label="Purchases" value={amount(tl.totalPurchases)} icon="shopping-cart" mdi="cart-outline" accent="purple" onPress={() => router.push('/more/purchases' as any)} />
            <ShopMetric label="Cash" value={amount(tl.cash)} icon="dollar-sign" mdi="purse-outline" accent="green" onPress={() => router.push('/more/cash' as any)} />
            <ShopMetric label="UPI" value={amount(tl.upi)} icon="smartphone" mdi="qrcode-scan" accent="sky" onPress={() => router.push('/more/cash' as any)} />
            <ShopMetric label="Card" value={amount(tl.card)} icon="credit-card" accent="blue" onPress={() => router.push('/more/cash' as any)} />
            <ShopMetric label="Wastage" value={amount(tl.wastage)} icon="trash-2" accent="red" onPress={() => router.push('/more/inventory' as any)} />
            <ShopMetric label="Profit/Loss" value={amount(tl.netOperating)} icon="bar-chart-2" mdi="scale-balance" accent="green" onPress={() => router.push('/more/pl' as any)} />
            <ShopMetric label="Pending bills" value={amount(tl.supplierOutstanding)} icon="clock" accent="amber" onPress={() => router.push('/more/purchases' as any)} />
          </View>
        </>
      ) : null}

      {!isTeaShop && pendingDates.length + wait.closings + wait.expenses > 0 && (() => {
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
          {!isTeaShop ? (
            <>
              <Text style={{ color: th.ink, fontSize: 20, fontWeight: '800' }}>Overview</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                <StatCard icon="shopping-bag" mdi="cart-outline" accent="purple" value={amount(tl.totalPurchases)} label="Purchases" />
                <StatCard icon="dollar-sign" mdi="purse-outline" accent="green" value={amount(tl.cash)} label="Cash" />
                <StatCard icon="smartphone" mdi="qrcode-scan" accent="sky" value={amount(tl.upi)} label="UPI" />
                <StatCard icon="credit-card" mdi="credit-card-outline" accent="blue" value={amount(tl.card)} label="Card" />
                <StatCard icon="trash-2" mdi="delete-outline" accent="red" value={amount(tl.wastage)} label="Wastage" />
                <StatCard icon="alert-triangle" mdi="scale-balance" accent="green" tone={tl.hasCashShortage ? 'bad' : 'neutral'} alert={tl.hasCashShortage} value={amount(tl.cashVariance)} label="Cash variance" sub={tl.hasCashShortage ? '▼ Shortage' : dec(tl.cashVariance).isZero() ? '✓ Tallied' : undefined} />
                <StatCard icon="clock" mdi="clock-outline" accent="amber" tone={tl.pendingClosings > 0 ? 'warn' : 'ok'} value={`${tl.pendingClosings} / ${tl.branchCount}`} label="Not submitted Closings" />
                <StatCard icon="box" mdi="package-variant-closed" accent="sky" value={amount(tl.totalStockValue)} label="Stock value" />
                <StatCard icon="alert-triangle" mdi="clipboard-alert-outline" accent="rose" tone={dec(tl.stockVariance).isNegative() ? 'bad' : 'neutral'} value={amount(tl.stockVariance)} label="Stock variance" sub={dec(tl.stockVariance).isNegative() ? '▼ Shortage' : dec(tl.stockVariance).isZero() ? undefined : '▲ Excess'} />
                <StatCard icon="user" mdi="account-cash-outline" accent="purple" value={amount(tl.salaryPayable)} label="Salary payable" />
                <StatCard icon="shopping-bag" mdi="storefront-outline" accent="blue" value={amount(tl.supplierOutstanding)} label="Supplier outstanding" />
              </View>
            </>
          ) : null}

          <Text style={{ color: th.ink, fontSize: 20, fontWeight: '800' }}>Branches</Text>
          {summary.branches.length === 0 && <Muted>No branches yet.</Muted>}
          {summary.branches.map((b: any) => (
            <Card key={b.locationId} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '800', fontSize: 17, flex: 1 }}>{b.name}</Text>
                <StatusPill status={b.closingStatus} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Metric label="Sales" value={amount(b.sales)} />
                <Metric label="Expenses" value={amount(b.expenses)} />
                <Metric label="Net" value={amount(b.net)} bad={dec(b.net).isNegative()} />
                <Metric label="Cash diff" value={b.cashVariance == null ? '—' : amount(b.cashVariance)} bad={b.cashVariance != null && dec(b.cashVariance).isNegative()} />
              </View>
            </Card>
          ))}

          <DashboardOrders refreshKey={summary} />
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

function ShopMetric({ label, value, icon, mdi, accent, sub, subColor, onPress }: {
  label: string; value: string; icon: IconName; mdi?: MdiName; accent: AccentName; sub?: string; subColor?: string; onPress: () => void;
}) {
  const th = useTheme();
  const colors = ACCENT[accent];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => [{
        width: '48%', minHeight: 126, padding: 14, gap: 10, borderRadius: 18,
        borderWidth: 1, borderColor: th.border, backgroundColor: th.surface, opacity: pressed ? 0.84 : 1,
      }, cardLook(th)]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
          {mdi
            ? <MaterialCommunityIcons name={mdi} size={22} color={colors.fg} />
            : <Feather name={icon} size={21} color={colors.fg} />}
        </View>
        <Text numberOfLines={2} style={{ flex: 1, color: th.ink, fontSize: 14, fontWeight: '600', lineHeight: 18 }}>{label}</Text>
        <Feather name="chevron-right" size={18} color={th.muted} />
      </View>
      <View>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: th.ink, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
        {sub ? <Text numberOfLines={2} style={{ color: subColor ?? th.muted, fontSize: 11, lineHeight: 15 }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function HomeShopMetric({ label, value, icon, mdi, background, sub, onPress }: {
  label: string; value: string; icon: IconName; mdi?: MdiName; background: string; sub?: string; onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [{
        width: '48%', minHeight: 76, padding: 10, borderRadius: 15, overflow: 'hidden',
        flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: background, opacity: pressed ? 0.86 : 1,
        shadowColor: '#45220f', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
      }]}
    >
      <View style={{ width: 28, height: 28, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)' }}>
        {mdi ? <MaterialCommunityIcons name={mdi} size={17} color="#fff" /> : <Feather name={icon} size={16} color="#fff" />}
      </View>
      <View style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: 'rgba(255,255,255,0.92)', fontSize: 10, lineHeight: 13, fontWeight: '500' }}>{label}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ marginTop: 2, color: '#fff', fontSize: 20, lineHeight: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
        {sub ? <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.9)', fontSize: 9, lineHeight: 11 }}>{sub}</Text> : null}
      </View>
      {mdi ? (
        <MaterialCommunityIcons name={mdi} size={46} color="#fff" style={{ position: 'absolute', right: -2, bottom: -7, opacity: 0.16 }} />
      ) : (
        <Feather name={icon} size={46} color="#fff" style={{ position: 'absolute', right: -2, bottom: -7, opacity: 0.16 }} />
      )}
    </Pressable>
  );
}
