import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, ErrorBox, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';

const DAYS = 14;
const ROW = 46;
const CELL_W = 44;

/** Every branch and day on one grid: closed, waiting for you (with its age) or not submitted. Tap a day to open it. */
export function ClosingBacklog() {
  const th = useTheme();
  const router = useRouter();
  const branches = useBranches();
  const [pending, setPending] = useState<any[] | null>(null);
  const [awaiting, setAwaiting] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = todayIST();

  useEffect(() => {
    let alive = true;
    Promise.all([api.get<any[]>('/pending-closings'), api.get<any[]>('/closings/awaiting').catch(() => [] as any[])])
      .then(([p, a]) => { if (alive) { setPending(p); setAwaiting(a); } })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load'));
    return () => { alive = false; };
  }, []);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i - (DAYS - 1))), [today]);
  const open = useMemo(() => new Set((pending ?? []).map((p) => `${p.locationId}|${String(p.businessDate).slice(0, 10)}`)), [pending]);
  const waiting = useMemo(() => new Map(awaiting.map((a) => [`${a.locationId}|${String(a.businessDate).slice(0, 10)}`, a])), [awaiting]);
  const ageOf = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

  if (error) return <ErrorBox error={error} />;
  if (!pending) return <Loading />;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
        <Text style={{ color: th.muted }}><Text style={{ color: '#DC2626', fontWeight: '800', fontSize: 16 }}>{open.size}</Text> not closed</Text>
        <Text style={{ color: th.muted }}><Text style={{ color: '#B45309', fontWeight: '800', fontSize: 16 }}>{awaiting.length}</Text> waiting for you</Text>
      </View>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row' }}>
          {/* branch names stay put while the days scroll */}
          <View style={{ width: 112, borderRightWidth: 1, borderRightColor: th.border }}>
            <View style={{ height: 40, justifyContent: 'center', paddingLeft: 14, backgroundColor: th.brandLight }}>
              <Text style={{ color: th.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>BRANCH</Text>
            </View>
            {branches.map((b) => (
              <View key={b.id} style={{ height: ROW, justifyContent: 'center', paddingLeft: 14, paddingRight: 6, borderTopWidth: 1, borderTopColor: th.border }}>
                <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '700' }}>{b.name}</Text>
              </View>
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }}>
            <View>
              <View style={{ flexDirection: 'row', height: 40, alignItems: 'center', backgroundColor: th.brandLight }}>
                {days.map((d) => <Text key={d} style={{ width: CELL_W, textAlign: 'center', color: th.muted, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{d.slice(8)}</Text>)}
              </View>
              {branches.map((b) => (
                <View key={b.id} style={{ flexDirection: 'row', height: ROW, alignItems: 'center', borderTopWidth: 1, borderTopColor: th.border }}>
                  {days.map((d) => {
                    const k = `${b.id}|${d}`;
                    const w = waiting.get(k);
                    const c = open.has(k) ? { bg: '#FEE2E2', fg: '#B91C1C', t: '!' } : w ? { bg: '#FEF3C7', fg: '#92400E', t: `${ageOf(w.submittedAt ?? w.businessDate)}d` } : { bg: '#ECFDF5', fg: '#047857', t: '✓' };
                    return (
                      <Pressable
                        key={d} accessibilityRole="button" accessibilityLabel={`${b.name} ${prettyDate(d)}`}
                        onPress={() => router.push(`/more/closing/${b.id}/${d}` as any)}
                        style={{ width: CELL_W, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: c.fg, fontWeight: '800', fontSize: w ? 11 : 13 }}>{c.t}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
        <Text style={{ color: th.muted, fontSize: 12 }}><Text style={{ color: '#B91C1C', fontWeight: '800' }}>!</Text> Not closed</Text>
        <Text style={{ color: th.muted, fontSize: 12 }}><Text style={{ color: '#B45309', fontWeight: '800' }}>3d</Text> Waiting for you</Text>
        <Text style={{ color: th.muted, fontSize: 12 }}><Text style={{ color: '#047857', fontWeight: '800' }}>✓</Text> Closed</Text>
      </View>
    </View>
  );
}
