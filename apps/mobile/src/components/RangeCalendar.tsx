import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { prettyDate } from '@/lib/dates';
import { useTheme } from '@/lib/theme';
import { Button, Muted } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * Month calendar for picking a date range: tap the first day, then the last (tap one day twice for a single day).
 * Days after `max` (today) cannot be chosen.
 */
export function RangeCalendar({ from, to, max, onApply, onCancel }: { from: string; to: string; max: string; onApply: (r: { from: string; to: string }) => void; onCancel: () => void }) {
  const th = useTheme();
  const [start, setStart] = useState<string | null>(from);
  const [end, setEnd] = useState<string | null>(to);
  const [view, setView] = useState(() => ({ y: Number(to.slice(0, 4)), m: Number(to.slice(5, 7)) - 1 }));

  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const shift = (n: number) => setView((v) => { const d = new Date(Date.UTC(v.y, v.m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const maxMonth = { y: Number(max.slice(0, 4)), m: Number(max.slice(5, 7)) - 1 };
  const atMax = view.y > maxMonth.y || (view.y === maxMonth.y && view.m >= maxMonth.m);

  function pick(d: string) {
    if (!start || end) { setStart(d); setEnd(null); return; } // first tap: begin a new range
    // second tap: close the range (either order)
    setStart(start <= d ? start : d); setEnd(start <= d ? d : start);
  }

  const lo = start;
  const hi = end ?? start;
  const ready = !!start;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => shift(-1)} accessibilityLabel="Previous month" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="chevron-left" size={22} color={th.ink} />
        </Pressable>
        <Text style={{ color: th.ink, fontSize: 17, fontWeight: '700' }}>{MONTHS[view.m]} {view.y}</Text>
        <Pressable onPress={() => shift(1)} disabled={atMax} accessibilityLabel="Next month" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: atMax ? 0.3 : 1 }}>
          <Feather name="chevron-right" size={22} color={th.ink} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAYS.map((w) => <Text key={w} style={{ flex: 1, textAlign: 'center', color: th.muted, fontSize: 12, fontWeight: '700' }}>{w}</Text>)}
      </View>

      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
            if (d === null) return <View key={i} style={{ flex: 1, height: 42 }} />;
            const day = iso(view.y, view.m, d);
            const off = day > max;
            const isEnd = day === lo || day === hi;
            const inside = !!lo && !!hi && day > lo && day < hi;
            return (
              <Pressable
                key={i} disabled={off} onPress={() => pick(day)} accessibilityLabel={prettyDate(day)} accessibilityState={{ selected: isEnd, disabled: off }}
                style={{ flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: inside ? th.brandLight : 'transparent', opacity: off ? 0.3 : 1 }}
              >
                <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: isEnd ? th.brand : 'transparent' }}>
                  <Text style={{ color: isEnd ? th.onBrand : th.ink, fontWeight: isEnd ? '800' : '500', fontSize: 15 }}>{d}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}

      <Muted>{!start ? 'Tap the first day' : !end ? `${prettyDate(start)} — tap the last day (or Apply for one day)` : start === end ? prettyDate(start) : `${prettyDate(start)} – ${prettyDate(end)}`}</Muted>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onCancel} />
        <Button title="Apply" style={{ flex: 1 }} disabled={!ready} onPress={() => onApply({ from: start!, to: end ?? start! })} />
      </View>
    </View>
  );
}
