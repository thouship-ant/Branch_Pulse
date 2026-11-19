'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { mdiAccountCheckOutline, mdiCalendarCheckOutline, mdiClipboardCheckOutline, mdiClockOutline, mdiExitToApp, mdiStorefront, mdiStorefrontOutline } from '@mdi/js';
import { DateNav } from '@/components/DateNav';
import { Icon, MdiIcon } from '@/components/Icon';
import { PageTitle, TEA_TONE } from '@/components/TeaParts';
import { ErrorBox, Sheet, Skeleton, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, monthShort, prettyDate, prettyTime, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { useLive } from '@/lib/live';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

const BRANCH_COLORS = ['#d84b4b', '#e19a18', '#31934c', '#3375bd', '#8f55b5', '#18887e'];

/** The count tile at the top: a solid status icon, the number, a faint hint icon and the label. */
function CountTile({ kind, value, label, deco }: { kind: 'open' | 'wait' | 'done'; value: number; label: string; deco: string }) {
  const tone = kind === 'open' ? TEA_TONE.bad : kind === 'wait' ? TEA_TONE.warn : TEA_TONE.ok;
  return (
    <div className="flex min-h-[92px] flex-col justify-between rounded-[18px] border border-white/80 p-3.5" style={{ background: tone.bg, boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center gap-2">
        {kind === 'wait'
          ? <span style={{ color: tone.fg }} aria-hidden><MdiIcon path={mdiClockOutline} size={30} /></span>
          : <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[18px] font-black leading-none text-white" style={{ background: tone.fg }} aria-hidden>{kind === 'open' ? '!' : <Icon name="tick" size={17} strokeWidth={3.4} />}</span>}
        <span className="text-3xl font-extrabold tabular-nums text-[#2d211b]">{value}</span>
        <span className="ml-auto opacity-70" style={{ color: tone.fg }} aria-hidden><MdiIcon path={deco} size={26} /></span>
      </div>
      <p className="text-center text-sm font-semibold text-[#2d211b]">{label}</p>
    </div>
  );
}

/**
 * Tea-shop Closings page: count tiles, the "Open closing backlog" button (a pop-up with every branch for one day) and the
 * branch x day status table. Mirrors the mobile app.
 */
export function TeaClosingBoard() {
  const { t, pick } = useT();
  const { me } = useSession();
  const [pending, setPending] = useState<any[] | null>(null);
  const [awaiting, setAwaiting] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [daysToShow, setDaysToShow] = useState<7 | 14>(7);
  const [dayOpen, setDayOpen] = useState(false);
  const today = todayIST();

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([api.get<any[]>('/pending-closings'), api.get<any[]>('/closings/awaiting').catch(() => [] as any[])]);
      setPending(p); setAwaiting(a); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLive(load, ['DAILY_CLOSING', 'DAILY_SALES', 'CASH_RECONCILIATION']);

  const days = useMemo(() => Array.from({ length: daysToShow }, (_, i) => addDays(today, i - (daysToShow - 1))), [today, daysToShow]);
  const branches = useMemo(() => (me?.locations ?? []).filter((l) => l.type === 'BRANCH'), [me]);
  const open = useMemo(() => new Set((pending ?? []).map((p) => `${p.locationId}|${String(p.businessDate).slice(0, 10)}`)), [pending]);
  const waiting = useMemo(() => new Map(awaiting.map((a) => [`${a.locationId}|${String(a.businessDate).slice(0, 10)}`, a])), [awaiting]);
  const ageOf = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  const openToday = branches.filter((b) => open.has(`${b.id}|${today}`)).length;
  const waitingToday = branches.filter((b) => waiting.has(`${b.id}|${today}`)).length;
  const closedToday = Math.max(0, branches.length - openToday - waitingToday);

  return (
    <div className="space-y-4">
      <PageTitle mdi={mdiClipboardCheckOutline} title={t('tcTitle')} subtitle={t('tcSub')} />
      <ErrorBox error={error} />
      {!pending ? <Skeleton className="h-64" /> : (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <CountTile kind="open" value={openToday} label={t('attNotClosed')} deco={mdiStorefrontOutline} />
            <CountTile kind="wait" value={waitingToday} label={t('attWaitingYou')} deco={mdiAccountCheckOutline} />
            <CountTile kind="done" value={closedToday} label={t('closedToday')} deco={mdiCalendarCheckOutline} />
          </div>

          <button
            type="button" onClick={() => setDayOpen(true)}
            className="flex min-h-[56px] w-full items-center gap-3 rounded-[18px] bg-[#6d2f12] px-4 text-left text-[#fff4e8] shadow-lg shadow-[#45220f]/25 transition hover:brightness-110 active:scale-[0.99]"
          >
            <MdiIcon path={mdiExitToApp} size={24} />
            <span className="flex-1 text-[15px] font-bold">{t('openBacklogBtn')}</span>
            <Icon name="chevronRight" size={22} />
          </button>

          <section className="card !rounded-3xl !p-3.5" aria-label={t('closeStatusTitle')}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-extrabold"><span className="text-[#6a351c]" aria-hidden><MdiIcon path={mdiStorefrontOutline} size={22} /></span>{t('closeStatusTitle')}</h3>
              <button
                type="button" onClick={() => setDaysToShow((d) => (d === 7 ? 14 : 7))} aria-label={t('lastNDays', { n: daysToShow })}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-slate-200 bg-surface px-3 text-xs font-bold transition hover:bg-slate-100"
              >
                <Icon name="calendar" size={14} />{t('lastNDays', { n: daysToShow })}<Icon name="chevronDown" size={14} />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-keep>
                <thead>
                  <tr className="bg-[#f8ead9] text-slate-800 dark:bg-slate-100">
                    <th className="rounded-l-xl px-3 py-2 text-left text-xs font-extrabold">{t('branch')}</th>
                    {days.map((d, i) => (
                      <th key={d} className={`px-1 py-2 text-center ${i === days.length - 1 ? 'rounded-r-xl' : ''}`} title={prettyDate(d)}>
                        <span className="block text-xs font-extrabold tabular-nums">{d.slice(8)}</span>
                        <span className="block text-[10px] font-normal text-slate-600">{monthShort(d.slice(0, 7))}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b, index) => (
                    <tr key={b.id} className="border-t border-slate-200/70">
                      <th scope="row" className="whitespace-nowrap py-1.5 pl-3 pr-3 text-left font-bold">
                        <span className="inline-flex items-center gap-2"><span style={{ color: BRANCH_COLORS[index % BRANCH_COLORS.length] }} aria-hidden><MdiIcon path={mdiStorefront} size={18} /></span>{pick(b.name, b.nameTa)}</span>
                      </th>
                      {days.map((d) => {
                        const k = `${b.id}|${d}`;
                        const w = waiting.get(k);
                        const cell = open.has(k)
                          ? { cls: 'bg-[#fee2e2] text-[#c92d2d]', txt: '!', tip: t('attNotClosed') }
                          : w
                            ? { cls: 'bg-[#fff0cc] text-[#bd7808]', txt: `${ageOf(w.submittedAt ?? w.businessDate)}d`, tip: t('attWaitingYou') }
                            : { cls: 'bg-[#1f7a35] text-white', txt: '✓', tip: t('attClosed') };
                        return (
                          <td key={d} className="px-1 py-1.5 text-center">
                            <Link href={`/closings/${b.id}/${d}`} aria-label={`${pick(b.name, b.nameTa)} ${prettyDate(d)} · ${cell.tip}`} title={`${prettyDate(d)} · ${cell.tip}`} className={`mx-auto grid h-8 w-[38px] place-items-center rounded-[10px] text-sm font-extrabold transition hover:scale-105 ${cell.cls}`}>{cell.txt}</Link>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="flex flex-wrap justify-around gap-x-4 gap-y-1 rounded-2xl bg-[#f8ead9] px-3 py-2.5 text-sm text-slate-800 dark:bg-slate-100">
            <span><b className="text-[#b91c1c]">!</b> {t('attNotClosed')}</span>
            <span><b className="text-[#d88a08]">◷</b> {t('attWaitingYou')}</span>
            <span><b className="text-[#1f7a35]">✓</b> {t('attClosed')}</span>
          </p>
        </>
      )}

      <ByDaySheet open={dayOpen} onClose={() => setDayOpen(false)} />
    </div>
  );
}

/** The pop-up behind "Open closing backlog": every branch's closing for one day, with a date picker. */
function ByDaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, pick } = useT();
  const [date, setDate] = useState(todayIST());
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null);
    api.get<any[]>(`/closings?date=${date}`).then((r) => { if (alive) { setRows(r); setError(null); } }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [open, date]);

  return (
    <Sheet open={open} onClose={onClose} title={t('closingsByDay')}>
      <div className="space-y-3">
        <DateNav id="tcd" date={date} onChange={setDate} />
        <ErrorBox error={error} />
        {!rows ? <Skeleton className="h-48" /> : (
          <ul className="space-y-2.5">
            {rows.map((r) => {
              const v = r.cashVariance;
              return (
                <li key={r.locationId}>
                  <Link href={`/closings/${r.locationId}/${date}`} className="card flex min-h-[72px] items-center justify-between gap-3 !rounded-2xl hover:border-brand">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{pick(r.locationName, r.locationNameTa)}</p>
                      <p className="text-sm tabular-nums text-slate-600">{t('sales')}: {formatINR(r.totalSales, { decimals: false })}</p>
                      <p className={`text-sm tabular-nums ${v && dec(v).isNegative() ? 'font-semibold text-red-700' : 'text-slate-600'}`}>
                        {t('cashVariance')}: {v == null ? '—' : `${dec(v).isNegative() ? '▼ ' : ''}${formatINR(v, { decimals: false })}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusPill status={r.status} />
                      {r.submittedAt && <p className="mt-1 text-xs text-slate-500">{prettyTime(r.submittedAt)}</p>}
                      {r.reopenCount > 0 && <p className="text-xs text-violet-700">↺ ×{r.reopenCount}</p>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
