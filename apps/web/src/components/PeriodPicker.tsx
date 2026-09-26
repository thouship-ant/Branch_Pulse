'use client';

import { useMemo, useState } from 'react';
import { addDays, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';

export type Preset = '7' | '30' | '90' | 'month' | 'custom';

/** Period state shared by every screen that scopes its content to a date range. */
export function usePeriod(initial: Preset = '30') {
  const today = todayIST();
  const [preset, setPreset] = useState<Preset>(initial);
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const range = useMemo(() => {
    if (preset === 'custom') return custom;
    if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
    return { from: addDays(today, -(Number(preset) - 1)), to: today };
  }, [preset, custom, today]);
  const days = (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000;
  const valid = range.from <= range.to && days <= 400;
  return { preset, setPreset, custom, setCustom, range, valid, today };
}

export type Period = ReturnType<typeof usePeriod>;

/** Presets first (7 / 30 / 90 days, this month), then a custom range: one row above what it scopes. */
export function PeriodPicker({ period, label }: { period: Period; label: string }) {
  const { t } = useT();
  const { preset, setPreset, custom, setCustom, today } = period;
  const presets: Array<[Preset, string]> = [['7', t('last7')], ['30', t('last30')], ['90', t('last90')], ['month', t('relThisMonth')], ['custom', t('customRange')]];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap overflow-hidden rounded-card border border-slate-300" role="radiogroup" aria-label={label}>
        {presets.map(([id, text]) => (
          <button
            key={id} role="radio" aria-checked={preset === id} onClick={() => setPreset(id)}
            className={`min-h-touch px-3 text-sm font-medium ${preset === id ? 'bg-brand text-white' : 'bg-surface text-slate-700 hover:bg-slate-100'}`}
          >
            {preset === id && <span aria-hidden>✓ </span>}{text}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-end gap-2">
          <div><label htmlFor="pf" className="label">{t('rangeFrom')}</label><input id="pf" type="date" className="field" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || c.from }))} /></div>
          <div><label htmlFor="pt" className="label">{t('rangeTo')}</label><input id="pt" type="date" className="field" value={custom.to} min={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || c.to }))} /></div>
        </div>
      )}
    </div>
  );
}
