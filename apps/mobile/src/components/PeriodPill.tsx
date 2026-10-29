import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PERIOD_OPTIONS, periodLabel, resolvePeriod, type Period, type PeriodId } from '@/lib/period';
import { TOUCH, useTheme } from '@/lib/theme';
import { RangeCalendar } from './RangeCalendar';
import { Sheet } from './ui';

/**
 * "Today v" pill for the header's right side. Tapping it opens "Select Period": Today, Yesterday, This Week, This Month,
 * All Time or a Custom Range picked on a calendar.
 */
export function PeriodPill({ period, today, onChange }: { period: Period; today: string; onChange: (p: Period) => void }) {
  const th = useTheme();
  const [open, setOpen] = useState(false);
  const [calendar, setCalendar] = useState(false);

  const close = () => { setOpen(false); setCalendar(false); };
  const choose = (id: PeriodId) => {
    if (id === 'custom') { setCalendar(true); return; }
    onChange(resolvePeriod(id, today));
    close();
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`Period: ${periodLabel(period)}`} hitSlop={6}
        style={{ maxWidth: 170, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 }}
      >
        <Text numberOfLines={1} style={{ color: '#fff', fontSize: 15, fontWeight: '700', flexShrink: 1 }}>{periodLabel(period)}</Text>
        <Feather name="chevron-down" size={18} color="#fff" />
      </Pressable>

      <Sheet open={open} onClose={close} title={calendar ? 'Custom Range' : 'Select Period'}>
        {calendar ? (
          <RangeCalendar
            from={period.from} to={period.to} max={today} onCancel={() => setCalendar(false)}
            onApply={(r) => { onChange(resolvePeriod('custom', today, r)); close(); }}
          />
        ) : (
          <View style={{ gap: 4 }}>
            {PERIOD_OPTIONS.map((o) => {
              const on = o.id === period.id;
              return (
                <Pressable
                  key={o.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => choose(o.id)}
                  style={{ minHeight: TOUCH + 4, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: th.border }}
                >
                  <Text style={{ color: on ? th.brand : th.ink, fontSize: 17, fontWeight: on ? '800' : '500' }}>{o.label}</Text>
                  {on ? <Feather name="check" size={20} color={th.brand} /> : o.id === 'custom' ? <Feather name="chevron-right" size={20} color={th.faint} /> : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </Sheet>
    </>
  );
}
