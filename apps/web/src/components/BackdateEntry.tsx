'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { PurchasesTab } from '@/components/branch/PurchasesTab';
import ClosingPage from '@/app/b/closing/page';
import ExpensePage from '@/app/b/expense/page';
import SalesPage from '@/app/b/sales/page';
import { api } from '@/lib/api';
import { useLive } from '@/lib/live';
import { DateInput } from '@/components/DateNav';
import { addDays } from '@/lib/dates';
import { leaveEntry, setEntryStep, startEntry, useEntry } from '@/lib/entry';
import { useApprovedDays } from '@/lib/useApprovedDays';
import { useT } from '@/lib/i18n';
import { useBranch } from '@/lib/useBranch';

/**
 * Entering a day that was missed and then approved by the Admin: sales, then expenses, then purchases, then the closing and its
 * submit, one after the other. The step reached is remembered, so a day that was left (or the tab closed) is opened where it stopped.
 */
export function BackdateEntry() {
  const { t } = useT();
  const entry = useEntry();
  const { locationId, today } = useBranch();
  const approved = useApprovedDays();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // a day saved from last time that is no longer open for entry (already submitted, or the approval is gone) is dropped
  useEffect(() => {
    if (!entry.date || !locationId || entry.date === today) return;
    const day = entry.date;
    api.get<Array<{ date: string; request: { status: string } | null }>>(`/backdate-requests/eligible?locationId=${locationId}`)
      .then((days) => { if (!days.some((d) => d.date === day && d.request?.status === 'APPROVED')) leaveEntry(); })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  // a step is ticked only when something was really saved for it: sales entered, a purchase, an expense, the closing submitted
  const [done, setDone] = useState<boolean[]>([false, false, false, false]);
  const day = entry.date;
  const refresh = useCallback(async () => {
    if (!locationId || !day) return;
    try {
      const [s, e, p] = await Promise.all([
        api.get<any>(`/closings/${locationId}/${day}`),
        api.get<any[]>(`/expenses?locationId=${locationId}&from=${day}&to=${day}&pageSize=100`),
        api.get<any[]>(`/purchases?locationId=${locationId}&from=${day}&to=${day}&pageSize=50`).catch(() => [] as any[]),
      ]);
      setDone([!!s?.sales, p.some((x) => x.status === 'ACTIVE'), e.some((x) => x.status === 'ACTIVE'), ['SUBMITTED', 'APPROVED'].includes(s?.closing?.status ?? 'PENDING')]);
    } catch { /* keep what is shown */ }
  }, [locationId, day]);
  useEffect(() => { void refresh(); }, [refresh, entry.step]);
  useLive(refresh);

  if (!mounted || !entry.date) return null;
  const steps = [
    { key: 'sales', label: t('sales'), icon: 'trend' },
    { key: 'purchases', label: t('purchases'), icon: 'bag' },
    { key: 'expenses', label: t('expense'), icon: 'wallet' },
    { key: 'closing', label: t('closing'), icon: 'tick' },
  ] as const;
  const step = Math.min(entry.step, steps.length - 1);
  const last = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-[rgb(var(--slate-50))]" role="dialog" aria-modal="true" aria-label={t('bdEntering')}>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col overflow-hidden">
        <div className="space-y-2.5 border-b border-slate-200 bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-500">{entry.date === today ? t('entryToday') : t('bdEntering')}</p>
              <DateInput value={entry.date} min={addDays(today, -14)} max={today} allowed={[...new Set([today, ...approved, entry.date])]} onChange={(d) => d && startEntry(d, step)} className="!mt-0.5 !min-h-[40px] !py-1 text-base font-extrabold" />
            </div>
            <button type="button" onClick={leaveEntry} aria-label={t('close')} className="grid h-10 w-10 place-items-center rounded-full bg-brand-light text-ink transition hover:brightness-95">✕</button>
          </div>
          <div className="grid grid-cols-4 gap-1.5" role="tablist">
            {steps.map((s, i) => {
              const on = i === step;
              const isDone = done[i];
              return (
                <button
                  key={s.key} type="button" role="tab" aria-selected={on} onClick={() => setEntryStep(i)}
                  className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-extrabold transition ${on ? 'bg-brand text-white' : isDone ? 'bg-emerald-50 text-emerald-800' : 'bg-brand-light text-slate-600'}`}
                >
                  <span aria-hidden className="text-base leading-none">{isDone ? '✓' : <Icon name={s.icon as any} size={16} />}</span>
                  <span className="max-w-full truncate px-1">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-8" key={step}>
          {step === 0 ? <SalesPage /> : step === 1 ? <PurchasesTab locationId={locationId} day={entry.date} /> : step === 2 ? <ExpensePage /> : <ClosingPage />}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-slate-200 bg-surface p-3">
          <button type="button" className="btn-secondary" disabled={step === 0} onClick={() => setEntryStep(step - 1)}>{t('bdBack')}</button>
          {last
            ? <button type="button" className="btn-primary" disabled={!done.every(Boolean)} onClick={leaveEntry}>{t('bdDone')}</button>
            : <button type="button" className="btn-primary" onClick={() => setEntryStep(step + 1)}>{t('bdNext')}: {steps[step + 1].label}</button>}
        </div>
      </div>
    </div>
  );
}
