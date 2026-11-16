import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { HeaderProvider } from './HeaderContext';
import { PurchaseList } from './Purchasing';
import { Button, Screen } from './ui';
import ClosingScreen from '../../app/(branch)/closing';
import ExpenseScreen from '../../app/(branch)/expense';
import SalesScreen from '../../app/(branch)/sales';
import { api } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { useLive } from '@/lib/live';
import { useTheme } from '@/lib/theme';
import { leaveEntry, setEntryStep, useEntryDay } from '@/lib/workDate';

const STEPS = [
  { key: 'sales', label: 'Sales', icon: 'trending-up' },
  { key: 'purchases', label: 'Purchases', icon: 'shopping-bag' },
  { key: 'expenses', label: 'Expenses', icon: 'credit-card' },
  { key: 'closing', label: 'Closing', icon: 'check-square' },
] as const;

/**
 * Entering a day that was missed and then approved by the Admin: sales, then expenses, then purchases, then the closing and its
 * submit, one after the other. The step reached is remembered, so a day that was left (or the app closed) is opened where it stopped.
 */
export function BackdateEntry({ locationId, onClose }: { locationId: string; onClose?: () => void }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { date, step } = useEntryDay();
  // a step is ticked only when something was really saved for it: sales entered, a purchase, an expense, the closing submitted
  const [done, setDone] = useState<boolean[]>([false, false, false, false]);
  const refresh = useCallback(async () => {
    if (!locationId || !date) return;
    try {
      const [s, e, p] = await Promise.all([
        api.get<any>(`/closings/${locationId}/${date}`),
        api.get<any[]>(`/expenses?locationId=${locationId}&from=${date}&to=${date}&pageSize=100`),
        api.get<any[]>(`/purchases?locationId=${locationId}&from=${date}&to=${date}&pageSize=50`).catch(() => [] as any[]),
      ]);
      setDone([!!s?.sales, p.some((x) => x.status === 'ACTIVE'), e.some((x) => x.status === 'ACTIVE'), ['SUBMITTED', 'APPROVED'].includes(s?.closing?.status ?? 'PENDING')]);
    } catch { /* keep what is shown */ }
  }, [locationId, date]);
  useEffect(() => { void refresh(); }, [refresh, step]);
  useLive(refresh);
  if (!date) return null;
  const close = () => { leaveEntry(); onClose?.(); };
  const last = step === STEPS.length - 1;

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      {/* the pages below draw themselves under the blue header when one is provided; here there is none */}
      <HeaderProvider value={null}>
        <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: insets.top }}>
          <View style={{ backgroundColor: th.surface, borderBottomWidth: 1, borderBottomColor: th.border, paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: th.muted, fontSize: 12, fontWeight: '700' }}>{date === todayIST() ? "Today's entry, step by step" : 'Entering a missed day'}</Text>
                <Text style={{ color: th.ink, fontSize: 18, fontWeight: '800' }}>{prettyDate(date)}</Text>
              </View>
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: th.brandLight, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="x" size={20} color={th.ink} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {STEPS.map((s, i) => {
                const on = i === step;
                const isDone = done[i];
                return (
                  <Pressable
                    key={s.key} onPress={() => setEntryStep(i)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                    style={{ flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: on ? th.brand : isDone ? th.ok.bg : th.brandLight }}
                  >
                    <Feather name={isDone ? 'check' : s.icon} size={16} color={on ? '#fff' : isDone ? th.ok.text : th.muted} />
                    <Text numberOfLines={1} style={{ color: on ? '#fff' : isDone ? th.ok.text : th.muted, fontSize: 11, fontWeight: '800' }}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ flex: 1 }}>
            {step === 0 ? <SalesScreen /> : step === 1 ? <PurchasesStep locationId={locationId} date={date} /> : step === 2 ? <ExpenseScreen /> : <ClosingScreen />}
          </View>

          <View style={{ flexDirection: 'row', gap: 10, padding: 12, paddingBottom: 12 + insets.bottom, backgroundColor: th.surface, borderTopWidth: 1, borderTopColor: th.border }}>
            <View style={{ flex: 1 }}><Button title="Back" variant="secondary" onPress={() => setEntryStep(Math.max(0, step - 1))} disabled={step === 0} /></View>
            <View style={{ flex: 1 }}>{last ? <Button title="Done" onPress={close} disabled={!done.every(Boolean)} /> : <Button title={`Next: ${STEPS[step + 1].label}`} onPress={() => setEntryStep(step + 1)} />}</View>
          </View>
        </View>
      </HeaderProvider>
    </Modal>
  );
}

function PurchasesStep({ locationId, date }: { locationId: string; date: string }) {
  // the purchases of the day, with the "new purchase" form (it saves on the day being entered)
  return <Screen><PurchaseList fixedLocationId={locationId} period={{ id: 'custom', from: date, to: date }} /></Screen>;
}
