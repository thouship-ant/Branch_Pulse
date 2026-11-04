'use client';

import { useState } from 'react';
import { Icon } from './Icon';
import { RangeCalendar } from './RangeCalendar';
import { Sheet } from './ui';
import { useT, type MessageKey } from '@/lib/i18n';
import { PERIOD_IDS, periodCustomText, resolvePeriod, type Period, type PeriodId } from '@/lib/period';

const LABEL: Record<PeriodId, MessageKey> = {
  today: 'today', yesterday: 'pYesterday', week: 'pThisWeek', month: 'pThisMonth', all: 'pAllTime', custom: 'customRange',
};

/** "Today v" pill: opens "Select Period" (Today, Yesterday, This Week, This Month, All Time, Custom Range on a calendar) - the same picker as the mobile app. */
export function PeriodDropdown({ period, today, onChange }: { period: Period; today: string; onChange: (p: Period) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const close = () => { setOpen(false); setCalendar(false); };
  const choose = (id: PeriodId) => {
    if (id === 'custom') { setCalendar(true); return; }
    onChange(resolvePeriod(id, today));
    close();
  };
  const text = period.id === 'custom' ? periodCustomText(period) : t(LABEL[period.id]);

  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`${t('selectPeriod')}: ${text}`}
        className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-full bg-brand px-5 text-[15px] font-bold text-white shadow-md shadow-brand/25 transition hover:bg-brand-dark active:scale-[0.98]"
      >
        <Icon name="calendar" size={17} />
        <span className="truncate">{text}</span>
        <Icon name="chevronDown" size={18} />
      </button>
      <Sheet open={open} onClose={close} title={calendar ? t('customRange') : t('selectPeriod')}>
        {calendar ? (
          <RangeCalendar from={period.from} to={period.to} max={today} onCancel={() => setCalendar(false)} onApply={(r) => { onChange(resolvePeriod('custom', today, r)); close(); }} />
        ) : (
          <ul role="listbox" aria-label={t('selectPeriod')} className="-mx-1">
            {PERIOD_IDS.map((id) => {
              const on = id === period.id;
              return (
                <li key={id} role="option" aria-selected={on}>
                  <button
                    type="button" onClick={() => choose(id)}
                    className={`flex min-h-[52px] w-full items-center justify-between border-b border-slate-200/80 px-2 text-left text-[17px] transition hover:bg-slate-50 ${on ? 'font-extrabold text-brand' : 'font-medium text-ink'}`}
                  >
                    {t(LABEL[id])}
                    {on ? <Icon name="tick" size={20} /> : id === 'custom' ? <Icon name="chevronRight" size={20} className="text-slate-400" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </>
  );
}
