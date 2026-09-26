'use client';

import { addDays, relativeLabel, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';

/**
 * Date picker with previous/next day buttons. The label names the chosen date relative to today
 * (Today, Yesterday, Last week ... 2024) instead of always saying "Today".
 */
export function DateNav({ date, onChange, id }: { date: string; onChange: (d: string) => void; id: string }) {
  const { t } = useT();
  const today = todayIST();
  const rel = relativeLabel(date, today);
  const label = 'key' in rel ? t(rel.key) : String(rel.year);

  return (
    <div className="flex items-end gap-2">
      <button className="btn-secondary px-3" aria-label="Previous day" onClick={() => onChange(addDays(date, -1))}>←</button>
      <div>
        <label htmlFor={id} className="label">{label}</label>
        <input id={id} type="date" className="field" value={date} max={today} onChange={(e) => onChange(e.target.value || today)} />
      </div>
      <button className="btn-secondary px-3" aria-label="Next day" disabled={date >= today} onClick={() => onChange(addDays(date, 1))}>→</button>
    </div>
  );
}
