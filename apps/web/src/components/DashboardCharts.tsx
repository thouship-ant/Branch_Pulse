'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { addDays, monthLong, monthShort, prettyDate, shortDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { BarList, ChartCard, Columns, compact, LineChart, seriesColor, type LineSeries } from './charts';

type Preset = '7' | '30' | '90' | 'month' | 'custom';
const CODES = [
  'daily-sales-trend', 'branch-sales', 'expense-categories', 'monthly-sales',
  'monthly-expenses', 'branch-profitability', 'stock-consumption', 'wastage-trend',
] as const;

const SALES = 'var(--series-1)';     // sales are always blue
const EXPENSES = 'var(--series-2)';  // expenses are always orange
const WASTAGE = 'var(--series-6)';   // wastage has its own hue

const money = (n: number) => formatINR(n, { decimals: false });
const moneyAxis = (n: number) => compact(n, true);
const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const UNIT: Record<string, string> = { ML: 'ml', L: 'L', G: 'g', KG: 'kg', PCS: 'pcs', PKT: 'pkt' };
const CONSUMPTION = 'var(--series-3)'; // stock consumption has its own hue; each panel is one series, named by its title

/** Show ml as litres and g as kilograms once the numbers get big, so axes read "133 L" not "1.3L ml". */
function scaleUnit(unit: string, max: number): { div: number; label: string } {
  if (unit === 'ML' && max >= 1000) return { div: 1000, label: 'L' };
  if (unit === 'G' && max >= 1000) return { div: 1000, label: 'kg' };
  return { div: 1, label: UNIT[unit] ?? unit.toLowerCase() };
}

