import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { PERIOD_OPTIONS, periodLabel, resolvePeriod, type Period, type PeriodId } from '@/lib/period';
import { TOUCH, useTheme } from '@/lib/theme';
import { RangeCalendar } from './RangeCalendar';
import { Sheet } from './ui';

/**
 * "Today v" pill for the header's right side. Tapping it opens "Select Period": Today, Yesterday, This Week, This Month,
 * All Time or a Custom Range picked on a calendar.
 */
export function PeriodPill({ period, today, onChange, onLight = false }: { period: Period; today: string; onChange: (p: Period) => void; onLight?: boolean }) {
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
        style={{ maxWidth: onLight ? 170 : 130, flexDirection: 'row', alignItems: 'center', gap: onLight ? 6 : 4, backgroundColor: onLight ? 'rgba(255,250,244,0.92)' : 'rgba(110,52,24,0.78)', borderWidth: 1, borderColor: onLight ? th.border : 'rgba(255,225,190,0.55)', borderRadius: 999, paddingHorizontal: onLight ? 12 : 9, paddingVertical: onLight ? 10 : 4 }}
      >
        <Feather name="calendar" size={onLight ? 16 : 13} color={onLight ? '#6a351c' : '#fff'} />
        <Text numberOfLines={1} style={{ color: onLight ? '#6a351c' : '#fff', fontSize: onLight ? 14 : 12, fontWeight: '700', flexShrink: 1 }}>{periodLabel(period)}</Text>
        <Feather name="chevron-down" size={onLight ? 18 : 14} color={onLight ? '#6a351c' : '#fff'} />
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
