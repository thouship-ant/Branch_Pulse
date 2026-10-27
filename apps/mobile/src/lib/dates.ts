/** Trading dates are IST calendar days regardless of the phone's own time zone. */
export function todayIST(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000); // UTC+5:30, no DST
  return ist.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 26 Sep 2026 */
export function prettyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

export function prettyTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ist = new Date(new Date(iso).getTime() + 330 * 60_000);
  const h = ist.getUTCHours();
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
