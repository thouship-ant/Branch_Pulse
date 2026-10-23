'use client';

import { Select } from '@/components/Select';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { MODE_KEY } from '@/lib/labels';
import { formatINR } from '@/lib/money';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { ErrorBox, Skeleton } from '../ui';

const PAGE = 25;
const day = (d: unknown) => String(d).slice(0, 10);
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every payment made to suppliers: date, supplier, paid from, purchase settled, mode, reference, who paid. Reversed ones stay visible. */
export function PaymentHistory({ fixedSupplierId, refreshKey = 0 }: { fixedSupplierId?: string; refreshKey?: number }) {
  const { t } = useT();
  const period = usePeriod('90');
  const { range, valid } = period;
  const [supplierId, setSupplierId] = useState(fixedSupplierId ?? '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [rows, setRows] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; totalAmount: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!fixedSupplierId) api.get('/suppliers').then((s) => setSuppliers(s as any[])).catch(() => undefined); }, [fixedSupplierId]);
  useEffect(() => { setPage(1); }, [range.from, range.to, supplierId, status]);

  const qs = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ from: range.from, to: range.to, ...extra });
    if (supplierId) p.set('supplierId', supplierId);
    if (status) p.set('status', status);
    return p;
  }, [range.from, range.to, supplierId, status]);

  const load = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const { data, meta: m } = await api.full.get(`/suppliers/payments?${qs({ page: String(page), pageSize: String(PAGE) })}`);
      setRows(data); setMeta({ total: Number(m?.total ?? 0), totalAmount: String(m?.totalAmount ?? '0') }); setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [qs, page, valid]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function downloadCsv() {
    try {
      const all: any[] = [];
      for (let p = 1; p <= 30; p++) {
        const { data, meta: m } = await api.full.get(`/suppliers/payments?${qs({ page: String(p), pageSize: '100' })}`);
        all.push(...data);
        if (all.length >= Number(m?.total ?? 0) || data.length === 0) break;
      }
      const head = ['Date', 'Payment no.', 'Supplier ID', 'Supplier', 'Paid from', 'Purchase settled', 'Payment mode', 'Reference', 'Amount', 'Paid by', 'Status', 'Remarks'];
      const lines: unknown[][] = [head, ...all.map((p) => [day(p.businessDate), p.code, p.supplierCode, p.supplierName, p.locationName, p.purchaseCode, p.paymentMode, p.referenceNo, p.amount, p.paidByName, p.status, p.remarks])];
      const blob = new Blob(['﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `supplier-payments-${range.from}_${range.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e: any) { setError(e.message); }
  }

  const pages = meta ? Math.max(1, Math.ceil(meta.total / PAGE)) : 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker period={period} label={t('rPaymentHistory')} />
        <button className="btn-secondary" disabled={!rows} onClick={downloadCsv}>⬇ {t('downloadCsv')}</button>
      </div>
      <div className="flex flex-wrap gap-3">
        {!fixedSupplierId && (
          <div className="min-w-[220px]">
            <label htmlFor="phs" className="label">{t('supplier')}</label>
            <Select id="phs" className="field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('allSuppliers')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
        )}
        <div className="min-w-[180px]">
          <label htmlFor="phst" className="label">{t('status')}</label>
          <Select id="phst" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            <option value="ACTIVE">{t('active')}</option>
            <option value="REVERSED">{t('reversedLabel')}</option>
          </Select>
        </div>
      </div>
      {!valid && <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {t('invalidRange')}</p>}
      <ErrorBox error={error} />
      {!rows ? <Skeleton className="h-48" /> : (
        <section className={`card overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-50' : ''}`} aria-label={t('rPaymentHistory')}>
          {rows.length === 0 ? <p className="p-4 text-slate-600">{t('noPayments')}</p> : (
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{t('dateLabel')}</th>
                  {!fixedSupplierId && <th scope="col" className="px-3 py-2 text-left">{t('supplier')}</th>}
                  <th scope="col" className="px-3 py-2 text-left">{t('payFrom')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('purchaseRef')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('paymentMode')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('amount')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('paidByLabel')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y align-top">
                {rows.map((p) => (
                  <tr key={p.id} className={p.status !== 'ACTIVE' ? 'text-slate-400' : ''}>
                    <td className="px-3 py-2">{prettyDate(day(p.businessDate))}<p className="font-mono text-xs text-slate-500">{p.code}</p></td>
                    {!fixedSupplierId && <td className="px-3 py-2">{p.supplierName}</td>}
                    <td className="px-3 py-2">{p.locationName}<p className="font-mono text-xs text-slate-500">{p.locationCode}</p></td>
                    <td className="px-3 py-2">{p.purchaseCode ?? <span className="text-xs text-slate-500">{t('onAccount')}</span>}</td>
                    <td className="px-3 py-2">{MODE_KEY[p.paymentMode] ? t(MODE_KEY[p.paymentMode]) : p.paymentMode}{p.referenceNo && <p className="text-xs text-slate-500">{p.referenceNo}</p>}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${p.status !== 'ACTIVE' ? 'line-through' : ''}`}>{formatINR(p.amount)}</td>
                    <td className="px-3 py-2">{p.paidByName ?? '—'}</td>
                    <td className="px-3 py-2">{p.status === 'ACTIVE' ? <span className="chip border-emerald-300 bg-emerald-50 text-emerald-800">✓ {t('paidLabel')}</span> : <span className="chip border-slate-300 bg-slate-100 text-slate-600">↺ {t('reversedLabel')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {meta && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p>{t('showing')} {rows?.length ?? 0} {t('of')} {meta.total} · <b className="tabular-nums text-ink">{t('total')}: {formatINR(meta.totalAmount)}</b></p>
          <div className="flex items-center gap-2">
            <button className="btn-secondary min-h-[36px] px-3" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← {t('prevPage')}</button>
            <span className="tabular-nums">{page} / {pages}</span>
            <button className="btn-secondary min-h-[36px] px-3" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('nextPage')} →</button>
          </div>
        </div>
      )}
    </div>
  );
}
