/** Trading dates are IST calendar days regardless of the device's own time zone. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type RelativeKey =
  | 'relToday' | 'relYesterday' | 'relThisWeek' | 'relLastWeek' | 'relThisMonth' | 'relLastMonth'
  | 'relThisQuarter' | 'relPrevQuarter' | 'relThisHalf' | 'relPrevHalf' | 'relPrevYear';

/**
 * How far back `date` is, as a label bucket. Checked from the most specific bucket outwards, so a date
 * always gets the narrowest name that fits: Today, Yesterday, This/Last week (Monday start), This/Last
 * month, This/Previous quarter, This/Previous half-year, Previous year, then the plain year (e.g. 2024).
 * Quarters, half-years and years follow the calendar year.
 */
export function relativeLabel(date: string, today: string = todayIST()): { key: RelativeKey } | { year: number } {
  const [y, m, d] = date.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  const dayNo = (s: string) => Math.floor(new Date(`${s}T00:00:00Z`).getTime() / 86_400_000);
  const diff = dayNo(today) - dayNo(date);

  if (diff === 0) return { key: 'relToday' };
  if (diff === 1) return { key: 'relYesterday' };

  // ISO weeks: day 0 (1970-01-01) was a Thursday, so shifting by 3 makes Monday the first day of a week
  const week = (s: string) => Math.floor((dayNo(s) + 3) / 7);
  if (week(date) === week(today)) return { key: 'relThisWeek' };
  if (week(date) === week(today) - 1) return { key: 'relLastWeek' };

  const monthIdx = (yy: number, mm: number) => yy * 12 + (mm - 1);
  if (monthIdx(y, m) === monthIdx(ty, tm)) return { key: 'relThisMonth' };
  if (monthIdx(y, m) === monthIdx(ty, tm) - 1) return { key: 'relLastMonth' };

  const quarterIdx = (yy: number, mm: number) => yy * 4 + Math.floor((mm - 1) / 3);
  if (quarterIdx(y, m) === quarterIdx(ty, tm)) return { key: 'relThisQuarter' };
  if (quarterIdx(y, m) === quarterIdx(ty, tm) - 1) return { key: 'relPrevQuarter' };

  const halfIdx = (yy: number, mm: number) => yy * 2 + (mm > 6 ? 1 : 0);
  if (halfIdx(y, m) === halfIdx(ty, tm)) return { key: 'relThisHalf' };
  if (halfIdx(y, m) === halfIdx(ty, tm) - 1) return { key: 'relPrevHalf' };

  if (y === ty - 1) return { key: 'relPrevYear' };
  void d;
  return { year: y };
}

/** Follows the UI language chosen in the app (kept in localStorage by the i18n provider). */
function locale(): string {
  try { return localStorage.getItem('bp_lang') === 'ta' ? 'ta-IN' : 'en-IN'; } catch { return 'en-IN'; }
}

/** 26 Sep - short label for chart axes */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Oct - month name for a YYYY-MM key */
export function monthShort(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'short', timeZone: 'UTC' });
}

/** October 2026 */
export function monthLong(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** 26 Sept 2026 (Tamil month names when the UI is Tamil) */
export function prettyDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function prettyTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
