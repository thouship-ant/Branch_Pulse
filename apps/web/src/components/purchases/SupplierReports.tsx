'use client';

import { Select } from '@/components/Select';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { dec, formatINR } from '@/lib/money';
import { BarList, ChartCard } from '../charts';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { Chips, ErrorBox, Skeleton } from '../ui';
import { PaymentHistory } from './PaymentHistory';
import type { LocationOption } from './PurchaseForm';
import { PurchaseLedger } from './PurchaseLedger';

type Report = 'outstanding' | 'dues' | 'bySupplier' | 'purchases' | 'payments';
const day = (d: unknown) => String(d).slice(0, 10);
const money = (v: string | number | null | undefined) => (v === null || v === undefined ? '—' : formatINR(v, { decimals: false }));
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function download(name: string, lines: unknown[][]) {
  const blob = new Blob(['﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

/** The five supplier reports: outstanding, purchase history, payment history, due payments and supplier-wise purchases. */
export function SupplierReports({ locations }: { locations: LocationOption[] }) {
  const { t } = useT();
  const [report, setReport] = useState<Report>('outstanding');
  return (
    <div className="space-y-4">
      <Chips
        label={t('supplierReports')} value={report} onChange={setReport}
        options={[
          { value: 'outstanding', label: t('rOutstanding') }, { value: 'dues', label: t('rDues') }, { value: 'bySupplier', label: t('rBySupplier') },
          { value: 'purchases', label: t('rPurchaseHistory') }, { value: 'payments', label: t('rPaymentHistory') },
        ]}
      />
      {report === 'outstanding' && <Outstanding />}
      {report === 'dues' && <Dues />}
      {report === 'bySupplier' && <BySupplier locations={locations} />}
      {report === 'purchases' && <PurchaseLedger locations={locations} />}
      {report === 'payments' && <PaymentHistory />}
    </div>
  );
}

function Outstanding() {
  const { t } = useT();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get('/suppliers?owing=true').then((r) => setRows(r as any[])).catch((e) => setError(e.message)); }, []);
  if (!rows) return error ? <ErrorBox error={error} /> : <Skeleton className="h-48" />;
  const tot = (k: string) => rows.reduce((a, r) => a.plus(dec(r[k] ?? 0)), dec(0));
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn-secondary" onClick={() => download(`supplier-outstanding-${new Date().toISOString().slice(0, 10)}.csv`, [
          ['Supplier ID', 'Supplier', 'Contact number', 'Payment terms (days)', 'Opening balance', 'Total purchases', 'Total paid', 'Outstanding', 'Overdue', 'Next due', 'Last purchase'],
          ...rows.map((r) => [r.code, r.name, r.phone, r.paymentTermsDays, r.openingBalance, r.totalPurchases, r.totalPaid, r.outstanding, r.overdue, r.nextDue ? day(r.nextDue) : '', r.lastPurchaseOn ? day(r.lastPurchaseOn) : '']),
        ])}>⬇ {t('downloadCsv')}</button>
      </div>
      {rows.length === 0 ? <p className="card text-slate-600">{t('noOutstanding')}</p> : (
        <section className="card overflow-x-auto p-0" aria-label={t('rOutstanding')}>
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('supplier')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('openingBalance')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('totalPurchases')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('totalPaid')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('outstanding')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('overdueLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('nextDue')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="px-3 py-2 text-left font-medium"><Link className="hover:underline" href={`/purchases/suppliers/${r.id}`}>{r.name}</Link><p className="font-mono text-xs font-normal text-slate-500">{r.code}{r.phone ? ` · ${r.phone}` : ''}</p></th>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.openingBalance)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.totalPurchases)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.totalPaid)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(r.outstanding)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${dec(r.overdue).greaterThan(0) ? 'font-semibold text-red-700' : 'text-slate-400'}`}>{dec(r.overdue).greaterThan(0) ? `▼ ${money(r.overdue)}` : '—'}</td>
                  <td className="px-3 py-2">{r.nextDue ? prettyDate(day(r.nextDue)) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold">
              <tr>
                <td className="px-3 py-2">{t('totalRow')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot('openingBalance').toString())}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot('totalPurchases').toString())}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot('totalPaid').toString())}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatINR(tot('outstanding'))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot('overdue').toString())}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>
      )}
    </div>
  );
}

