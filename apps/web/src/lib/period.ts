import { addDays, prettyDate } from './dates';

export type PeriodId = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom';

/** A chosen period: always a from..to range of YYYY-MM-DD (a single day has from === to). */
export interface Period { id: PeriodId; from: string; to: string }

export const PERIOD_IDS: PeriodId[] = ['today', 'yesterday', 'week', 'month', 'all', 'custom'];

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

/** Query string for /dashboard/summary: one day uses `date`, anything longer uses `from` and `to`. */
export const periodQuery = (p: Period) => (p.from === p.to ? `date=${p.to}` : `from=${p.from}&to=${p.to}`);

export const periodCustomText = (p: Period) => (p.from === p.to ? prettyDate(p.from) : `${prettyDate(p.from)} – ${prettyDate(p.to)}`);