export function DashboardCharts() {
  const { t, pick } = useT();
  const today = todayIST();
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trendMode, setTrendMode] = useState<'total' | 'branch'>('total');
  const [wasteMode, setWasteMode] = useState<'value' | 'pct'>('value');

  // charts are below the fold: fetch only once the section is near the viewport
  const holder = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = holder.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  const range = useMemo(() => {
    if (preset === 'custom') return custom;
    if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
    return { from: addDays(today, -(Number(preset) - 1)), to: today };
  }, [preset, custom, today]);

  const days = (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000;
  const validRange = range.from <= range.to && days <= 400;

  useEffect(() => {
    if (!seen || !validRange) return;
    let alive = true;
    setLoading(true);
    Promise.all(CODES.map((c) => api.get(`/dashboard/charts/${c}?from=${range.from}&to=${range.to}`).then((d) => [c, d] as const)))
      .then((entries) => { if (alive) { setData(Object.fromEntries(entries)); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [seen, range.from, range.to, validRange]);

  const presets: Array<[Preset, string]> = [['7', t('last7')], ['30', t('last30')], ['90', t('last90')], ['month', t('relThisMonth')], ['custom', t('customRange')]];
  const rangeText = `${prettyDate(range.from)} – ${prettyDate(range.to)}`;

  // ---- derived series
  const trend = data['daily-sales-trend'];
  const branchList: Array<{ id: string; name: string; nameTa?: string | null }> = trend?.branches ?? [];
  const canSplit = branchList.length > 1 && branchList.length <= 6; // six colour slots; beyond that a line per branch is unreadable
  const trendSeries: LineSeries[] =
    trend && trendMode === 'branch' && canSplit
      ? branchList.map((b, i) => ({ key: b.id, name: pick(b.name, b.nameTa), color: seriesColor(i), values: (trend.byBranch[b.id] as Array<string | null>).map(num) }))
      : trend ? [{ key: 'total', name: t('total'), color: SALES, values: (trend.total as Array<string | null>).map(num) }] : [];
  const trendEmpty = !trend || trend.total.every((v: string | null) => v === null);

  const bs = data['branch-sales']?.rows as Array<any> | undefined;
  const cats = data['expense-categories'];
  const catRows = useMemo(() => {
    const rows: Array<{ key: string; label: string; value: number }> = ((cats?.rows ?? []) as Array<any>).map((r) => ({ key: r.categoryId, label: pick(r.name, r.nameTa), value: Number(r.amount) }));
    // one-hue bars need no colour slots, so show every category (the default set has 17). Folding a tail of
    // near-equal categories makes "Other" the longest bar, so it only happens for a genuinely long list.
    const MAX = 25;
    if (rows.length <= MAX) return rows;
    return [...rows.slice(0, MAX - 1), { key: 'other', label: t('otherLabel'), value: rows.slice(MAX - 1).reduce((a, r) => a + r.value, 0) }];
  }, [cats, pick, t]);
  const catTotal = Number(cats?.total ?? 0);

  const monthCols = (code: string) =>
    ((data[code]?.months ?? []) as Array<{ month: string; amount: string }>).map((m, i) => ({
      key: m.month,
      // months alone are ambiguous across a year boundary, so the first column and each January carry the year
      label: i === 0 || m.month.endsWith('-01') ? `${monthShort(m.month)} ’${m.month.slice(2, 4)}` : monthShort(m.month),
      value: Number(m.amount), tipTitle: monthLong(m.month),
    }));

  const prof = data['branch-profitability']?.rows as Array<any> | undefined;
  const stock = data['stock-consumption'];
  const waste = data['wastage-trend'];

  const tipTitle = (d: string) => prettyDate(d);

  return (
    <div ref={holder} className="space-y-4">
      {/* one filter row above everything it scopes */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('chartsTitle')}</h2>
          <p className="text-sm text-slate-500">{rangeText}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex overflow-hidden rounded-card border border-slate-300" role="radiogroup" aria-label={t('chartsTitle')}>
            {presets.map(([id, label]) => (
              <button
                key={id} role="radio" aria-checked={preset === id} onClick={() => setPreset(id)}
                className={`min-h-touch px-3 text-sm font-medium ${preset === id ? 'bg-brand text-white' : 'bg-surface text-slate-700 hover:bg-slate-100'}`}
              >
                {preset === id && <span aria-hidden>✓ </span>}{label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-end gap-2">
              <div><label htmlFor="cf" className="label">{t('rangeFrom')}</label><input id="cf" type="date" className="field" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || c.from }))} /></div>
              <div><label htmlFor="ct" className="label">{t('rangeTo')}</label><input id="ct" type="date" className="field" value={custom.to} min={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || c.to }))} /></div>
            </div>
          )}
        </div>
      </div>
      {!validRange && <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {t('invalidRange')}</p>}
      {error && <p role="alert" className="rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">✕ {error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. Daily sales trend */}
        <ChartCard
          className="lg:col-span-2" title={t('cSalesTrend')} subtitle={rangeText} loading={loading} empty={trendEmpty}
          legend={trendSeries.map((s) => ({ name: s.name, color: s.color }))}
          actions={canSplit && (
            <div className="flex overflow-hidden rounded-card border border-slate-300 text-xs font-medium" role="radiogroup" aria-label={t('cSalesTrend')}>
              {(['total', 'branch'] as const).map((m) => (
                <button key={m} role="radio" aria-checked={trendMode === m} onClick={() => setTrendMode(m)} className={`min-h-[32px] px-2 ${trendMode === m ? 'bg-brand text-white' : 'bg-surface text-slate-700 hover:bg-slate-100'}`}>
                  {m === 'total' ? t('total') : t('byBranch')}
                </button>
              ))}
            </div>
          )}
          table={trend && {
            head: [t('today'), t('total'), ...(canSplit ? branchList.map((b) => pick(b.name, b.nameTa)) : [])],
            rows: (trend.dates as string[]).map((d, i) => [prettyDate(d), trend.total[i] === null ? '—' : money(Number(trend.total[i])), ...(canSplit ? branchList.map((b) => (trend.byBranch[b.id][i] === null ? '—' : money(Number(trend.byBranch[b.id][i])))) : [])]),
          }}
        >
          {trend && <LineChart labels={trend.dates} series={trendSeries} fmt={money} axisFmt={moneyAxis} xText={shortDate} tipTitle={tipTitle} ariaLabel={t('cSalesTrend')} />}
        </ChartCard>

        {/* 2. Branch-wise sales */}
        <ChartCard
          title={t('cBranchSales')} subtitle={rangeText} loading={loading} empty={!bs || bs.every((r) => Number(r.sales) === 0)}
          table={bs && { head: [t('branch'), t('sales'), t('daysLabel')], rows: bs.map((r) => [pick(r.name, r.nameTa), money(Number(r.sales)), r.days]) }}
        >
          {bs && <BarList ariaLabel={t('cBranchSales')} fmt={money} color={SALES} rows={bs.map((r) => ({ key: r.locationId, label: pick(r.name, r.nameTa), value: Number(r.sales), detail: `${r.days} ${t('daysLabel')}` }))} />}
        </ChartCard>

        {/* 3. Expense category breakdown */}
        <ChartCard
          title={t('cExpenseCats')} subtitle={rangeText} loading={loading} empty={!cats || catRows.length === 0}
          table={cats && { head: [t('category'), t('amount'), '%'], rows: catRows.map((r) => [r.label, money(r.value), catTotal ? `${((r.value / catTotal) * 100).toFixed(1)}%` : '—']) }}
        >
          {cats && <BarList ariaLabel={t('cExpenseCats')} fmt={money} color={EXPENSES} rows={catRows.map((r) => ({ ...r, detail: catTotal ? `${((r.value / catTotal) * 100).toFixed(1)}% ${t('ofTotal')}` : undefined }))} />}
        </ChartCard>

        {/* 4. Monthly sales */}
        <ChartCard
          title={t('cMonthlySales')} subtitle={`${t('last12')} · ${t('monthToDate')}`} loading={loading} empty={!data['monthly-sales'] || monthCols('monthly-sales').every((c) => c.value === 0)}
          table={data['monthly-sales'] && { head: [t('sales'), t('amount')], rows: monthCols('monthly-sales').map((c) => [c.tipTitle, money(c.value)]) }}
        >
          {data['monthly-sales'] && <Columns cols={monthCols('monthly-sales')} fmt={money} axisFmt={moneyAxis} color={SALES} ariaLabel={t('cMonthlySales')} />}
        </ChartCard>

        {/* 5. Monthly expenses */}
        <ChartCard
          title={t('cMonthlyExpenses')} subtitle={`${t('last12')} · ${t('monthToDate')}`} loading={loading} empty={!data['monthly-expenses'] || monthCols('monthly-expenses').every((c) => c.value === 0)}
          table={data['monthly-expenses'] && { head: [t('expenses'), t('amount')], rows: monthCols('monthly-expenses').map((c) => [c.tipTitle, money(c.value)]) }}
        >
          {data['monthly-expenses'] && <Columns cols={monthCols('monthly-expenses')} fmt={money} axisFmt={moneyAxis} color={EXPENSES} ariaLabel={t('cMonthlyExpenses')} />}
        </ChartCard>

        {/* 6. Branch-wise profitability: diverging around zero */}
        <ChartCard
          className="lg:col-span-2" title={t('cBranchProfit')} subtitle={t('cMarginNote')} loading={loading} empty={!prof || prof.every((r) => r.marginPct === null)}
          table={prof && { head: [t('branch'), t('sales'), t('expenses'), t('wastage'), t('net'), '%'], rows: prof.map((r) => [pick(r.name, r.nameTa), money(Number(r.sales)), money(Number(r.expenses)), money(Number(r.wastage)), money(Number(r.profit)), r.marginPct === null ? '—' : `${r.marginPct}%`]) }}
        >
          {prof && (
            <BarList
              ariaLabel={t('cBranchProfit')} diverging color={SALES} nullText={t('noSales')} fmt={(n) => `${n.toFixed(1)}%`}
              rows={prof.map((r) => ({ key: r.locationId, label: pick(r.name, r.nameTa), value: num(r.marginPct), detail: `${t('sales')} ${money(Number(r.sales))} · ${t('net')} ${money(Number(r.profit))}` }))}
            />
          )}
        </ChartCard>

        {/* 7. Stock consumption: small multiples, one axis per item because units differ */}
        <ChartCard
          className="lg:col-span-2" title={t('cStockUse')} subtitle={t('cStockNote')} loading={loading}
          empty={!stock || stock.items.length === 0} emptyText={t('noConsumption')}
          table={stock && stock.items.length > 0 && {
            head: [t('today'), ...stock.items.map((i: any) => `${pick(i.name, i.nameTa)} (${UNIT[i.unit] ?? i.unit})`)],
            // the table keeps the exact base-unit quantity so nothing is lost to rounding or unit scaling
            rows: (stock.dates as string[]).map((d, k) => [prettyDate(d), ...stock.items.map((i: any) => (i.values[k] === null ? '—' : Number(i.values[k]).toLocaleString('en-IN')))]),
          }}
        >
          {stock && (
            <div className="grid gap-4 sm:grid-cols-2">
              {stock.items.map((it: any) => {
                const raw = (it.values as Array<string | null>).map(num);
                const { div, label: unit } = scaleUnit(it.unit, Math.max(0, ...raw.map((v) => v ?? 0)));
                return (
                  <div key={it.itemId}>
                    <p className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="font-medium">{pick(it.name, it.nameTa)}</span>
                      <span className="text-xs text-slate-500">{compact(Number(it.total) / div)} {unit}</span>
                    </p>
                    <LineChart
                      height={150} labels={stock.dates} ariaLabel={`${pick(it.name, it.nameTa)} (${unit})`}
                      series={[{ key: it.itemId, name: pick(it.name, it.nameTa), color: CONSUMPTION, values: raw.map((v) => (v === null ? null : v / div)) }]}
                      fmt={(n) => `${compact(n)} ${unit}`} axisFmt={(n) => compact(n)} xText={shortDate} tipTitle={tipTitle}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>

        {/* 8. Wastage trend: value or % of sales, one axis at a time */}
        <ChartCard
          className="lg:col-span-2" title={t('cWastage')} subtitle={rangeText} loading={loading} empty={!waste || waste.value.every((v: string | null) => v === null)}
          actions={(
            <div className="flex overflow-hidden rounded-card border border-slate-300 text-xs font-medium" role="radiogroup" aria-label={t('cWastage')}>
              {(['value', 'pct'] as const).map((m) => (
                <button key={m} role="radio" aria-checked={wasteMode === m} onClick={() => setWasteMode(m)} className={`min-h-[32px] px-2 ${wasteMode === m ? 'bg-brand text-white' : 'bg-surface text-slate-700 hover:bg-slate-100'}`}>
                  {m === 'value' ? t('valueRupees') : t('pctOfSales')}
                </button>
              ))}
            </div>
          )}
          table={waste && { head: [t('today'), t('valueRupees'), t('pctOfSales')], rows: (waste.dates as string[]).map((d, i) => [prettyDate(d), waste.value[i] === null ? '—' : money(Number(waste.value[i])), waste.pctOfSales[i] === null ? '—' : `${waste.pctOfSales[i]}%`]) }}
        >
          {waste && (
            <LineChart
              labels={waste.dates} ariaLabel={t('cWastage')} xText={shortDate} tipTitle={tipTitle}
              series={[{ key: wasteMode, name: wasteMode === 'value' ? t('valueRupees') : t('pctOfSales'), color: WASTAGE, values: ((wasteMode === 'value' ? waste.value : waste.pctOfSales) as Array<string | null>).map(num) }]}
              fmt={wasteMode === 'value' ? money : (n) => `${n.toFixed(2)}%`} axisFmt={wasteMode === 'value' ? moneyAxis : (n) => `${compact(n)}%`}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
}
