import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Card, Chip, ErrorBox, HeroCard, LinkCard, Loading, Screen, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { prettyDate, prettyTime, todayIST } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useBranch, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** Today's checklist for the branch: sales, expenses, cash count, closing. */
export default function BranchHome() {
  const th = useTheme();
  const router = useRouter();
  const { locationId } = useBranch();
  const { can } = useSession();
  const date = todayIST();
  const [screen, setScreen] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [s, e] = await Promise.all([
        api.get(`/closings/${locationId}/${date}`),
        api.get(`/expenses?locationId=${locationId}&from=${date}&to=${date}&pageSize=100`),
      ]);
      setScreen(s); setExpenses(e); setError(null);
    } catch (err: any) { setError(err.message); }
  }, [locationId, date]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!screen && !error) return <Screen hero><Card><Loading /></Card></Screen>;

  const closing = screen?.closing;
  const sales = screen?.sales;
  const cash = screen?.cash;
  const live = expenses.filter((e) => e.status === 'ACTIVE');
  const total = live.reduce((a, e) => a + Number(e.amount), 0);
  const counted = cash?.actualClosing != null;
  const status = closing?.status ?? 'PENDING';
  const submitted = ['SUBMITTED', 'APPROVED'].includes(status);

  const cards = [
    { path: '/sales', icon: 'trending-up', title: 'Sales', detail: sales ? formatINR(sales.totalSales) : '—', done: !!sales },
    { path: '/expense', icon: 'credit-card', title: 'Expenses', detail: `${formatINR(String(total), { decimals: false })} (${live.length})`, done: live.length > 0 },
    { path: '/cash', icon: 'dollar-sign', title: 'Cash reconciliation', detail: counted ? formatINR(cash.actualClosing) : '—', done: counted },
  ] as const;
  const stepsDone = cards.filter((c) => c.done).length + (submitted ? 1 : 0);
  const stepsTotal = cards.length + 1;

  return (
    <Screen hero onRefresh={load}>
      <HeroCard
        icon="check-square" label={`Today · ${prettyDate(date)}`} value={`${stepsDone}/${stepsTotal}`} sub="steps done"
        columns={[
          { label: 'Sales', value: sales ? formatINR(sales.totalSales, { decimals: false }) : '—', color: th.ok.text },
          { label: 'Expenses', value: formatINR(String(total), { decimals: false }), color: th.warn.text },
        ]}
      >
        <View style={{ gap: 6 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: th.brandLight, overflow: 'hidden' }}>
            <View style={{ width: `${(stepsDone / stepsTotal) * 100}%`, height: '100%', backgroundColor: th.brand, borderRadius: 4 }} />
          </View>
          <Text style={{ color: th.muted, fontSize: 12, fontWeight: '500' }}>{stepsDone === stepsTotal ? '✓ All done for today' : 'Keep going'}</Text>
        </View>
      </HeroCard>

      <ErrorBox error={error} />
      {status === 'REJECTED' && <Banner tone="bad">✕ Closing rejected{closing?.reviewComment ? `: ${closing.reviewComment}` : ''}</Banner>}
      {status === 'REOPENED' && <Banner tone="violet">↺ Closing reopened{closing?.reviewComment ? `: ${closing.reviewComment}` : ''}</Banner>}

      <Text style={{ color: th.ink, fontSize: 20, fontWeight: '800' }}>Checklist</Text>
      {cards.map((c) => (
        <LinkCard
          key={c.path} icon={c.icon} title={c.title} detail={c.detail} done={c.done} onPress={() => router.push(c.path)}
          right={<Chip text={c.done ? 'Done' : 'Not done'} tone={c.done ? 'ok' : 'neutral'} icon={c.done ? '✓' : '○'} />}
        />
      ))}
      <LinkCard icon="box" title="Stock" detail="Count, wastage, purchases" onPress={() => router.push('/stock')} />
      {can('staff:view') ? <LinkCard icon="users" title="Staff" detail="Attendance, advances" onPress={() => router.push('/staff')} /> : null}
      <LinkCard
        icon="check-square" title="Closing" onPress={() => router.push('/closing')}
        detail={closing?.submittedAt ? prettyTime(closing.submittedAt) : undefined} right={<StatusPill status={status} />}
      />
      <Text style={{ color: th.faint, fontSize: 12, textAlign: 'center' }}>Pull down to refresh. Entries save to the server straight away, so you need a connection.</Text>
    </Screen>
  );
}
