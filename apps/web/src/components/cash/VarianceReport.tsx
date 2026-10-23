'use client';

import { Select } from '@/components/Select';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { REASON_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { BarList, ChartCard } from '../charts';
import { Icon, type IconName } from '../Icon';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { Chips, ErrorBox, Skeleton } from '../ui';
import { VarianceChip } from './parts';

const money = (v: string | number) => formatINR(v, { decimals: false });
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

type TypeFilter = 'all' | 'shortage' | 'surplus';

/**
 * Cash Variance Report: every day whose counted cash did not match expected cash, with reason, explanation,
 * approval and photos, plus a per-branch summary. The owner sees all branches; a manager only their own.
 */
export function VarianceReport({ fixedLocationId, linkRows = false }: { fixedLocationId?: string; linkRows?: boolean }) {
  const { t, pick } = useT();
  const period = usePeriod('30');
  const { range, valid } = period;
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState(fixedLocationId ?? '');
  const [branches, setBranches] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fixedLocationId) return;
    api.get('/locations?type=BRANCH').then((b) => setBranches(b as any[])).catch(() => undefined);
  }, [fixedLocationId]);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ from: range.from, to: range.to, type });
    if (status) qs.set('status', status);
    if (branchId) qs.set('locationId', branchId);
    api.get(`/cash/variance-report?${qs}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [range.from, range.to, type, status, branchId, valid]);

  const s = data?.summary;
  const rows: any[] = data?.rows ?? [];
  const byBranch: any[] = (data?.byBranch ?? []).filter((b: any) => b.daysReconciled > 0);

  function downloadCsv() {
    const head = ['Date', 'Branch ID', 'Branch', 'Expected cash', 'Actual cash', 'Difference', 'Result', 'Reason', 'Manager explanation', 'Approval status', 'Approved by', 'Photos'];
    const lines = [
      ['Cash variance report', `${data.from} to ${data.to}`], [], head,
      ...rows.map((r) => [r.businessDate, r.code, r.name, r.expectedClosing, r.actualClosing, r.variance, r.varianceLabel, r.reason, r.managerExplanation, r.approvalStatus, r.approvedBy, r.photoCount]),
      [], ['Branch ID', 'Branch', 'Days counted', 'Cash sales', 'Net difference', 'Shortage days', 'Surplus days', 'Largest shortage'],
      ...(data.byBranch as any[]).map((b) => [b.code, b.name, b.daysReconciled, b.cashSales, b.netVariance, b.shortageDays, b.surplusDays, b.largestShortage]),
    ];
    const blob = new Blob(['﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cash-variance-${data.from}_${data.to}.csv`;
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
        <PeriodPicker period={period} label={t('varianceReport')} />
        <button className="btn-secondary" disabled={!data} onClick={downloadCsv}>⬇ {t('downloadCsv')}</button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        {!fixedLocationId && (
          <div className="min-w-[200px]">
            <label htmlFor="vb" className="label">{t('branch')}</label>
            <Select id="vb" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {pick(b.name, b.nameTa)}</option>)}
            </Select>
          </div>
        )}
        <Chips
          label={t('showLabel')} value={type} onChange={setType}
          options={[{ value: 'all', label: t('allTypes') }, { value: 'shortage', label: t('shortage') }, { value: 'surplus', label: t('surplus') }]}
        />
        <div className="min-w-[180px]">
          <label htmlFor="vs" className="label">{t('status')}</label>
          <Select id="vs" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            <option value="DRAFT">{t('vsDraft')}</option>
            <option value="SUBMITTED">{t('vsSent')}</option>
            <option value="APPROVED">{t('approved')}</option>
            <option value="REJECTED">{t('rejected')}</option>
          </Select>
        </div>
      </div>
      {!valid && <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {t('invalidRange')}</p>}
      <ErrorBox error={error} />

      {!data ? <Skeleton className="h-64" /> : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile icon="alert" bad={s.shortageCount > 0} label={t('shortageTotal')} value={money(dec(s.shortageTotal).abs().toString())} sub={`${s.shortageCount} ${t('daysLabel')}`} />
            <Tile icon="trend" label={t('surplusTotal')} value={money(s.surplusTotal)} sub={`${s.surplusCount} ${t('daysLabel')}`} />
            <Tile icon="wallet" bad={dec(s.net).isNegative()} label={t('netVariance')} value={`${dec(s.net).isNegative() ? '▼ ' : dec(s.net).isZero() ? '' : '▲ '}${money(dec(s.net).abs().toString())}`} />
            <Tile icon="clock" bad={s.byStatus.submitted > 0} label={t('awaiting')} value={String(s.byStatus.submitted)} sub={`${t('vsDraft')} ${s.byStatus.draft} · ${t('approved')} ${s.byStatus.approved} · ${t('rejected')} ${s.byStatus.rejected}`} />
          </section>

          {byBranch.length > 1 && (
            <ChartCard
              title={`${t('netVariance')} · ${t('branch')}`} loading={loading} empty={byBranch.every((b) => dec(b.netVariance).isZero())} emptyText={t('tallied')}
              table={{ head: [t('branch'), t('daysCounted'), t('cash'), t('netVariance'), t('shortage'), t('surplus')], rows: byBranch.map((b) => [`${b.code} · ${pick(b.name, b.nameTa)}`, b.daysReconciled, money(b.cashSales), money(b.netVariance), b.shortageDays, b.surplusDays]) }}
            >
              <BarList
                ariaLabel={t('netVariance')} diverging color="var(--series-1)" fmt={(n) => money(n)}
                rows={byBranch.map((b) => ({ key: b.locationId, label: pick(b.name, b.nameTa), value: Number(b.netVariance), detail: `${b.daysReconciled} ${t('daysCounted')} · ${b.shortageDays} ${t('shortage')} · ${b.surplusDays} ${t('surplus')}` }))}
              />
            </ChartCard>
          )}

          <section className="card overflow-x-auto p-0" aria-label={t('varianceReport')}>
            {rows.length === 0 ? <p className="p-4 text-slate-600">{t('noData')}</p> : (
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">{t('dateLabel')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('branch')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('expectedCash')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('actualCash')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('variance')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('reason')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('explanation')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{t('approvedBy')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y align-top">
                  {rows.map((r) => {
                    const neg = dec(r.variance).isNegative();
                    const d = String(r.businessDate).slice(0, 10);
                    return (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap px-3 py-2">{linkRows ? <Link className="hover:underline" href={`/cash/${r.locationId}/${d}`}>{prettyDate(d)}</Link> : prettyDate(d)}</td>
                        <td className="px-3 py-2">{pick(r.name, r.nameTa)}<p className="font-mono text-xs text-slate-500">{r.code}</p></td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.expectedClosing, { decimals: false })}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.actualClosing)}</td>
                        <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${neg ? 'text-red-700' : ''}`}>{neg ? '▼' : '▲'} {formatINR(dec(r.variance).abs())}<p className="text-xs font-normal text-slate-500">{neg ? t('shortage') : t('surplus')}</p></td>
                        <td className="px-3 py-2">{r.reason && REASON_KEY[r.reason] ? t(REASON_KEY[r.reason]) : r.reason ?? '—'}</td>
                        <td className="max-w-[260px] whitespace-pre-wrap px-3 py-2">{r.managerExplanation ?? '—'}{r.photoCount > 0 && <span className="ml-1 text-xs text-slate-500">🖼 {r.photoCount}</span>}</td>
                        <td className="px-3 py-2"><VarianceChip status={r.approvalStatus} /></td>
                        <td className="px-3 py-2">{r.approvedBy ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
