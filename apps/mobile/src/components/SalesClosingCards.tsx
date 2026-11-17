import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, todayIST } from '@/lib/dates';
import { useLive } from '@/lib/live';
import { formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';

const CELL = { open: { bg: '#fee2e2', fg: '#b91c1c', ch: '!' }, wait: { bg: '#fef3c7', fg: '#92400e', ch: '◔' }, done: { bg: '#ecfdf5', fg: '#047857', ch: '✓' } } as const;

/** "Sales, last 7 days" and "branches not closed since": the two cards that used to sit on the Home page. */
export function SalesClosingCards({ hideAmounts = false }: { hideAmounts?: boolean }) {
  const th = useTheme();
  const router = useRouter();
  const branchList = useBranches();
  const [sales, setSales] = useState<{ dates: string[]; total: Array<string | null> } | null>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [awaiting, setAwaiting] = useState<any[]>([]);

  const load = useCallback(async () => {
    const t = todayIST();
    const [sl, pc, aw] = await Promise.all([
      api.get<any>(`/dashboard/charts/daily-sales-trend?from=${addDays(t, -6)}&to=${t}`).catch(() => null),
      api.get<any[]>('/pending-closings').catch(() => [] as any[]),
      api.get<any[]>('/closings/awaiting').catch(() => [] as any[]),
    ]);
    setSales(sl); setPending(pc); setAwaiting(aw);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useLive(load);

  const t = todayIST();
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const bars = sales ? sales.dates.map((d, i) => ({ d, v: sales.total[i] === null || sales.total[i] === undefined ? null : Number(sales.total[i]) })) : [];
  const max = Math.max(1, ...bars.map((b) => b.v ?? 0));
  const total = bars.reduce((a, b) => a + (b.v ?? 0), 0);
  const lakhs = (n: number) => (hideAmounts ? '••••' : n >= 100000 ? `₹${(n / 100000).toFixed(1)} L` : formatINR(String(n), { decimals: false }));
  const open = new Set(pending.map((p) => `${p.locationId}|${String(p.businessDate).slice(0, 10)}`));
  const waiting = new Set(awaiting.map((x) => `${x.locationId}|${String(x.businessDate).slice(0, 10)}`));
  const grid = branchList.map((b) => ({ id: b.id, name: b.name, cells: days7.map((d) => (open.has(`${b.id}|${d}`) ? 'open' : waiting.has(`${b.id}|${d}`) ? 'wait' : 'done')) }));
  const unclosed = grid.filter((g) => g.cells.includes('open')).length;

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
}
