'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDays, prettyDate, relativeLabel, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';

const Svg = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

const CAL_ICON = 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Month-grid popover: pick a day, then Done to apply (Reset jumps to today). Days outside min..max are disabled.
 * Rendered in a portal with fixed positioning under `anchor`, so a modal or scroll container never clips it.
 */
function DatePopover({ anchor, value, min, max, onApply, onClose }: { anchor: HTMLElement; value: string; min?: string; max?: string; onApply: (d: string) => void; onClose: () => void }) {
  const today = todayIST();
  const start = value || max || today;
  const [picked, setPicked] = useState(value);
  const [year, setYear] = useState(Number(start.slice(0, 4)));
  const [month, setMonth] = useState(Number(start.slice(5, 7)) - 1); // 0-based
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 400;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 304 - 8));
      const below = r.bottom + 8;
      setPos({ left, top: below + h > window.innerHeight && r.top - 8 - h > 0 ? r.top - 8 - h : below });
    };
    place();
    const away = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!ref.current?.contains(n) && !anchor.contains(n)) closeRef.current();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  const first = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0 = Sunday
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const ym = (y: number, m: number) => `${y}-${pad(m + 1)}`;
  const iso = (d: number) => `${ym(year, month)}-${pad(d)}`;
  const shift = (by: number) => {
    const d = new Date(Date.UTC(year, month + by, 1));
    setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth());
  };
  const nextBlocked = !!max && ym(year, month) >= max.slice(0, 7);
  const prevBlocked = !!min && ym(year, month) <= min.slice(0, 7);
  const goTo = (v: string) => { setPicked(v); setYear(Number(v.slice(0, 4))); setMonth(Number(v.slice(5, 7)) - 1); };
  const resetTo = max && today > max ? max : min && today < min ? min : today;
  const nav = 'flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent';

  return createPortal(
    <div
      ref={ref} role="dialog" aria-label="Choose date" onClick={(e) => e.stopPropagation()}
      className="anim-sheet fixed z-[70] w-[19rem] rounded-2xl border border-slate-200 bg-surface p-4"
      style={{ boxShadow: 'var(--shadow-pop)', left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className={nav} aria-label="Previous month" disabled={prevBlocked} onClick={() => shift(-1)}><Svg d="M15 18l-6-6 6-6" /></button>
        <h3 className="text-sm font-semibold text-ink">{MONTHS[month]} {year}</h3>
        <button type="button" className={nav} aria-label="Next month" disabled={nextBlocked} onClick={() => shift(1)}><Svg d="M9 18l6-6-6-6" /></button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <span key={i} className="pb-1 text-[11px] font-semibold uppercase text-slate-400">{w}</span>)}
        {Array.from({ length: first }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1;
          const v = iso(d);
          const sel = v === picked;
          return (
            <button
              key={d} type="button" disabled={(!!max && v > max) || (!!min && v < min)} onClick={() => setPicked(v)}
              onDoubleClick={() => { onApply(v); onClose(); }} aria-pressed={sel}
              className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm tabular-nums transition ${
                sel ? 'bg-[#1e2a8a] font-semibold text-white shadow-md' : v === today ? 'font-semibold text-brand ring-1 ring-brand/40 hover:bg-brand-light' : 'text-slate-700 hover:bg-slate-100'
              } disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent`}
            >{d}</button>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => goTo(resetTo)} className="h-11 rounded-xl bg-[#eef1ff] text-sm font-semibold text-[#1e2a8a] transition hover:bg-[#e0e5ff] active:scale-[0.98]">Reset</button>
        <button type="button" disabled={!picked} onClick={() => { onApply(picked); onClose(); }} className="h-11 rounded-xl bg-[#1e2a8a] text-sm font-semibold text-white shadow-md transition hover:bg-[#18236f] active:scale-[0.98] disabled:opacity-50">Done</button>
      </div>
    </div>,
    document.body,
  );
}

/** Drop-in replacement for <input type="date">: same value/min/max semantics, styled like the app's other fields, opens the month-grid popover. */
export function DateInput({ id, value, onChange, min, max, className = '' }: { id?: string; value: string; onChange: (d: string) => void; min?: string; max?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn} id={id} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={`field flex items-center justify-between gap-2 text-left tabular-nums ${className}`}
      >
        <span className={value ? '' : 'text-slate-400'}>{value ? prettyDate(value) : 'Select date'}</span>
        <span className="text-brand"><Svg d={CAL_ICON} size={18} /></span>
      </button>
      {open && btn.current && <DatePopover anchor={btn.current} value={value} min={min} max={max} onApply={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Date picker with previous/next day buttons in one soft card: [ ‹ | 📅 23 Oct 2026 | › ].
 * The label above names the chosen date relative to today (Today, Yesterday, Last week ... 2024).
 * Clicking the date opens a month-grid popover (pick a day, then Done).
 */
export function DateNav({ date, onChange, id }: { date: string; onChange: (d: string) => void; id: string }) {
  const { t } = useT();
  const today = todayIST();
  const rel = relativeLabel(date, today);
  const label = 'key' in rel ? t(rel.key) : String(rel.year);
  const isToday = date === today;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const step = 'flex h-full w-10 shrink-0 items-center justify-center text-slate-500 transition hover:bg-brand-light hover:text-brand-dark active:scale-90 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent disabled:active:scale-100';

  return (
    <div>
      <label htmlFor={id} className="label flex items-center gap-1.5">
        {label}
        {!isToday && (
          <button
            type="button" onClick={() => onChange(today)} title={t('today')} aria-label={t('today')}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-light text-brand-dark transition hover:bg-brand hover:text-white"
          >
            <Svg d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" size={12} />
          </button>
        )}
      </label>
      <div className="inline-flex h-11 items-stretch divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-300 bg-surface text-sm shadow-sm transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30 hover:border-slate-400">
        <button type="button" className={step} aria-label="Previous day" onClick={() => onChange(addDays(date, -1))}><Svg d="M15 18l-6-6 6-6" /></button>
        <button ref={btn} id={id} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} className="flex min-w-[10.5rem] items-center justify-center gap-2 px-3 font-semibold tabular-nums text-ink transition hover:bg-slate-50">
          <span className="text-brand"><Svg d={CAL_ICON} size={17} /></span>
          <span>{prettyDate(date)}</span>
        </button>
        <button type="button" className={step} aria-label="Next day" disabled={date >= today} onClick={() => onChange(addDays(date, 1))}><Svg d="M9 18l6-6-6-6" /></button>
      </div>
      {open && btn.current && <DatePopover anchor={btn.current} value={date} max={today} onApply={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}
