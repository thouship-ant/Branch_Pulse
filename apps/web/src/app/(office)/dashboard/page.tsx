'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardCharts } from '@/components/DashboardCharts';
import { DateNav } from '@/components/DateNav';
import { Icon, type IconName } from '@/components/Icon';
import { ErrorBox, Skeleton, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { EXCEPTION_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';

interface Exc { code: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; group: string; groupKey: string; groupParam?: number; title: string; locationId?: string; locationName?: string; locationNameTa?: string | null; businessDate?: string; metric?: string; link: { type: string; locationId?: string; date?: string } }
type SortKey = 'name' | 'sales' | 'expenses' | 'net' | 'cash' | 'upi' | 'purchases' | 'wastage' | 'cashVariance';

const SEV: Record<string, { icon: string; cls: string }> = {
  CRITICAL: { icon: '⛔', cls: 'border-red-300 bg-red-50 text-red-900' },
  WARNING: { icon: '⚠', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
  INFO: { icon: 'ⓘ', cls: 'border-sky-300 bg-sky-50 text-sky-900' },
};

export default function Dashboard() {
  const { t, pick } = useT();
  const [date, setDate] = useState(todayIST());
  const [summary, setSummary] = useState<any>(null);
  const [exceptions, setExceptions] = useState<Exc[]>([]);
  const [allClosed, setAllClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });

  const load = useCallback(async () => {
    try {
      const [s, ex] = await Promise.all([api.get(`/dashboard/summary?date=${date}`), api.full.get<Exc[]>('/exceptions')]);
      setSummary(s);
      setExceptions(ex.data);
      setAllClosed(!!ex.meta?.allClosed);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [date]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 60_000); // auto-refresh 60 s
    return () => clearInterval(timer);
  }, [load]);

  const rows = useMemo(() => {
    const list = [...(summary?.branches ?? [])];
    return list.sort((a: any, b: any) => {
      const av = sort.key === 'name' ? a.name : a[sort.key] == null ? -Infinity : Number(a[sort.key]);
      const bv = sort.key === 'name' ? b.name : b[sort.key] == null ? -Infinity : Number(b[sort.key]);
      return (av > bv ? 1 : av < bv ? -1 : 0) * sort.dir;
    });
  }, [summary, sort]);

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const Th = ({ k, children, right = true }: { k: SortKey; children: string; right?: boolean }) => (
    <th scope="col" className={`whitespace-nowrap px-3 py-2 ${right ? 'text-right' : 'text-left'}`} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="font-semibold" onClick={() => sortBy(k)}>{children}{sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button>
    </th>
  );

  if (!summary) return error ? <ErrorBox error={error} /> : <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  const tl = summary.tiles;
  const change = summary.vsLastWeek.salesChangePct;

  // group by issue + date, keeping the server's order (critical first, newest date first)
  const groups: Array<{ key: string; heading: string; param?: number; date?: string | null; items: Exc[] }> = [];
  for (const e of exceptions) {
    const key = `${e.groupKey}|${e.businessDate ?? ''}`;
    const found = groups.find((g) => g.key === key);
    if (found) found.items.push(e);
    else groups.push({ key, heading: e.group, param: e.groupParam, date: e.businessDate, items: [e] });
  }

  const linkFor = (e: Exc) =>
    e.link.type === 'EXPENSE_QUEUE' ? '/approvals' :
    e.link.type === 'CASH_RECONCILIATION' && e.link.locationId && e.link.date ? `/cash/${e.link.locationId}/${e.link.date}` : e.link.locationId && e.link.date ? `/closings/${e.link.locationId}/${e.link.date}` : '/closings';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-bold">{t('dashboard')}</h2>
        <DateNav id="date" date={date} onChange={setDate} />
      </div>
      <ErrorBox error={error} />

      {/* Band 1: exceptions first */}
      <section aria-label={t('exceptions')} className="space-y-2">
        {exceptions.length === 0 && allClosed && (
          <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-4 py-3 font-semibold text-emerald-900">✓ {t('allClosed')}</p>
        )}
        {exceptions.length === 0 && !allClosed && <p className="text-sm text-slate-500">{t('noExceptions')}</p>}
        {/* one heading per issue and date, with the affected branches listed under it */}
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="mb-1 text-sm font-semibold text-slate-700">
                {g.key.split('|')[0] in EXCEPTION_KEY ? t(EXCEPTION_KEY[g.key.split('|')[0]], { n: g.param ?? '' }) : g.heading}
                {g.date ? ` - ${prettyDate(g.date)}` : ''}
              </h3>
              <div className="flex flex-wrap gap-2">
                {g.items.map((e, i) => (
                  <Link key={i} href={linkFor(e)} className={`chip min-h-touch text-sm ${SEV[e.severity].cls}`}>
                    <span aria-hidden>{SEV[e.severity].icon}</span>
                    {e.locationName ? pick(e.locationName, e.locationNameTa) : e.title}
                    {e.code.startsWith('CASH') && e.metric ? ` · ${formatINR(String(Math.abs(Number(e.metric))), { decimals: false })}` : ''}
                    {e.code === 'APPROVAL_PENDING' && e.metric ? ` (${e.metric})` : ''}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Band 2: KPI tiles */}
      <section aria-label="KPIs" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon="trend" tint="blue" label={t('totalSales')} value={formatINR(tl.totalSales, { decimals: false })} sub={change != null ? `${Number(change) >= 0 ? '▲' : '▼'} ${Math.abs(Number(change))}% ${t('vsLastWeek')}` : undefined} />
        <Tile icon="card" tint="amber" label={t('expenses')} value={formatINR(tl.totalExpenses, { decimals: false })} />
        <Tile icon="bars" tint="green" label={t('net')} value={formatINR(tl.netOperating, { decimals: false })} />
        <Tile icon="bag" tint="violet" label={t('purchases')} value={formatINR(tl.totalPurchases, { decimals: false })} />
        <Tile icon="wallet" tint="green" label={t('cash')} value={formatINR(tl.cash, { decimals: false })} />
        <Tile icon="phone" tint="sky" label={t('upi')} value={formatINR(tl.upi, { decimals: false })} />
        <Tile icon="card" tint="blue" label={t('card')} value={formatINR(tl.card, { decimals: false })} />
        <Tile icon="trash" tint="amber" label={t('wastage')} value={formatINR(tl.wastage, { decimals: false })} />
        <Tile
          icon="alert" tint="green" label={t('cashVariance')} value={formatINR(tl.cashVariance, { decimals: false })}
          sub={tl.hasCashShortage ? `▼ ${t('shortage')}` : dec(tl.cashVariance).isZero() ? `✓ ${t('tallied')}` : undefined}
          tone={tl.hasCashShortage ? 'bad' : 'ok'}
        />
        <Tile icon="clock" tint="blue" label={`${t('pending')} ${t('closings')}`} value={`${tl.pendingClosings} / ${tl.branchCount}`} tone={tl.pendingClosings ? 'warn' : 'ok'} />
      </section>

      {/* Band 3: branch table */}
      <section aria-label={t('branch')} className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left"><button className="font-semibold" onClick={() => sortBy('name')}>{t('branch')}{sort.key === 'name' ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>
              <Th k="sales">{t('sales')}</Th><Th k="expenses">{t('expenses')}</Th><Th k="net">{t('net')}</Th>
              <Th k="cash">{t('cash')}</Th><Th k="upi">{t('upi')}</Th><Th k="purchases">{t('purchases')}</Th>
              <Th k="wastage">{t('wastage')}</Th><Th k="cashVariance">{t('cashVariance')}</Th>
              <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((b: any) => (
              <tr key={b.locationId} className="hover:bg-slate-50">
                <th scope="row" className="sticky left-0 bg-surface px-3 py-3 text-left font-medium">
                  <Link href={`/closings/${b.locationId}/${date}`} className="hover:underline">{pick(b.name, b.nameTa)}</Link>
                </th>
                <Td v={b.sales} /><Td v={b.expenses} /><Td v={b.net} /><Td v={b.cash} /><Td v={b.upi} /><Td v={b.purchases} /><Td v={b.wastage} />
                <td className={`px-3 py-3 text-right tabular-nums ${b.cashVariance && dec(b.cashVariance).isNegative() ? 'font-semibold text-red-700' : ''}`}>
                  {b.cashVariance == null ? '—' : `${dec(b.cashVariance).isNegative() ? '▼ ' : ''}${formatINR(b.cashVariance, { decimals: false })}`}
                </td>
                <td className="px-3 py-3"><StatusPill status={b.closingStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Band 4: charts (own period filter; fetched lazily when scrolled near) */}
      <DashboardCharts />
    </div>
  );
}

function Td({ v }: { v: string }) {
  return <td className="px-3 py-3 text-right tabular-nums">{formatINR(v, { decimals: false })}</td>;
}

const TINT = {
  blue: 'bg-brand-light text-brand-dark',
  green: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-amber-50 text-amber-800',
  violet: 'bg-violet-50 text-violet-800',
  red: 'bg-red-50 text-red-800',
  sky: 'bg-sky-50 text-sky-900',
} as const;

/** KPI card: tinted icon chip + label + value, like the reference admin theme. */
function Tile({
  label, value, sub, tone, icon, tint = 'blue',
}: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad'; icon: IconName; tint?: keyof typeof TINT }) {
  const cls = tone === 'bad' ? 'border-red-300' : tone === 'warn' ? 'border-amber-300' : '';
  return (
    <div className={`card flex items-center gap-3 ${cls}`}>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TINT[tone === 'bad' ? 'red' : tone === 'warn' ? 'amber' : tint]}`}>
        <Icon name={icon} size={22} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-600">{label}</p>
        <p className="text-[22px] font-extrabold leading-tight tracking-tight tabular-nums">{value}</p>
        {sub && <p className="text-xs text-slate-600">{sub}</p>}
      </div>
    </div>
  );
}
