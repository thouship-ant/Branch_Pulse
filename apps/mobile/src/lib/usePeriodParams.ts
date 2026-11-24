import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { resolvePeriod, type Period, type PeriodId } from './period';

const IDS: PeriodId[] = ['today', 'yesterday', 'week', 'month', 'all', 'custom'];

/** The query a Home card adds when it opens a page for the period picked on Home (`period`, and `from` / `to` for a custom range). */
export const periodParams = (p: Period) => `period=${p.id}${p.id === 'custom' ? `&from=${p.from}&to=${p.to}` : ''}`;

/**
 * The period of a page that has the period pill. Opened from a Home card it starts on the period given there; opened any other way
 * (the More menu) it starts on this month, as always.
 */
export function usePeriodParams(today: string): [Period, (p: Period) => void] {
  const params = useLocalSearchParams<{ period?: string; from?: string; to?: string }>();
  const fromParams = (): Period | null => {
    const id = IDS.find((x) => x === params.period);
    return id ? resolvePeriod(id, today, params.from && params.to ? { from: params.from, to: params.to } : undefined) : null;
  };
  const [period, setPeriod] = useState<Period>(() => fromParams() ?? resolvePeriod('month', today));
  useEffect(() => { setPeriod(fromParams() ?? resolvePeriod('month', today)); }, [params.period, params.from, params.to]); // eslint-disable-line react-hooks/exhaustive-deps
  return [period, setPeriod];
}
