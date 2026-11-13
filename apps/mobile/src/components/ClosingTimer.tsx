import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/Text';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';

/** Minutes since midnight in India now. */
const nowIST = () => Math.floor(Date.now() / 60_000 + 330) % 1440;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
const clock = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

/** "Close by 11:30 PM - 3 h 20 min left": counts down to the closing cut-off; amber in the last hour, red once it has passed. Hidden once the day is submitted. */
export function ClosingTimer({ locationId, done }: { locationId?: string; done: boolean }) {
  const th = useTheme();
  const [cutoff, setCutoff] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api.get<any>(`/sync/bootstrap${locationId ? `?locationId=${locationId}` : ''}`).then((b) => setCutoff(b?.rules?.closingCutoff ?? null)).catch(() => undefined);
  }, [locationId]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 15_000); return () => clearInterval(t); }, []);
  void tick;
  if (!cutoff || done) return null;

  const left = toMin(cutoff) - nowIST();
  const over = left <= 0;
  const c = over ? th.bad : left <= 60 ? th.warn : th.ok;
  const h = Math.floor(left / 60);
  const m = left % 60;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
      <Feather name="clock" size={20} color={c.text} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 12, fontWeight: '600' }}>{over ? 'Closing time has passed' : `Close the day by ${clock(cutoff)}`}</Text>
        <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
          {over ? `${Math.floor(-left / 60) ? `${Math.floor(-left / 60)} h ` : ''}${(-left) % 60} min overdue` : `${h ? `${h} h ` : ''}${m} min left`}
        </Text>
      </View>
    </View>
  );
}
