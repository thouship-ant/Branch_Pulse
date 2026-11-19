'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { useIsTea } from './TeaParts';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useAttention } from '@/lib/useAttention';

/** The "Tea and Snacks" pictures on a tea shop's Home: all of them at once, four to a row on a wide screen. */
const TEA_SNACKS = [
  { image: 'tea-1.jpg', title: 'Chai & cookies', caption: 'A little tea-time favourite' },
  { image: 'bread-omelette.png', title: 'Bread omelette', caption: 'A filling tea-time bite' },
  { image: 'tea-3.jpg', title: 'Iced tea', caption: 'A refreshing shop special' },
  { image: 'tea-4.jpg', title: 'Ginger tea', caption: 'Fresh ginger with warm tea' },
  { image: 'vada.jpg', title: 'Medhu Vada', caption: 'A crisp, savoury snack' },
  { image: 'samosa.jpg', title: 'Samosa', caption: 'A golden, flaky favourite' },
  { image: 'fries.jpg', title: 'French fries', caption: 'Hot and crispy' },
  { image: 'tea-2.jpg', title: 'Freshly brewed', caption: 'Made for a relaxing break' },
] as const;

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
  const tea = useIsTea();
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

  // tea shop: the four figures are solid colour tiles with white text, as on the mobile app's Home
  const TEA_HOME = ['#b65317', '#23933d', '#8436a8', '#bd3549'];
  let tileNo = 0;
  const card = (label: string, value: string, sub?: string, bad?: boolean) => {
    const bg = TEA_HOME[tileNo++ % TEA_HOME.length];
    if (tea) {
      return (
        <div className="rounded-2xl p-4 text-white" style={{ background: bg, boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-medium text-white/90">{label}</p>
          <p className="mt-0.5 whitespace-nowrap text-[clamp(1.2rem,5.6vw,1.6rem)] font-extrabold tabular-nums">{value}</p>
          {sub && <p className="text-xs font-semibold text-white/90">{sub}</p>}
        </div>
      );
    }
    return (
      <div className="card">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <p className={`mt-0.5 whitespace-nowrap text-[clamp(1.2rem,5.6vw,1.6rem)] font-extrabold tabular-nums ${bad ? 'text-red-700' : ''}`}>{value}</p>
        {sub && <p className={`text-xs ${bad ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{sub}</p>}
      </div>
    );
  };
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

      <div className="grid gap-4">
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


      </div>



      {isTeaShop && (
        <section className="space-y-2" aria-label="Tea and Snacks">
          <h3 className="inline-block rounded-xl bg-surface/90 px-3 py-1 text-lg font-bold shadow-sm backdrop-blur-sm">Tea and Snacks</h3>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {TEA_SNACKS.map((item) => (
              <li key={item.image} className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-sm">
                <Image src={`/tea-shop/${item.image}`} alt={item.title} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-slate-950/65 px-3 py-2 text-white">
                  <p className="text-sm font-extrabold leading-tight">{item.title}</p>
                  <p className="text-xs text-slate-100">{item.caption}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
