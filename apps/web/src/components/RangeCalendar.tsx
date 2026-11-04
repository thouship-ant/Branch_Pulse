'use client';

import { useState } from 'react';
import { Icon } from './Icon';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Month calendar for a date range: pick the first day, then the last (one day twice = a single day). Days after `max` are disabled. */
export function RangeCalendar({ from, to, max, onApply, onCancel }: { from: string; to: string; max: string; onApply: (r: { from: string; to: string }) => void; onCancel: () => void }) {
  const { t } = useT();
  const [start, setStart] = useState<string | null>(from);
  const [end, setEnd] = useState<string | null>(to);
  const [view, setView] = useState(() => ({ y: Number(to.slice(0, 4)), m: Number(to.slice(5, 7)) - 1 }));

  const lead = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const shift = (n: number) => setView((v) => { const d = new Date(Date.UTC(v.y, v.m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const maxMonth = { y: Number(max.slice(0, 4)), m: Number(max.slice(5, 7)) - 1 };
  const atMax = view.y > maxMonth.y || (view.y === maxMonth.y && view.m >= maxMonth.m);

  function pick(d: string) {
    if (!start || end) { setStart(d); setEnd(null); return; } // first tap: begin a new range
    setStart(start <= d ? start : d); setEnd(start <= d ? d : start); // second tap closes it, in either order
  }
  const lo = start;
  const hi = end ?? start;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} aria-label={t('pPrevMonth')} className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-slate-100"><Icon name="chevronLeft" size={20} /></button>
        <span className="text-[17px] font-bold">{MONTHS[view.m]} {view.y}</span>
        <button type="button" onClick={() => shift(1)} disabled={atMax} aria-label={t('pNextMonth')} className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-slate-100 disabled:opacity-30"><Icon name="chevronRight" size={20} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs font-bold text-slate-500">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (d === null) return <span key={i} className="h-11" />;
          const day = iso(view.y, view.m, d);
          const off = day > max;
          const isEnd = day === lo || day === hi;
          const inside = !!lo && !!hi && day > lo && day < hi;
          return (
            <button
              key={i} type="button" disabled={off} onClick={() => pick(day)} aria-label={prettyDate(day)} aria-pressed={isEnd}
              className={`grid h-11 place-items-center transition ${inside ? 'bg-brand-light' : ''} ${off ? 'opacity-30' : ''}`}
            >
              <span className={`grid h-10 w-10 place-items-center rounded-full text-[15px] ${isEnd ? 'bg-brand font-extrabold text-white shadow-md shadow-brand/30' : 'font-medium hover:bg-slate-100'}`}>{d}</span>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-slate-600">
        {!start ? t('pTapFirst') : !end ? `${prettyDate(start)} — ${t('pTapLast')}` : start === end ? prettyDate(start) : `${prettyDate(start)} – ${prettyDate(end)}`}
      </p>
      <div className="flex gap-3">
        <button type="button" className="btn-secondary flex-1" onClick={onCancel}>{t('cancel')}</button>
        <button type="button" className="btn-primary flex-1" disabled={!start} onClick={() => onApply({ from: start!, to: end ?? start! })}>{t('pApply')}</button>
      </div>
    </div>
  );
}