function Dues() {
  const { t } = useT();
  const [bucket, setBucket] = useState<'' | 'overdue' | 'due7' | 'later' | 'nodate'>('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get(`/suppliers/dues${bucket ? `?bucket=${bucket}` : ''}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [bucket]);
  if (!data) return error ? <ErrorBox error={error} /> : <Skeleton className="h-48" />;
  const s = data.summary;
  const bucketName: Record<string, string> = { overdue: t('bOverdue'), due7: t('bDue7'), later: t('bLater'), nodate: t('bNoDate') };
  const when = (r: any) => (r.daysOverdue === null ? '—' : r.daysOverdue > 0 ? t('daysLate', { n: r.daysOverdue }) : r.daysOverdue === 0 ? t('dueToday') : t('daysLeft', { n: -r.daysOverdue }));
  const Tile = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div className={`card ${tone ?? ''}`}><p className="text-sm text-slate-600">{label}</p><p className="text-xl font-bold tabular-nums">{value}</p></div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Chips label={t('rDues')} value={bucket} onChange={setBucket} options={[{ value: '', label: t('allTypes') }, { value: 'overdue', label: t('bOverdue') }, { value: 'due7', label: t('bDue7') }, { value: 'later', label: t('bLater') }, { value: 'nodate', label: t('bNoDate') }]} />
        <button className="btn-secondary" onClick={() => download(`supplier-dues-${day(data.asOf)}.csv`, [
          ['Supplier ID', 'Supplier', 'Purchase no.', 'Branch / warehouse', 'Purchase date', 'Due date', 'Days late (negative = days left)', 'Bucket', 'Total', 'Paid', 'Still to pay'],
          ...(data.rows as any[]).map((r) => [r.supplierCode, r.supplierName, r.code, r.locationName, day(r.businessDate), r.dueDate ? day(r.dueDate) : '', r.daysOverdue ?? '', bucketName[r.bucket], r.totalAmount, r.paidAmount, r.creditAmount]),
          [], ['Supplier', 'Overdue', 'Due in 7 days', 'Later', 'No due date', 'On account', 'Total'],
          ...(data.suppliers as any[]).map((r) => [r.name, r.overdue, r.due7, r.later, r.noDate, r.onAccount, r.total]),
        ])}>⬇ {t('downloadCsv')}</button>
      </div>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Summary">
        <Tile label={t('bOverdue')} value={`${dec(s.overdue).greaterThan(0) ? '▼ ' : ''}${money(s.overdue)}`} tone={dec(s.overdue).greaterThan(0) ? 'border-red-300' : ''} />
        <Tile label={t('bDue7')} value={money(s.due7)} tone={dec(s.due7).greaterThan(0) ? 'border-amber-300' : ''} />
        <Tile label={t('bLater')} value={money(s.later)} />
        <Tile label={t('onAccount')} value={money(s.onAccount)} />
        <Tile label={t('totalOwed')} value={money(s.total)} />
      </section>
      {dec(s.onAccount).greaterThan(0) && <p className="text-xs text-slate-500">{t('onAccount')}: {t('onAccountHint')}</p>}

      {data.suppliers.length > 0 && (
        <ChartCard
          title={t('rDues')} empty={false}
          table={{ head: [t('supplier'), t('bOverdue'), t('bDue7'), t('bLater'), t('onAccount'), t('total')], rows: (data.suppliers as any[]).map((r) => [r.name, money(r.overdue), money(r.due7), money(r.later), money(r.onAccount), money(r.total)]) }}
        >
          <BarList ariaLabel={t('rDues')} fmt={money} rows={(data.suppliers as any[]).map((r) => ({ key: r.supplierId, label: r.name, value: Number(r.total), detail: `${t('bOverdue')} ${money(r.overdue)} · ${t('bDue7')} ${money(r.due7)} · ${t('bLater')} ${money(r.later)}` }))} color="var(--series-3)" />
        </ChartCard>
      )}

      <section className="card overflow-x-auto p-0" aria-label={t('rDues')}>
        {data.rows.length === 0 ? <p className="p-4 text-slate-600">{t('noOutstanding')}</p> : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('dueDate')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('supplier')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('purchaseRef')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('atLocation')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('purchaseTotal')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('creditLeft')}</th>
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              {(data.rows as any[]).map((r) => (
                <tr key={r.purchaseId}>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.dueDate ? prettyDate(day(r.dueDate)) : '—'}
                    <p className={`text-xs ${r.bucket === 'overdue' ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{r.bucket === 'overdue' ? '▼ ' : ''}{when(r)}</p>
                  </td>
                  <td className="px-3 py-2"><Link className="hover:underline" href={`/purchases/suppliers/${r.supplierId}`}>{r.supplierName}</Link></td>
                  <td className="px-3 py-2">{r.code}{r.supplierRefNo && <p className="text-xs text-slate-500">{r.supplierRefNo}</p>}<p className="text-xs text-slate-500">{prettyDate(day(r.businessDate))}</p></td>
                  <td className="px-3 py-2">{r.locationName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.totalAmount)}<p className="text-xs text-slate-500">{t('paidLabel')} {money(r.paidAmount)}</p></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(r.creditAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function BySupplier({ locations }: { locations: LocationOption[] }) {
  const { t, pick } = useT();
  const period = usePeriod('30');
  const { range, valid } = period;
  const [branchId, setBranchId] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!valid) return;
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    if (branchId) qs.set('locationId', branchId);
    api.get(`/purchases/summary?${qs}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [range.from, range.to, branchId, valid]);
  const rows: any[] = data?.suppliers ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker period={period} label={t('rBySupplier')} />
          <div className="min-w-[200px]">
            <label htmlFor="rbs" className="label">{t('atLocation')}</label>
            <Select id="rbs" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </Select>
          </div>
        </div>
        <button className="btn-secondary" disabled={!data} onClick={() => download(`supplier-wise-purchases-${range.from}_${range.to}.csv`, [
          ['Supplier ID', 'Supplier', 'Purchases', 'Total', 'Paid', 'On credit', 'Share %'], ...rows.map((r) => [r.code, r.name, r.count, r.amount, r.paid, r.credit, r.sharePct]),
        ])}>⬇ {t('downloadCsv')}</button>
      </div>
      <ErrorBox error={error} />
      {!data ? <Skeleton className="h-48" /> : (
        <>
          <ChartCard
            title={t('rBySupplier')} subtitle={t('includesPending')} empty={rows.length === 0}
            table={{ head: [t('supplier'), t('entries'), t('total'), t('paidLabel'), t('creditLeft'), '%'], rows: rows.map((r) => [r.name, r.count, money(r.amount), money(r.paid), money(r.credit), r.sharePct === null ? '—' : `${r.sharePct}%`]) }}
          >
            <BarList ariaLabel={t('rBySupplier')} fmt={money} color="var(--series-3)" rows={rows.map((r) => ({ key: r.supplierId, label: r.name, value: Number(r.amount), detail: `${r.count} ${t('entries')} · ${t('creditLeft')} ${money(r.credit)}` }))} />
          </ChartCard>
          {rows.length > 0 && (
            <section className="card overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">{t('supplier')}</th>
                    <th scope="col" className="px-3 py-2 text-right capitalize">{t('entries')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('total')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('paidLabel')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{t('creditLeft')}</th>
                    <th scope="col" className="px-3 py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.supplierId}>
                      <th scope="row" className="px-3 py-2 text-left font-medium"><Link className="hover:underline" href={`/purchases/suppliers/${r.supplierId}`}>{r.name}</Link></th>
                      <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(r.amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.paid)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.credit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.sharePct === null ? '—' : `${r.sharePct}%`}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold">
                  <tr><td className="px-3 py-2">{t('totalRow')}</td><td className="px-3 py-2 text-right tabular-nums">{data.totals.count}</td><td className="px-3 py-2 text-right tabular-nums">{formatINR(data.totals.total)}</td><td className="px-3 py-2 text-right tabular-nums">{formatINR(data.totals.paid)}</td><td className="px-3 py-2 text-right tabular-nums">{formatINR(data.totals.credit)}</td><td /></tr>
                </tfoot>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
