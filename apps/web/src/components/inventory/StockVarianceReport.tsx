'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { COUNT_REASON_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { BarList, ChartCard } from '../charts';
import { Icon, type IconName } from '../Icon';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import type { LocationOption } from '../purchases/PurchaseForm';
import { Chips, ErrorBox, Skeleton } from '../ui';
import { VarianceBadge } from './Reconciliation';
import { toDisplay } from './qty';

const PAGE = 25;
const money = (v: string | number) => formatINR(v, { decimals: false });
const day = (d: unknown) => String(d).slice(0, 10);
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Stock variance report: every counted shortage and excess with its reason and who counted it, plus wastage, by item and branch. */
export function StockVarianceReport({ locations, fixedLocationId }: { locations: LocationOption[]; fixedLocationId?: string }) {
  const { t, pick } = useT();
  const period = usePeriod('30');
  const { range, valid } = period;
  const [type, setType] = useState<'all' | 'shortage' | 'excess'>('all');
  const [branchId, setBranchId] = useState(fixedLocationId ?? '');
  const [data, setData] = useState<any>(null);
  const [factors, setFactors] = useState<Record<string, { f: string; u: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [range.from, range.to, type, branchId]);
  useEffect(() => {
    api.get('/items?includeInactive=true').then((items) => setFactors(Object.fromEntries((items as any[]).map((i) => [i.id, { f: String(i.displayFactor), u: i.displayUnit }])))).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!valid) return;
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams({ from: range.from, to: range.to, type });
    if (branchId) p.set('locationId', branchId);
    api.get(`/stock/variance-report?${p}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [range.from, range.to, type, branchId, valid]);

  const q = (r: any, base: string) => { const x = factors[r.itemId]; return x ? `${toDisplay(base, x.f)} ${x.u}` : `${base} ${r.unit}`; };
  const s = data?.summary;
  const rows: any[] = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);

  function csv() {
    const head = ['Date', 'Branch ID', 'Branch', 'Item ID', 'Item', 'Expected', 'Counted', 'Variance', 'Result', 'Variance value', 'Reason', 'Explanation', 'Counted by', 'Approved by', 'Status'];
    const lines: unknown[][] = [['Stock variance report', `${data.from} to ${data.to}`], [], head,
      ...rows.map((r) => [day(r.businessDate), r.locationCode, r.locationName, r.itemCode, r.itemName, q(r, r.expected), q(r, r.physical), q(r, r.variance), r.label, r.varianceValue, r.reason, r.explanation, r.countedBy, r.approvedBy, r.status]),
      [], ['Shortage value', s.shortageValue], ['Excess value', s.excessValue], ['Net', s.net], ['Wastage value', s.wastageValue]];
    const blob = new Blob(['﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `stock-variance-${data.from}_${data.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const Tile = ({ icon, label, value, sub, tone }: { icon: IconName; label: string; value: string; sub?: string; tone?: 'bad' | 'warn' }) => (
    <div className={`card flex items-center gap-3 ${tone === 'bad' ? 'border-red-300' : tone === 'warn' ? 'border-amber-300' : ''}`}>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tone === 'bad' ? 'bg-red-50 text-red-800' : 'bg-brand-light text-brand-dark'}`}><Icon name={icon} size={22} /></span>
      <div className="min-w-0"><p className="text-sm leading-tight text-slate-600">{label}</p><p className="text-xl font-bold tabular-nums">{value}</p>{sub && <p className="text-xs text-slate-600">{sub}</p>}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker period={period} label={t('stockVarianceReport')} />
        <button className="btn-secondary" disabled={!data} onClick={csv}>⬇ {t('downloadCsv')}</button>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {!fixedLocationId && (
          <div className="min-w-[200px]">
            <label htmlFor="svb" className="label">{t('atLocation')}</label>
            <select id="svb" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </select>
          </div>
        )}
        <Chips label={t('showLabel')} value={type} onChange={setType} options={[{ value: 'all', label: t('allTypes') }, { value: 'shortage', label: t('shortage') }, { value: 'excess', label: t('excess') }]} />
      </div>
      {!valid && <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {t('invalidRange')}</p>}
      <ErrorBox error={error} />

      {!data ? <Skeleton className="h-64" /> : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
            <Tile icon="alert" tone={s.shortageCount > 0 ? 'bad' : undefined} label={`▼ ${t('stkShortage')}`} value={money(s.shortageValue)} sub={`${s.shortageCount} ${t('entries')}`} />
            <Tile icon="trend" tone={s.excessCount > 0 ? 'warn' : undefined} label={`▲ ${t('stkExcess')}`} value={money(s.excessValue)} sub={`${s.excessCount} ${t('entries')}`} />
            <Tile icon="box" tone={dec(s.net).isNegative() ? 'bad' : undefined} label={t('stkNet')} value={`${dec(s.net).isNegative() ? '▼ ' : dec(s.net).isZero() ? '' : '▲ '}${money(dec(s.net).abs().toString())}`} />
            <Tile icon="bag" label={t('stkWastage')} value={money(s.wastageValue)} sub={`${s.byStatus.submitted} ${t('countSent')}`} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title={`${t('stkNet')} · ${t('byItemLabel')}`} loading={loading} empty={data.byItem.length === 0} emptyText={t('noVariances')}
              table={{ head: [t('itemLabel'), t('stkShortage'), t('stkExcess'), t('stkNet')], rows: (data.byItem as any[]).map((r) => [pick(r.name, r.nameTa), money(r.shortageValue), money(r.excessValue), money(r.net)]) }}
            >
              <BarList ariaLabel={t('byItemLabel')} diverging color="var(--series-1)" fmt={money}
                rows={(data.byItem as any[]).map((r) => ({ key: r.id, label: pick(r.name, r.nameTa), value: Number(r.net), detail: `${t('shortage')} ${money(r.shortageValue)} · ${t('excess')} ${money(r.excessValue)}` }))} />
            </ChartCard>
            <ChartCard
              title={`${t('stkWastage')} · ${t('byItemLabel')}`} loading={loading} empty={data.wastageByItem.length === 0} emptyText={t('noWastage')}
              table={{ head: [t('itemLabel'), t('total')], rows: (data.wastageByItem as any[]).map((r) => [pick(r.name, r.nameTa), money(r.value)]) }}
            >
              <BarList ariaLabel={t('stkWastage')} color="var(--series-6)" fmt={money} rows={(data.wastageByItem as any[]).map((r) => ({ key: r.itemId, label: pick(r.name, r.nameTa), value: Number(r.value) }))} />
            </ChartCard>
          </div>
          {!fixedLocationId && data.byLocation.length > 1 && (
            <ChartCard
              title={`${t('stkNet')} · ${t('byBranchLabel')}`} loading={loading} empty={false}
              table={{ head: [t('branch'), t('stkShortage'), t('stkExcess'), t('stkNet')], rows: (data.byLocation as any[]).map((r) => [pick(r.name, r.nameTa), money(r.shortageValue), money(r.excessValue), money(r.net)]) }}
            >
              <BarList ariaLabel={t('byBranchLabel')} diverging color="var(--series-1)" fmt={money} rows={(data.byLocation as any[]).map((r) => ({ key: r.id, label: pick(r.name, r.nameTa), value: Number(r.net), detail: `${r.count} ${t('entries')}` }))} />
            </ChartCard>
          )}

          <section className="card overflow-x-auto p-0" aria-label={t('stockVarianceReport')}>
            {rows.length === 0 ? <p className="p-4 text-slate-600">{t('noVariances')}</p> : (
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">{t('dateLabel')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('atLocation')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('itemLabel')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('colExpected')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('colActual')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('colVariance')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('reasonLabel2')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('countedBy')} / {t('approvedBy')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y align-top">
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-3 py-2">{prettyDate(day(r.businessDate))}</td>
                      <td className="px-3 py-2">{pick(r.locationName, r.locationNameTa)}</td>
                      <td className="px-3 py-2">{pick(r.itemName, r.itemNameTa)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{q(r, r.expected)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{q(r, r.physical)}</td>
                      <td className="px-3 py-2"><VarianceBadge variance={r.variance} /><p className={`mt-1 whitespace-nowrap text-xs tabular-nums ${dec(r.variance).isNegative() ? 'text-red-700' : 'text-amber-800'}`}>{dec(r.variance).isNegative() ? '−' : '+'}{q(r, dec(r.variance).abs().toString())} · {formatINR(dec(r.varianceValue).abs())}</p></td>
                      <td className="max-w-[260px] px-3 py-2">{r.reason ? t(COUNT_REASON_KEY[r.reason] ?? 'crOther') : '—'}{r.explanation && <p className="whitespace-pre-wrap text-xs text-slate-500">“{r.explanation}”</p>}</td>
                      <td className="px-3 py-2"><p>{r.countedBy ?? '—'}</p><p className="text-xs text-slate-500">{r.approvedBy ?? '—'}{r.status === 'SUBMITTED' ? ` · ${t('countSent')}` : ''}</p></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          {rows.length > PAGE && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <p>{t('showing')} {shown.length} {t('of')} {rows.length}</p>
              <div className="flex items-center gap-2">
                <button className="btn-secondary min-h-[36px] px-3" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← {t('prevPage')}</button>
                <span className="tabular-nums">{page} / {pages}</span>
                <button className="btn-secondary min-h-[36px] px-3" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('nextPage')} →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
