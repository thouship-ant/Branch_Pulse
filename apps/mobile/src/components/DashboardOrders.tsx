import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

const money = (v: unknown) => formatINR(String(v ?? 0), { decimals: false });
const PAY = {
  UNPAID: { label: 'Not paid', fg: '#DC2626', bg: '#FEE2E2', dot: '○' },
  PARTIAL: { label: 'Partly paid', fg: '#D97706', bg: '#FEF3C7', dot: '◐' },
  PAID: { label: 'Paid', fg: '#16A34A', bg: '#DCFCE7', dot: '●' },
} as const;
const EVENT: Record<string, string> = { BUSINESS_MEETING: 'Business meeting', FUNCTION: 'Function', PARTY: 'Party', CORPORATE: 'Corporate', OTHER: 'Other' };

/** Home-page block: outside-shop orders coming up, and how much of their value is still to be paid. */
export function DashboardOrders({ refreshKey }: { refreshKey?: unknown }) {
  const th = useTheme();
  const router = useRouter();
  const { can } = useSession();
  const [sum, setSum] = useState<any>(null);
  const [next, setNext] = useState<any[]>([]);
  useEffect(() => {
    if (!can('order:view')) return;
    let alive = true;
    Promise.all([api.get<any>('/orders/summary'), api.get<any[]>(`/orders?status=PLANNED&from=${todayIST()}`)])
      .then(([s, rows]) => { if (alive) { setSum(s); setNext([...rows].sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate))).slice(0, 5)); } })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [can, refreshKey]);
  if (!sum) return null;

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: th.ink, fontSize: 18, fontWeight: '800' }}>Orders</Text>
          <Text style={{ color: th.muted, fontSize: 12 }}>Meetings, functions and other outside-shop orders</Text>
        </View>
        <Pressable onPress={() => router.push('/more/orders' as any)} accessibilityRole="button" style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: th.brandLight, justifyContent: 'center' }}>
          <Text style={{ color: th.brand, fontWeight: '800' }}>View ›</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, borderRadius: 14, padding: 10, backgroundColor: '#EFF6FF' }}>
          <Text style={{ color: '#3B82F6', fontSize: 11, fontWeight: '700' }}>Upcoming</Text>
          <Text style={{ color: th.ink === '#e2e8f0' ? '#1E293B' : '#1E293B', fontSize: 22, fontWeight: '800' }}>{sum.upcoming}</Text>
        </View>
        {(['UNPAID', 'PARTIAL', 'PAID'] as const).map((k) => (
          <View key={k} style={{ flex: 1, borderRadius: 14, padding: 10, backgroundColor: PAY[k].bg }}>
            <Text numberOfLines={1} style={{ color: PAY[k].fg, fontSize: 11, fontWeight: '700' }}>{PAY[k].dot} {PAY[k].label}</Text>
            <Text style={{ color: '#1E293B', fontSize: 22, fontWeight: '800' }}>{sum.counts[k]}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
        <Text style={{ color: th.muted, fontSize: 13 }}>Outstanding</Text>
        <Text style={{ color: th.ink, fontSize: 13 }}>
          <Text style={{ color: '#DC2626', fontWeight: '800', fontSize: 16, fontVariant: ['tabular-nums'] }}>{money(sum.outstanding)}</Text>  of {money(sum.totalValue)}
        </Text>
      </View>

      {next.length > 0 ? (
        <View>
          {next.map((o, i) => {
            const p = PAY[o.paymentStatus as keyof typeof PAY] ?? PAY.UNPAID;
            return (
              <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: i === 0 ? 1 : 1, borderTopColor: th.border }}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '700' }}>{o.customerName}</Text>
                  <Text numberOfLines={1} style={{ color: th.muted, fontSize: 12 }}>{EVENT[o.eventType] ?? o.eventType} · {prettyDate(String(o.eventDate).slice(0, 10))} · {o.locationName}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Text style={{ color: th.ink, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{money(o.amount)}</Text>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: p.bg }}>
                    <Text style={{ color: p.fg, fontSize: 11, fontWeight: '800' }}>{p.dot} {p.label}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}
