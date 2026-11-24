import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { ClosingModal } from '@/components/ClosingDetailBody';
import { Card, ErrorBox, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, prettyDay, todayIST } from '@/lib/dates';
import { useIsTeaShop, useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';

const DEFAULT_DAYS = 14;
const ROW = 46;
const CELL_W = 46;
const BRANCH_COLORS = ['#d84b4b', '#e19a18', '#31934c', '#3375bd', '#8f55b5', '#18887e'];

/** Every branch and day on one grid: closed, waiting for you (with its age) or not submitted. Tap a day to open it. */
export function ClosingBacklog({ hidden = false, onOpen }: { hidden?: boolean; onOpen?: () => void }) {
  const th = useTheme();
  const teaShop = useIsTeaShop();
  const branches = useBranches();
  const [pending, setPending] = useState<any[] | null>(null);
  const [awaiting, setAwaiting] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [daysToShow, setDaysToShow] = useState(teaShop ? 7 : DEFAULT_DAYS);
  const today = todayIST();
  const scroller = useRef<ScrollView>(null);

  const [viewing, setViewing] = useState<{ locationId: string; date: string } | null>(null);
  const alive = useRef(true);
  const load = useCallback(() => {
    Promise.all([api.get<any[]>('/pending-closings'), api.get<any[]>('/closings/awaiting').catch(() => [] as any[])])
      .then(([p, a]) => { if (alive.current) { setPending(p); setAwaiting(a); } })
      .catch((e) => alive.current && setError(e instanceof Error ? e.message : 'Could not load'));
  }, []);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  const days = useMemo(() => Array.from({ length: daysToShow }, (_, i) => addDays(today, i - (daysToShow - 1))), [today, daysToShow]);
  const open = useMemo(() => new Set((pending ?? []).map((p) => `${p.locationId}|${String(p.businessDate).slice(0, 10)}`)), [pending]);
  const waiting = useMemo(() => new Map(awaiting.map((a) => [`${a.locationId}|${String(a.businessDate).slice(0, 10)}`, a])), [awaiting]);
  const ageOf = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  const openToday = branches.filter((branch) => open.has(`${branch.id}|${today}`)).length;
  const waitingToday = branches.filter((branch) => waiting.has(`${branch.id}|${today}`)).length;
  const closedToday = Math.max(0, branches.length - openToday - waitingToday);

  if (error) return <ErrorBox error={error} />;
  if (!pending) return <Loading />;

  return (
    <View style={{ gap: 12 }}>
      {teaShop ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <ClosingCount label="Not Closed" value={hidden ? '••' : String(openToday)} background="#fbd9d6" foreground="#d9443d" kind="open" deco="storefront-outline" />
          <ClosingCount label="Waiting for You" value={hidden ? '••' : String(waitingToday)} background="#fdecc4" foreground="#d88a08" kind="wait" deco="account-check-outline" />
          <ClosingCount label="Closed Today" value={hidden ? '••' : String(closedToday)} background="#d6f0d9" foreground="#2e9c5b" kind="done" deco="calendar-check-outline" />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
          <Text style={{ color: th.muted }}><Text style={{ color: '#DC2626', fontWeight: '800', fontSize: 16 }}>{open.size}</Text> not closed</Text>
          <Text style={{ color: th.muted }}><Text style={{ color: '#B45309', fontWeight: '800', fontSize: 16 }}>{awaiting.length}</Text> waiting for you</Text>
        </View>
      )}

      {teaShop ? (
        <Pressable onPress={onOpen ?? (() => setDaysToShow(14))} accessibilityRole="button" style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: '#6d2f12', shadowColor: '#45220f', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
          <MaterialCommunityIcons name="exit-to-app" size={24} color="#fff4e8" />
          <Text style={{ flex: 1, color: '#fff4e8', fontSize: 15, fontWeight: '700' }}>Open Closing Backlog</Text>
          <Feather name="chevron-right" size={22} color="#fff4e8" />
        </Pressable>
      ) : null}

      <Card style={{ padding: teaShop ? 12 : 0, overflow: 'hidden', backgroundColor: teaShop && !th.dark ? '#fffaf4' : th.surface, borderRadius: teaShop ? 22 : 20 }}>
        {teaShop ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 2, paddingBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <MaterialCommunityIcons name="storefront-outline" size={22} color="#6a351c" />
              <Text numberOfLines={1} style={{ color: th.ink, fontSize: 16, fontWeight: '800' }}>Branch Closing Status</Text>
            </View>
            <Pressable onPress={() => setDaysToShow((days) => days === 7 ? 14 : 7)} accessibilityRole="button" accessibilityLabel={`Showing last ${daysToShow} days. Change range`} style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: th.border, backgroundColor: th.surface }}>
              <Feather name="calendar" size={14} color={th.ink} />
              <Text style={{ color: th.ink, fontSize: 11, fontWeight: '700' }}>Last {daysToShow} Days</Text>
              <Feather name="chevron-down" size={14} color={th.muted} />
            </Pressable>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row' }}>
          {/* branch names stay put while the days scroll */}
          <View style={{ width: teaShop ? 120 : 112, borderRightWidth: teaShop ? 0 : 1, borderRightColor: th.border }}>
            <View style={{ height: 46, justifyContent: 'center', paddingLeft: 10, backgroundColor: teaShop ? '#f8ead9' : th.brandLight }}>
              <Text style={{ color: th.ink, fontSize: 12, fontWeight: '800' }}>Branch</Text>
            </View>
            {branches.map((b, index) => (
              <View key={b.id} style={{ height: ROW, flexDirection: 'row', alignItems: 'center', paddingLeft: 9, paddingRight: 5, borderTopWidth: 1, borderTopColor: th.border }}>
                {teaShop ? <MaterialCommunityIcons name="storefront" size={17} color={BRANCH_COLORS[index % BRANCH_COLORS.length]} style={{ marginRight: 6 }} /> : null}
                <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '700' }}>{b.name}</Text>
              </View>
            ))}
          </View>
          <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={!teaShop} style={{ flex: 1 }} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
            <View>
              <View style={{ flexDirection: 'row', height: 46, alignItems: 'center', backgroundColor: teaShop ? '#f8ead9' : th.brandLight }}>
                {days.map((d) => (
                  <View key={d} style={{ width: CELL_W, alignItems: 'center' }}>
                    <Text style={{ color: th.ink, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{d.slice(8)}</Text>
                    <Text style={{ color: th.muted, fontSize: 10 }}>{prettyDay(d).slice(3)}</Text>
                  </View>
                ))}
              </View>
              {branches.map((b) => (
                <View key={b.id} style={{ flexDirection: 'row', height: ROW, alignItems: 'center', borderTopWidth: 1, borderTopColor: th.border }}>
                  {days.map((d) => {
                    const k = `${b.id}|${d}`;
                    const w = waiting.get(k);
                    const c = open.has(k) ? { bg: '#fee2e2', fg: '#c92d2d', t: '!' } : w ? { bg: '#fff0cc', fg: '#bd7808', t: `${ageOf(w.submittedAt ?? w.businessDate)}d` } : teaShop ? { bg: '#1f7a35', fg: '#ffffff', t: '✓' } : { bg: '#e2f4e5', fg: '#16803d', t: '✓' };
                    return (
                      <Pressable
                        key={d} accessibilityRole="button" accessibilityLabel={`${b.name} ${prettyDate(d)}`}
                        onPress={() => setViewing({ locationId: b.id, date: d })}
                        style={{ width: CELL_W, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <View style={{ width: teaShop ? 34 : 32, height: 32, borderRadius: teaShop ? 10 : 9, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
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

      <View style={{ flexDirection: 'row', justifyContent: teaShop ? 'space-around' : 'flex-start', gap: 12, flexWrap: 'wrap', padding: teaShop ? 10 : 0, borderRadius: 14, backgroundColor: teaShop ? '#f8ead9' : 'transparent' }}>
        <Text style={{ color: teaShop ? th.ink : th.muted, fontSize: teaShop ? 13 : 12 }}><Text style={{ color: '#B91C1C', fontWeight: '800' }}>!</Text> Not closed</Text>
        <Text style={{ color: teaShop ? th.ink : th.muted, fontSize: teaShop ? 13 : 12 }}><Text style={{ color: teaShop ? '#D88A08' : '#B45309', fontWeight: '800' }}>◷</Text> Waiting for you</Text>
        <Text style={{ color: teaShop ? th.ink : th.muted, fontSize: teaShop ? 13 : 12 }}><Text style={{ color: teaShop ? '#1f7a35' : '#047857', fontWeight: '800' }}>✓</Text> Closed</Text>
      </View>

      {viewing ? <ClosingModal view={viewing} onClose={() => { setViewing(null); load(); }} onDecided={() => { setViewing(null); load(); }} /> : null}
    </View>
  );
}

type MdiIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
function ClosingCount({ label, value, background, foreground, kind, deco }: { label: string; value: string; background: string; foreground: string; kind: 'open' | 'wait' | 'done'; deco: MdiIcon }) {
  return (
    <View style={{ flex: 1, minHeight: 104, padding: 12, gap: 8, borderRadius: 20, overflow: 'hidden', backgroundColor: background, borderWidth: 1, borderColor: 'rgba(255,255,255,0.85)', shadowColor: '#45220f', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
      {/* big faint picture behind, bleeding off the corner */}
      <MaterialCommunityIcons name={deco} size={64} color={foreground} style={{ position: 'absolute', right: -10, bottom: -10, opacity: 0.14 }} />
      <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: foreground, alignItems: 'center', justifyContent: 'center' }}>
        {kind === 'open' ? <Feather name="alert-circle" size={18} color="#fff" /> : kind === 'wait' ? <MaterialCommunityIcons name="clock-outline" size={19} color="#fff" /> : <Feather name="check" size={18} color="#fff" />}
      </View>
      <View style={{ marginTop: 'auto' }}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: '#2d211b', fontSize: 30, lineHeight: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: '#5a463a', fontSize: 12, fontWeight: '700' }}>{label}</Text>
      </View>
    </View>
  );
}
