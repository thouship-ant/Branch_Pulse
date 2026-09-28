'use client';

import { addDays, relativeLabel, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';

/**
 * Date picker with previous/next day buttons, merged into one compact control: [ ← | date 📅 | → ].
 * The label names the chosen date relative to today (Today, Yesterday, Last week ... 2024).
 */
export function DateNav({ date, onChange, id }: { date: string; onChange: (d: string) => void; id: string }) {
  const { t } = useT();
  const today = todayIST();
  const rel = relativeLabel(date, today);
  const label = 'key' in rel ? t(rel.key) : String(rel.year);
  const step = 'flex h-full w-8 shrink-0 items-center justify-center text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent';

  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="inline-flex h-10 items-stretch divide-x divide-slate-300 overflow-hidden rounded-card border border-slate-300 bg-surface text-sm focus-within:ring-2 focus-within:ring-brand">
        <button type="button" className={step} aria-label="Previous day" onClick={() => onChange(addDays(date, -1))}>←</button>
        <input
          id={id} type="date" value={date} max={today} onChange={(e) => onChange(e.target.value || today)}
          className="min-w-0 bg-transparent px-2 text-sm text-ink outline-none"
        />
        <button type="button" className={step} aria-label="Next day" disabled={date >= today} onClick={() => onChange(addDays(date, 1))}>→</button>
      </div>
    </div>
  );
}
