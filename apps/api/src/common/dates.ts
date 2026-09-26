import { validation } from './app-exception';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IST = 'Asia/Kolkata';

/** Today's trading date in IST as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Current wall-clock time in IST as HH:MM. */
export function timeIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/** Parse YYYY-MM-DD into a UTC-midnight Date (matches how Prisma reads/writes DATE columns). */
export function toDate(value: unknown, field = 'businessDate'): Date {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw validation('INVALID_DATE', `${field} must be YYYY-MM-DD`, field);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw validation('INVALID_DATE', `${field} is not a valid date`, field);
  }
  return d;
}

export const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export function addDaysStr(value: string, n: number): string {
  return fmtDate(addDays(toDate(value), n));
}
