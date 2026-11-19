'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useLive } from '@/lib/live';

const lakh = (v: number) => (Math.abs(v) >= 100000 ? `₹${(v / 100000).toFixed(1)} L` : formatINR(String(v), { decimals: false }));

/** "Sales, last 7 days" and "branches not closed since": the two cards that used to sit on Home (now on the Reports page). */
export function SalesClosingCards() {
  const { t, pick } = useT();
  const { me, can } = useSession();
  const [pending, setPending] = useState<any[]>([]);
  const [awaiting, setAwaiting] = useState<any[]>([]);
  const [sales, setSales] = useState<{ dates: string[]; total: Array<string | null> } | null>(null);
  const today = todayIST();

  const load = () => {
    if (can('alert:view')) api.get<any[]>('/pending-closings').then(setPending).catch(() => undefined);
    if (can('closing:approve')) api.get<any[]>('/closings/awaiting').then(setAwaiting).catch(() => undefined);
    if (can('dashboard:view')) api.get(`/dashboard/charts/daily-sales-trend?from=${addDays(today, -6)}&to=${today}`).then((r: any) => setSales(r)).catch(() => undefined);
  };
  useEffect(load, [can, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive(load, ['DAILY_CLOSING', 'DAILY_SALES']);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)), [today]);
  const grid = useMemo(() => {
    const names = new Map<string, string>();
    for (const l of me?.locations ?? []) if (l.type === 'BRANCH') names.set(l.id, pick(l.name, l.nameTa));
    const open = new Set(pending.map((p) => `${p.locationId}|${String(p.businessDate).slice(0, 10)}`));
    const waiting = new Map(awaiting.map((a) => [`${a.locationId}|${String(a.businessDate).slice(0, 10)}`, a]));
    return [...names.entries()].map(([id, name]) => ({ id, name, cells: days.map((d) => (open.has(`${id}|${d}`) ? 'open' : waiting.has(`${id}|${d}`) ? 'wait' : 'done')) }));
  }, [me, pending, awaiting, days, pick]);
  const unclosedCount = grid.filter((g) => g.cells.includes('open')).length;

  const bars = sales ? sales.dates.map((d, i) => ({ d, v: sales.total[i] === null ? null : Number(sales.total[i]) })) : [];
  const max = Math.max(1, ...bars.map((b) => b.v ?? 0));

  return (
    <div className="space-y-4">
      <section className="card space-y-2" aria-label={t('cSalesTrend')}>
        <div className="flex items-baseline justify-between"><h3 className="text-lg font-bold">{t('attSales7')}</h3><span className="text-sm font-semibold tabular-nums text-slate-600">{lakh(bars.reduce((s, b) => s + (b.v ?? 0), 0))}</span></div>
        <div className="flex h-36 items-end gap-2" role="img" aria-label={t('attSales7')}>
          {bars.map((b) => (
            <div key={b.d} className="flex h-full flex-1 flex-col justify-end" title={`${prettyDate(b.d)}: ${b.v === null ? t('attNotClosed') : formatINR(String(b.v), { decimals: false })}`}>
              {b.v === null
                ? <div className="h-full rounded-md" style={{ background: 'repeating-linear-gradient(135deg, rgb(var(--slate-200)) 0 4px, transparent 4px 8px)' }} />
                : <div className="rounded-md bg-brand/70" style={{ height: `${Math.max(6, (b.v / max) * 100)}%` }} />}
            </div>
          ))}
        </div>
        <div className="flex gap-2 text-center text-[11px] tabular-nums text-slate-600">{bars.map((b) => <span key={b.d} className="flex-1">{b.d.slice(8)}</span>)}</div>
        <p className="flex items-center gap-2 text-xs text-slate-600"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg, rgb(var(--slate-300)) 0 2px, transparent 2px 4px)' }} />{t('attNotClosedNote')}</p>
      </section>
      {grid.length > 0 && unclosedCount > 0 && (
        <section className="card space-y-3 overflow-x-auto" aria-label={t('attGridTitle')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="text-lg font-bold">{unclosedCount} {t('attBranchesNotClosed')}</h3><p className="text-xs text-slate-600">{t('attGridNote')}</p></div>
            <Link href="/closings" className="btn-secondary min-h-[38px] px-4 text-sm">{t('attBacklog')}</Link>
          </div>
          <table className="w-full min-w-[420px] text-sm" data-keep>
            <thead><tr><th className="py-1 text-left">{t('branch')}</th>{days.map((d) => <th key={d} className="px-1 py-1 text-center">{d.slice(8)}</th>)}</tr></thead>
            <tbody>
              {grid.map((g) => (
                <tr key={g.id}>
                  <th scope="row" className="py-1 pr-3 text-left font-semibold">{g.name}</th>
                  {g.cells.map((c, i) => (
                    <td key={days[i]} className="px-1 py-1 text-center">
                      <span title={prettyDate(days[i])} className={`grid h-7 place-items-center rounded-md text-xs font-bold ${c === 'open' ? 'bg-red-100 text-red-700' : c === 'wait' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>{c === 'open' ? '!' : c === 'wait' ? '◔' : '✓'}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"><span><b className="text-red-700">!</b> {t('attNotClosed')}</span><span><b className="text-amber-800">◔</b> {t('attWaitingYou')}</span><span><b className="text-emerald-800">✓</b> {t('attClosed')}</span></p>
        </section>
      )}
    </div>
  );
}
