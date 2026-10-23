'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardCharts } from '@/components/DashboardCharts';
import { DateNav } from '@/components/DateNav';
import { Icon, type IconName } from '@/components/Icon';
import { ErrorBox, Sheet, Skeleton, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { EXCEPTION_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';

interface Exc { code: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; group: string; groupKey: string; groupParam?: number; title: string; locationId?: string; locationName?: string; locationNameTa?: string | null; businessDate?: string; metric?: string; link: { type: string; locationId?: string; date?: string } }
interface PendingClosing { locationId: string; locationName: string; locationNameTa: string | null; businessDate: string; status: string }
const PENDING_PAGE_SIZE = 10;
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
  const [pendingClosings, setPendingClosings] = useState<PendingClosing[]>([]);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingPage, setPendingPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const [s, ex, pc] = await Promise.all([
        api.get(`/dashboard/summary?date=${date}`), api.full.get<Exc[]>('/exceptions'), api.get<PendingClosing[]>('/pending-closings'),
      ]);
      setSummary(s);
      setPendingClosings(pc);
      setExceptions(ex.data.filter((e) => e.code !== 'CLOSING_PENDING')); // closing details live in the banner + modal
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
  const pendingDates = [...new Set(pendingClosings.map((p) => p.businessDate))]; // already newest first

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

  // everything that needs attention, one heading per issue and date: pending closings first, then the other alerts (cash shortage ...)
  type Chip = { key: string; label: string; href: string; cls: string; icon: string };
  const alertGroups: Array<{ key: string; date: string; heading: string; chips: Chip[] }> = [
    ...pendingDates.map((d) => ({
      key: `pc|${d}`, date: d, heading: `${t('exClosingPending')} - ${prettyDate(d)}`,
      chips: pendingClosings.filter((p) => p.businessDate === d).map((p) => ({
        key: p.locationId, label: pick(p.locationName, p.locationNameTa), href: `/closings/${p.locationId}/${d}`, cls: SEV.CRITICAL.cls, icon: SEV.CRITICAL.icon,
      })),
    })),
    ...groups.map((g) => ({
      key: g.key, date: g.date ?? '',
      heading: `${g.key.split('|')[0] in EXCEPTION_KEY ? t(EXCEPTION_KEY[g.key.split('|')[0]], { n: g.param ?? '' }) : g.heading}${g.date ? ` - ${prettyDate(g.date)}` : ''}`,
      chips: g.items.map((e, i) => ({
        key: `${e.locationId}-${i}`, href: linkFor(e), cls: SEV[e.severity].cls, icon: SEV[e.severity].icon,
        label: `${e.locationName ? pick(e.locationName, e.locationNameTa) : e.title}${e.code.startsWith('CASH') && e.metric ? ` · ${formatINR(String(Math.abs(Number(e.metric))), { decimals: false })}` : ''}${e.code === 'APPROVAL_PENDING' && e.metric ? ` (${e.metric})` : ''}`,
      })),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)); // newest date first (stable: on one day closings come before other alerts; undated alerts last)
  const alertCount = alertGroups.reduce((n, g) => n + g.chips.length, 0);
  const alertPageCount = Math.max(1, Math.ceil(alertGroups.length / PENDING_PAGE_SIZE));
  const ticker = [
    pendingDates.length ? `${t('exClosingPending')} - ${pendingDates.slice(0, 6).map(prettyDate).join(', ')}${pendingDates.length > 6 ? ', ...' : ''}` : '',
    ...groups.slice(0, 4).map((g) => alertGroups.find((x) => x.key === g.key)!.heading),
  ].filter(Boolean).join('   ·   ');

  return (
    <div className="space-y-5">
      {alertCount > 0 && (
        <button
          type="button" onClick={() => { setPendingPage(1); setPendingOpen(true); }}
          className="block w-full overflow-hidden rounded-card border border-red-300 bg-red-50 px-4 py-2 text-left text-sm font-semibold text-red-900"
        >
          <span className="anim-marquee">⛔ {ticker}</span>
        </button>
      )}
      <Sheet open={pendingOpen} onClose={() => setPendingOpen(false)} title={`${t('exceptions')} (${alertCount})`}>
        <div className="space-y-4">
          {alertGroups.slice((pendingPage - 1) * PENDING_PAGE_SIZE, pendingPage * PENDING_PAGE_SIZE).map((g) => (
            <div key={g.key}>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-700">{g.heading}</h3>
              <div className="flex flex-wrap gap-2">
                {g.chips.map((c) => (
                  <Link key={c.key} href={c.href} className={`chip min-h-touch text-sm ${c.cls}`}><span aria-hidden>{c.icon}</span>{c.label}</Link>
                ))}
              </div>
            </div>
          ))}
        </div>
        {alertPageCount > 1 && (
          <div className="mt-3 flex items-center justify-between">
            <button className="btn-secondary" disabled={pendingPage <= 1} onClick={() => setPendingPage((p) => p - 1)}>{t('prevPage')}</button>
            <span className="text-sm tabular-nums text-slate-600">{pendingPage} / {alertPageCount}</span>
            <button className="btn-secondary" disabled={pendingPage >= alertPageCount} onClick={() => setPendingPage((p) => p + 1)}>{t('nextPage')}</button>
          </div>
        )}
      </Sheet>
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
        {exceptions.length === 0 && !allClosed && pendingClosings.length === 0 && <p className="text-sm text-slate-500">{t('noExceptions')}</p>}
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
        <Tile icon="box" tint="sky" label={t('stockValue')} value={formatINR(tl.totalStockValue, { decimals: false })} />
        <Tile
          icon="alert" tint="amber" label={t('stockVarianceLabel')} value={formatINR(tl.stockVariance, { decimals: false })}
          sub={dec(tl.stockVariance).isNegative() ? `▼ ${t('shortage')}` : dec(tl.stockVariance).isZero() ? undefined : `▲ ${t('excess')}`}
          tone={dec(tl.stockVariance).isNegative() ? 'bad' : undefined}
        />
        <Tile icon="user" tint="violet" label={t('salaryPayableLabel')} value={formatINR(tl.salaryPayable, { decimals: false })} />
        <Tile icon="store" tint="amber" label={t('rOutstanding')} value={formatINR(tl.supplierOutstanding, { decimals: false })} />
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
