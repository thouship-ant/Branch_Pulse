'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useAttention } from '@/lib/useAttention';

const lakh = (v: number) => (Math.abs(v) >= 100000 ? `₹${(v / 100000).toFixed(1)} L` : formatINR(String(v), { decimals: false }));
const ageDays = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime()) / 86_400_000)) : 0);

/**
 * The top of the Admin's home (UX audit UX-01..UX-03): what needs doing today, one line each with its age and a button, instead of
 * 14 equal cards and a scrolling alert. Four figures, the days not closed per branch, and the last week's sales.
 */
export function HomeFocus({ summary, periodLabel }: { summary: any; periodLabel: string }) {
  const { t, pick } = useT();
  const { me, can } = useSession();
  const isTeaShop = me?.company?.businessType === 'TEA_SHOP';
  const att = useAttention();
  const [pending, setPending] = useState<any[]>([]);
  const [awaiting, setAwaiting] = useState<any[]>([]);
  const [sales, setSales] = useState<{ dates: string[]; total: Array<string | null> } | null>(null);
  const [dues, setDues] = useState<{ total: number; overdue: number; suppliers: number } | null>(null);
  const today = todayIST();

  useEffect(() => {
    let alive = true;
    if (can('alert:view')) api.get<any[]>('/pending-closings').then((r) => alive && setPending(r)).catch(() => undefined);
    if (can('closing:approve')) api.get<any[]>('/closings/awaiting').then((r) => alive && setAwaiting(r)).catch(() => undefined);
    if (can('dashboard:view')) api.get(`/dashboard/charts/daily-sales-trend?from=${addDays(today, -6)}&to=${today}`).then((r: any) => alive && setSales(r)).catch(() => undefined);
    if (can('purchase:view')) api.get(`/purchases/summary?from=${addDays(today, -29)}&to=${today}`).then((r: any) => alive && setDues({ total: Number(r.outstanding.total), overdue: Number(r.outstanding.overdue), suppliers: r.outstanding.suppliers })).catch(() => undefined);
    return () => { alive = false; };
  }, [can, today]);

  const tl = summary?.tiles;
  const greeting = new Date().getHours() < 12 ? t('goodMorning') : new Date().getHours() < 17 ? t('goodAfternoon') : t('goodEvening');

  // one line per thing that needs attention, most urgent first
  const lines = useMemo(() => {
    const out: Array<{ key: string; tone: 'red' | 'amber'; text: string; age: number; href: string; cta: string }> = [];
    if (att.closings > 0) out.push({ key: 'c', tone: 'red', text: `${att.closings} ${t('attClosingsWait')}`, age: ageDays(att.oldestClosing), href: '/approvals?tab=closing', cta: t('attReview') });
    if (att.expenses > 0) out.push({ key: 'e', tone: 'red', text: `${att.expenses} ${t('attExpenses')}, ${formatINR(String(att.expenseAmount), { decimals: false })}`, age: ageDays(att.oldestExpense), href: '/approvals?tab=expenses', cta: t('attReview') });
    if (att.requests > 0) out.push({ key: 'r', tone: 'amber', text: `${att.requests} ${t('attRequests')}`, age: 0, href: '/approvals?tab=backdate', cta: t('attReview') });
    if (att.unclosedBranches > 0) out.push({ key: 'u', tone: 'amber', text: `${att.unclosedBranches} ${t('attBranchesNotClosed')}${att.oldestUnclosed ? ` ${prettyDate(att.oldestUnclosed)}` : ''}`, age: ageDays(att.oldestUnclosed), href: '/closings', cta: t('attView') });
    if (dues && dues.overdue > 0) out.push({ key: 'd', tone: 'red', text: `${lakh(dues.overdue)} ${t('attOverdue')}`, age: 0, href: '/purchases', cta: t('attPlan') });
    return out;
  }, [att, dues, t]);

  // days not closed: one row per branch, the last 7 days
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

  const card = (label: string, value: string, sub?: string, bad?: boolean) => (
    <div className="card">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className={`mt-0.5 whitespace-nowrap text-[clamp(1.2rem,5.6vw,1.6rem)] font-extrabold tabular-nums ${bad ? 'text-red-700' : ''}`}>{value}</p>
      {sub && <p className={`text-xs ${bad ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{sub}</p>}
    </div>
  );
  const branches = grid.length;
  const closedToday = grid.filter((g) => g.cells[6] === 'done').length;

  return (
    <div className="space-y-4">
      {!isTeaShop && (
        <>
          <div>
            <h2 className="text-2xl font-bold">{greeting}, {me?.fullName}</h2>
            <p className="text-sm text-slate-600">{prettyDate(today)} · {closedToday} / {branches} {t('attClosedToday')}</p>
          </div>

          {/* one still summary line, with the button to act on it (UX-03) */}
          {(att.waiting > 0 || att.unclosedBranches > 0) && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-card border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <Icon name="alert" size={18} className="shrink-0" />
              <span className="min-w-0 flex-1">
                {att.unclosedBranches > 0 && <b>{att.unclosedBranches} {t('attBranchesNotClosed')}{att.oldestUnclosed ? ` ${prettyDate(att.oldestUnclosed)}` : ''}. </b>}
                {att.closings > 0 && `${att.closings} ${t('attClosingsWait')}. `}{att.expenses > 0 && `${att.expenses} ${t('attExpenses')}.`}
              </span>
              <Link href="/approvals" className="btn-primary min-h-[38px] px-4 text-sm">{t('attReview')}</Link>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {card(`${t('totalSales')} · ${periodLabel}`, tl ? lakh(Number(tl.totalSales)) : '—', tl ? undefined : undefined)}
            {card(t('cash'), tl ? (tl.cash === null ? t('notCounted') : lakh(Number(tl.cash))) : '—', tl?.hasCashShortage ? t('shortage') : undefined, !!tl?.hasCashShortage)}
            {card(`${t('expenses')} · ${periodLabel}`, tl ? lakh(Number(tl.totalExpenses)) : '—')}
            {card(t('rOutstanding'), dues ? lakh(dues.total) : tl ? lakh(Number(tl.supplierOutstanding)) : '—', dues && dues.overdue > 0 ? `${lakh(dues.overdue)} ${t('attOverdue').split(' ')[0]}` : undefined, !!dues && dues.overdue > 0)}
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3" aria-label={t('attTitle')}>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">{t('attTitle')}</h3>
            {lines.length > 0 && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">{lines.length}</span>}
          </div>
          {lines.length === 0 ? <p className="flex items-center gap-2 text-sm font-medium text-emerald-800"><Icon name="checkCircle" size={18} />{t('allClosed')}</p> : (
            <ul className="divide-y divide-slate-200">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center gap-3 py-2.5 text-sm">
                  <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${l.tone === 'red' ? 'bg-red-600' : 'bg-amber-500'}`} />
                  <span className="min-w-0 flex-1 font-medium">{l.text}</span>
                  {l.age > 0 && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${l.age >= 3 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{l.age} {t('attDays')}</span>}
                  <Link href={l.href} className="btn-secondary min-h-[36px] shrink-0 px-3 text-sm">{l.cta}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

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
      </div>

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
