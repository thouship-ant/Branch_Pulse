'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { prettyDate, shortDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { BarList, ChartCard, compact, LineChart } from '../charts';
import { Icon, type IconName } from '../Icon';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { ErrorBox, Skeleton, StatusPill } from '../ui';

const money = (n: number) => formatINR(n, { decimals: false });
const n = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** RFC 4180 cell escaping. */
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Branch-wise report for a period: summary, payment mix, expense mix and the day-by-day table (CSV export). */
export function ReportsTab({ branch }: { branch: any }) {
  const { t, pick } = useT();
  const period = usePeriod('30');
  const { range, valid } = period;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    setLoading(true);
    api.get(`/locations/${branch.id}/report?from=${range.from}&to=${range.to}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [branch.id, range.from, range.to, valid]);

  const s = data?.summary;
  const dayRows: any[] = data?.days ?? [];
  const salesLine = useMemo(() => dayRows.map((d) => n(d.sales)), [dayRows]);
  const hasSales = salesLine.some((v) => v !== null);

  function downloadCsv() {
    const head = ['Date', 'Sales', 'Cash', 'UPI', 'Card', 'Credit', 'Expenses', 'Wastage', 'Cash variance', 'Closing'];
    const lines = [
      [`${branch.code} ${branch.name}`, `${data.from} to ${data.to}`],
      [], head,
      ...dayRows.map((d) => [d.date, d.sales, d.cash, d.upi, d.card, d.credit, d.expenses, d.wastage, d.cashVariance, d.closingStatus]),
      [], ['Expense category', 'Amount', 'Share %'],
      ...(data.expenseByCategory as any[]).map((c) => [c.name, c.amount, c.sharePct]),
    ];
    // BOM so Excel opens UTF-8 (Tamil names, rupee sign) correctly
    const blob = new Blob(['﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${branch.code}-report-${data.from}_${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const Tile = ({ icon, label, value, sub, bad }: { icon: IconName; label: string; value: string; sub?: string; bad?: boolean }) => (
    <div className={`card flex items-center gap-3 ${bad ? 'border-red-300' : ''}`}>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${bad ? 'bg-red-50 text-red-800' : 'bg-brand-light text-brand-dark'}`}><Icon name={icon} size={22} /></span>
      <div className="min-w-0"><p className="truncate text-sm text-slate-600">{label}</p><p className="text-xl font-bold tabular-nums">{value}</p>{sub && <p className="text-xs text-slate-600">{sub}</p>}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker period={period} label={t('tabReports')} />
        <button className="btn-secondary" disabled={!data} onClick={downloadCsv}>⬇ {t('downloadCsv')}</button>
      </div>
      {!valid && <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {t('invalidRange')}</p>}
      <ErrorBox error={error} />

      {!data ? <Skeleton className="h-64" /> : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Tile icon="trend" label={t('totalSales')} value={money(Number(s.totalSales))} sub={`${s.salesDays} ${t('daysLabel')}`} />
            <Tile icon="bars" label={t('avgDaily')} value={s.avgDailySales === null ? '—' : money(Number(s.avgDailySales))} />
            <Tile icon="card" label={t('expenses')} value={money(Number(s.totalExpenses))} sub={`${t('wastage')} ${money(Number(s.totalWastage))}`} />
            <Tile icon="wallet" label={t('operatingProfit')} value={money(Number(s.operatingProfit))} sub={s.marginPct === null ? undefined : `${t('marginLabel')} ${s.marginPct}%`} bad={Number(s.operatingProfit) < 0} />
            <Tile icon="alert" label={t('cashVariance')} value={money(Number(s.netCashVariance))} sub={`${s.shortageDays} ${t('shortageDays')}`} bad={s.shortageDays > 0} />
            <div className="card">
              <p className="mb-1 text-sm text-slate-600">{t('closingsSummary')}</p>
              <div className="flex flex-wrap gap-1.5">
                {(['approved', 'submitted', 'rejected', 'reopened', 'pending'] as const).filter((k) => s.closings[k] > 0).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 text-sm"><StatusPill status={k.toUpperCase()} /><b>{s.closings[k]}</b></span>
                ))}
                {Object.values(s.closings).every((x) => x === 0) && <span className="text-sm text-slate-500">—</span>}
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard className="lg:col-span-2" title={t('cSalesTrend')} subtitle={`${prettyDate(data.from)} – ${prettyDate(data.to)}`} empty={!hasSales}
              table={{ head: [t('dateLabel'), t('sales')], rows: dayRows.map((d) => [prettyDate(d.date), d.sales === null ? '—' : money(Number(d.sales))]) }}>
              <LineChart labels={dayRows.map((d) => d.date)} ariaLabel={t('cSalesTrend')} fmt={money} axisFmt={(v) => compact(v, true)} xText={shortDate} tipTitle={prettyDate}
                series={[{ key: 'sales', name: t('sales'), color: 'var(--series-1)', values: salesLine }]} />
            </ChartCard>

            <ChartCard title={t('paymentMix')} empty={Number(s.totalSales) === 0}
              table={{ head: [t('paymentMode'), t('amount'), '%'], rows: [[t('cash'), money(Number(s.cash)), `${s.cashPct ?? 0}%`], [t('upi'), money(Number(s.upi)), `${s.upiPct ?? 0}%`], [t('card'), money(Number(s.card)), `${s.cardPct ?? 0}%`], [t('credit'), money(Number(s.credit)), `${s.creditPct ?? 0}%`]] }}>
              <BarList ariaLabel={t('paymentMix')} fmt={money} color="var(--series-1)"
                rows={[['cash', s.cash, s.cashPct], ['upi', s.upi, s.upiPct], ['card', s.card, s.cardPct], ['credit', s.credit, s.creditPct]].map(([k, v, p]: any) => ({ key: k, label: t(k), value: Number(v), detail: p === null ? undefined : `${p}%` }))} />
            </ChartCard>

            <ChartCard title={t('cExpenseCats')} empty={data.expenseByCategory.length === 0}
              table={{ head: [t('category'), t('amount'), '%'], rows: data.expenseByCategory.map((c: any) => [pick(c.name, c.nameTa), money(Number(c.amount)), c.sharePct === null ? '—' : `${c.sharePct}%`]) }}>
              <BarList ariaLabel={t('cExpenseCats')} fmt={money} color="var(--series-2)"
                rows={data.expenseByCategory.map((c: any) => ({ key: c.categoryId, label: pick(c.name, c.nameTa), value: Number(c.amount), detail: c.sharePct === null ? undefined : `${c.sharePct}% ${t('ofTotal')}` }))} />
            </ChartCard>
          </div>

          <section className="card overflow-x-auto p-0" aria-label={t('dayByDay')}>
            <h3 className="px-4 pt-4 font-semibold">{t('dayByDay')}</h3>
            <table className="mt-2 w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{t('dateLabel')}</th>
                  {['sales', 'cash', 'upi', 'card', 'expenses', 'wastage', 'cashVariance'].map((k) => <th key={k} scope="col" className="px-3 py-2 text-right">{t(k as any)}</th>)}
                  <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...dayRows].reverse().map((d) => (
                  <tr key={d.date}>
                    <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-normal">{prettyDate(d.date)}</th>
                    {[d.sales, d.cash, d.upi, d.card, d.expenses, d.wastage].map((v, i) => <td key={i} className="px-3 py-2 text-right tabular-nums">{v === null ? '—' : money(Number(v))}</td>)}
                    <td className={`px-3 py-2 text-right tabular-nums ${d.cashVariance !== null && Number(d.cashVariance) < 0 ? 'font-semibold text-red-700' : ''}`}>{d.cashVariance === null ? '—' : `${Number(d.cashVariance) < 0 ? '▼ ' : ''}${money(Number(d.cashVariance))}`}</td>
                    <td className="px-3 py-2">{d.closingStatus ? <StatusPill status={d.closingStatus} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
