import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, View } from 'react-native';
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
const GUIDE_COLLAGE_BACKGROUND = '#e9f1e7';
const GUIDE_STEPS = [
  {
    title: 'Sales Entry',
    kind: 'photo',
    image: require('../../assets/branch-guide/sales-collage.jpg'),
    detail: "Record today's sales.",
  },
  {
    title: 'Purchase Entry',
    kind: 'photo',
    image: require('../../assets/branch-guide/purchases-collage.jpg'),
    detail: 'Record ingredients and stock.',
  },
  {
    title: 'Expenses',
    kind: 'photo',
    image: require('../../assets/branch-guide/expenses-collage.jpg'),
    detail: "Record today's shop costs.",
  },
  {
    title: 'Closing',
    kind: 'photo',
    image: require('../../assets/branch-guide/closing-collage.jpg'),
    detail: 'Reconcile cash and digital payments.',
  },
  {
    title: 'Submit',
    kind: 'verification',
    detail: "Review today's entries, then submit the closing.",
    checks: ['Sales and purchases entered', 'Expenses reviewed', 'Cash and payments reconciled', 'Closing ready to submit'],
  },
] as const;

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
  const [guideIndex, setGuideIndex] = useState(0);

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
  useEffect(() => {
    const timer = setInterval(() => {
      setGuideIndex((index) => (index + 1) % GUIDE_STEPS.length);
    }, 3500);
    return () => clearInterval(timer);
  }, []);

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
  const guideStep = GUIDE_STEPS[guideIndex];

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

      <Card style={{ gap: 12, borderWidth: 1, borderColor: th.brandLight }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: th.ink, fontSize: 15, fontWeight: '800' }}>How to complete today's checklist</Text>
            <Text style={{ color: th.muted, fontSize: 12 }}>Enter each section, then submit your closing.</Text>
          </View>
          <Text style={{ color: th.brand, fontSize: 12, fontWeight: '800' }}>{guideIndex + 1}/{GUIDE_STEPS.length}</Text>
        </View>
        <View accessibilityLabel={`Step ${guideIndex + 1} of ${GUIDE_STEPS.length}: ${guideStep.title}`} style={{ height: 210, borderRadius: 16, overflow: 'hidden', backgroundColor: th.surface }}>
          {guideStep.kind === 'photo' ? (
            <Image source={guideStep.image} resizeMode="contain" style={{ width: '100%', height: 152, backgroundColor: GUIDE_COLLAGE_BACKGROUND }} />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', backgroundColor: th.ok.bg }}>
              <View style={{ paddingHorizontal: 16, gap: 7 }}>
                {guideStep.checks.map((check) => (
                  <View key={check} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: th.ok.border, alignItems: 'center', justifyContent: 'center', backgroundColor: th.surface }}>
                      <Text style={{ color: th.ok.text, fontSize: 13, fontWeight: '900' }}>✓</Text>
                    </View>
                    <Text style={{ color: th.ink, fontSize: 12, fontWeight: '700' }}>{check}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          <View style={{ paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(15, 23, 42, 0.78)' }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{guideStep.title}</Text>
            <Text numberOfLines={2} style={{ color: '#f1f5f9', fontSize: 12 }}>{guideStep.detail}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          {GUIDE_STEPS.map((step) => (
            <View key={step.title} style={{ width: step.title === guideStep.title ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: step.title === guideStep.title ? th.brand : th.border }} />
          ))}
        </View>
      </Card>

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
