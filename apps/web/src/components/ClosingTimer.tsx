'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** Minutes since midnight in India now. */
const nowIST = () => Math.floor(Date.now() / 60_000 + 330) % 1440;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
const clock = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

/** "Close the day by 11:30 PM - 3 h 20 min left": counts down to the closing cut-off; amber in the last hour, red once it has passed. Hidden once the day is submitted. */
export function ClosingTimer({ locationId, done }: { locationId?: string; done: boolean }) {
  const [cutoff, setCutoff] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    api.get<any>(`/sync/bootstrap${locationId ? `?locationId=${locationId}` : ''}`).then((b) => setCutoff(b?.rules?.closingCutoff ?? null)).catch(() => undefined);
  }, [locationId]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 15_000); return () => clearInterval(t); }, []);
  if (!cutoff || done) return null;

  const left = toMin(cutoff) - nowIST();
  const over = left <= 0;
  const cls = over ? 'border-red-300 bg-red-50 text-red-800' : left <= 60 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-800';
  const abs = Math.abs(left);
  const text = `${Math.floor(abs / 60) ? `${Math.floor(abs / 60)} h ` : ''}${abs % 60} min`;
  return (
    <div role="timer" aria-live="off" className={`mt-3 flex items-center gap-3 rounded-xl border px-3 py-2 ${cls}`}>
      <span aria-hidden className="text-xl">⏱</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold">{over ? 'Closing time has passed' : `Close the day by ${clock(cutoff)}`}</p>
        <p className="text-lg font-extrabold tabular-nums">{over ? `${text} overdue` : `${text} left`}</p>
      </div>
    </div>
  );
}
