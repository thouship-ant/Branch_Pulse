import { addDays, prettyDate } from './dates';

export type PeriodId = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom';

/** A chosen period: always a from..to range of YYYY-MM-DD (a single day has from === to). */
export interface Period { id: PeriodId; from: string; to: string }

export const PERIOD_OPTIONS: Array<{ id: PeriodId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
  { id: 'custom', label: 'Custom Range' },
];

const ALL_TIME_FROM = '2000-01-01';

/** Turns a preset into dates. `custom` keeps the range the user picked. Weeks start on Monday. */
export function resolvePeriod(id: PeriodId, today: string, custom?: { from: string; to: string }): Period {
  switch (id) {
    case 'today': return { id, from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { id, from: y, to: y }; }
    case 'week': {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      return { id, from: addDays(today, -((dow + 6) % 7)), to: today };
    }
    case 'month': return { id, from: `${today.slice(0, 7)}-01`, to: today };
    case 'all': return { id, from: ALL_TIME_FROM, to: today };
    default: return { id: 'custom', from: custom?.from ?? today, to: custom?.to ?? today };
  }
}

/** The pill text and the hero card caption. */
export function periodLabel(p: Period): string {
  const base = PERIOD_OPTIONS.find((o) => o.id === p.id && p.id !== 'custom')?.label;
  if (base) return base;
  return p.from === p.to ? prettyDate(p.from) : `${prettyDate(p.from).slice(0, 6)} – ${prettyDate(p.to)}`;
}

/** Query string for /dashboard/summary: one day uses `date`, anything longer uses `from` and `to`. */
export const periodQuery = (p: Period) => (p.from === p.to ? `date=${p.to}` : `from=${p.from}&to=${p.to}`);
