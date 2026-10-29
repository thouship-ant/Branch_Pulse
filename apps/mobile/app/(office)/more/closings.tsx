import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { DateStepper, Empty, ErrorBox, ListRow, Loading, Screen, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { prettyTime } from '@/lib/dates';
import { dec, formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import { useDay } from '@/lib/useDate';

/** Every branch's closing for one day: status, sales, cash variance. Tap one to review it. */
export default function ClosingsScreen() {
  const th = useTheme();
  const router = useRouter();
  const day = useDay();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get(`/closings?date=${day.date}`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [day.date]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  return (
    <Screen title="Closings" onRefresh={load}>
      <DateStepper date={day.date} label={day.label} onPrev={day.prev} onNext={day.next} nextDisabled={day.isToday} />
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text="No branches." /> : rows.map((r) => {
        const v = r.cashVariance;
        const neg = v != null && dec(v).isNegative();
        return (
          <ListRow
            key={r.locationId} title={r.locationName}
            lines={[`Sales: ${formatINR(r.totalSales, { decimals: false })}`, `Cash variance: ${v == null ? '—' : `${neg ? '▼ ' : ''}${formatINR(v, { decimals: false })}`}`, r.reopenCount > 0 && `↺ reopened ×${r.reopenCount}`]}
            right={<><StatusPill status={r.status} />{r.submittedAt ? <Text style={{ color: th.faint, fontSize: 12 }}>{prettyTime(r.submittedAt)}</Text> : null}</>}
            onPress={() => router.push(`/more/closing/${r.locationId}/${day.date}` as any)}
          />
        );
      })}
    </Screen>
  );
}
