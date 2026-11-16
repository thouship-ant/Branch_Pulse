import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/Text';
import { BackdateRequests } from '@/components/BackdateRequests';
import { ClosingTimer } from '@/components/ClosingTimer';
import { Banner, Button, Card, Chip, ErrorBox, HeroCard, LinkCard, Loading, Screen, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { prettyDate, prettyTime, todayIST } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useBranch, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useLive } from '@/lib/live';
import { startEntry } from '@/lib/workDate';

// the step of the day's entry each checklist row opens (Sales, Purchases, Expense, then the cash count and closing)
const STEP: Record<string, number> = { '/sales': 0, '/purchases': 1, '/expense': 2, '/cash': 3 };

/** Today's checklist for the branch: sales, expenses, cash count, closing. */
export default function BranchHome() {
  const th = useTheme();
  const router = useRouter();
  const { locationId } = useBranch();
  const { can } = useSession();
  const date = todayIST();
  const [screen, setScreen] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [s, e, p] = await Promise.all([
        api.get(`/closings/${locationId}/${date}`),
        api.get(`/expenses?locationId=${locationId}&from=${date}&to=${date}&pageSize=100`),
        api.get<any[]>(`/purchases?locationId=${locationId}&from=${date}&to=${date}&pageSize=50`).catch(() => [] as any[]),
      ]);
      setScreen(s); setExpenses(e); setPurchases(p); setError(null);
    } catch (err: any) { setError(err.message); }
  }, [locationId, date]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useLive(load);

  if (!screen && !error) return <Screen hero><Card><Loading /></Card></Screen>;

  const closing = screen?.closing;
  const sales = screen?.sales;
  const cash = screen?.cash;
  const live = expenses.filter((e) => e.status === 'ACTIVE');
  const total = live.reduce((a, e) => a + Number(e.amount), 0);
  const counted = cash?.actualClosing != null;
  const livePurchases = purchases.filter((p) => p.status === 'ACTIVE');
  const status = closing?.status ?? 'PENDING';
  const submitted = ['SUBMITTED', 'APPROVED'].includes(status);

  const cards = [
    { path: '/sales', icon: 'trending-up', title: 'Sales', detail: sales ? formatINR(sales.totalSales) : '—', done: !!sales },
    { path: '/purchases', icon: 'shopping-bag', title: 'Purchases', detail: `${formatINR(String(livePurchases.reduce((a, p) => a + Number(p.totalAmount), 0)), { decimals: false })} (${livePurchases.length})`, done: livePurchases.length > 0 },
    { path: '/expense', icon: 'credit-card', title: 'Expenses', detail: `${formatINR(String(total), { decimals: false })} (${live.length})`, done: live.length > 0 },
    { path: '/cash', icon: 'dollar-sign', title: 'Cash reconciliation', detail: counted ? formatINR(cash.actualClosing) : '—', done: counted },
  ] as const;
  const stepsDone = cards.filter((c) => c.done).length + (submitted ? 1 : 0);
  const stepsTotal = cards.length + 1;

  return (
    <Screen hero onRefresh={load}>
      <BackdateRequests locationId={locationId} />
      <HeroCard
        icon="check-square" label={`Today · ${prettyDate(date)}`} value={`${stepsDone}/${stepsTotal}`} sub="steps done"
        columns={[
          { label: 'Sales', value: sales ? formatINR(sales.totalSales, { decimals: false }) : '—', color: th.ok.text },
          { label: 'Expenses', value: formatINR(String(total), { decimals: false }), color: th.warn.text },
        ]}
      >
        <ClosingTimer locationId={locationId} done={submitted} />
        <View style={{ gap: 6 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: th.brandLight, overflow: 'hidden' }}>
            <View style={{ width: `${(stepsDone / stepsTotal) * 100}%`, height: '100%', backgroundColor: th.brand, borderRadius: 4 }} />
          </View>
          <Text style={{ color: th.muted, fontSize: 12, fontWeight: '500' }}>{stepsDone === stepsTotal ? '✓ All done for today' : 'Keep going'}</Text>
        </View>
        {!submitted ? <Button title="Enter step by step" icon="arrow-right" onPress={() => void startEntry(date)} /> : null}
      </HeroCard>

      <ErrorBox error={error} />
      {status === 'REJECTED' && <Banner tone="bad">✕ Closing rejected{closing?.reviewComment ? `: ${closing.reviewComment}` : ''}</Banner>}
      {status === 'REOPENED' && <Banner tone="violet">↺ Closing reopened{closing?.reviewComment ? `: ${closing.reviewComment}` : ''}</Banner>}

      <Text style={{ color: th.ink, fontSize: 20, fontWeight: '800' }}>Checklist</Text>
      {cards.map((c) => (
        <LinkCard
          key={c.path} icon={c.icon} title={c.title} detail={c.detail} done={c.done} onPress={() => void startEntry(date, STEP[c.path] ?? 0)}
          right={<Chip text={c.done ? 'Done' : 'Not done'} tone={c.done ? 'ok' : 'neutral'} icon={c.done ? '✓' : '○'} />}
        />
      ))}
      <LinkCard
        icon="check-square" title="Closing" onPress={() => void startEntry(date, 3)}
        detail={closing?.submittedAt ? prettyTime(closing.submittedAt) : undefined} right={<StatusPill status={status} />}
      />
      <Text style={{ color: th.faint, fontSize: 12, textAlign: 'center' }}>Pull down to refresh. Entries save to the server straight away, so you need a connection.</Text>
    </Screen>
  );
}
