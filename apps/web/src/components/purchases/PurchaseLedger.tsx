'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { MODE_KEY, STATUS_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { ErrorBox, Sheet, Skeleton, StatusPill } from '../ui';
import type { LocationOption } from './PurchaseForm';

const PAGE = 25;
const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT'];
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const day = (d: unknown) => String(d).slice(0, 10);

/** Every purchase with its items, payment split, due date, invoice, and who entered / approved it. Approve, reject, reverse from here. */
export function PurchaseLedger({ locations, fixedLocationId, fixedSupplierId, initialStatus = '', refreshKey = 0, onChanged }: {
  locations: LocationOption[]; fixedLocationId?: string; fixedSupplierId?: string; initialStatus?: string; refreshKey?: number; onChanged?: () => void;
}) {
  const { t, pick } = useT();
  const { can } = useSession();
  const period = usePeriod('30');
  const { range, valid } = period;
  const [branchId, setBranchId] = useState(fixedLocationId ?? '');
  const [supplierId, setSupplierId] = useState(fixedSupplierId ?? '');
  const [status, setStatus] = useState(initialStatus);
  const [settlement, setSettlement] = useState('');
  const [mode, setMode] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [rows, setRows] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; totalAmount: string; totalPaid: string; totalCredit: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [action, setAction] = useState<'reject' | 'reverse' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (!fixedSupplierId) api.get('/suppliers').then((s) => setSuppliers(s as any[])).catch(() => undefined); }, [fixedSupplierId]);
  useEffect(() => { const h = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 350); return () => clearTimeout(h); }, [q]);
  useEffect(() => { setPage(1); }, [range.from, range.to, branchId, supplierId, status, settlement, mode]);

  const qs = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ from: range.from, to: range.to, ...extra });
    if (branchId) p.set('locationId', branchId);
    if (supplierId) p.set('supplierId', supplierId);
    if (status) p.set('status', status);
    if (settlement) p.set('settlement', settlement);
    if (mode) p.set('paymentMode', mode);
    if (query) p.set('q', query);
    return p;
  }, [range.from, range.to, branchId, supplierId, status, settlement, mode, query]);

  const load = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const { data, meta: m } = await api.full.get(`/purchases?${qs({ page: String(page), pageSize: String(PAGE) })}`);
      setRows(data);
      setMeta({ total: Number(m?.total ?? 0), totalAmount: String(m?.totalAmount ?? '0'), totalPaid: String(m?.totalPaid ?? '0'), totalCredit: String(m?.totalCredit ?? '0') });
      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [qs, page, valid]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function open(id: string) {
    try { setDetail(await api.get(`/purchases/${id}`)); } catch (e: any) { setError(e.message); }
  }
  async function run(kind: 'approve' | 'reject' | 'reverse' | 'cancel') {
    if (!detail) return;
    setBusy(kind);
    try {
      await api.post(`/purchases/${detail.id}/${kind}`, kind === 'approve' ? undefined : { reason: reason || undefined });
      setAction(null); setReason(''); setDetail(null);
      await load(); onChanged?.();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); setAction(null); }
    finally { setBusy(null); }
  }
  async function viewReceipt(id: string) {
    try { const { url } = await api.get(`/attachments/${id}/url`); window.open(url, '_blank', 'noopener'); } catch (e: any) { setError(e.message); }
  }

  async function downloadCsv() {
    setBusy('csv');
    try {
      const all: any[] = [];
      for (let p = 1; p <= 30; p++) {
        const { data, meta: m } = await api.full.get(`/purchases?${qs({ page: String(p), pageSize: '100' })}`);
        all.push(...data);
        if (all.length >= Number(m?.total ?? 0) || data.length === 0) break;
      }
      const head = ['Date', 'Purchase no.', 'Branch ID', 'Branch / warehouse', 'Supplier', 'Invoice no.', 'Item', 'Quantity', 'Unit', 'Rate', 'Line amount', 'Other charges', 'Discount', 'Total', 'Payment mode', 'Paid', 'Credit', 'Due date', 'Entered by', 'Approved by', 'Approval status', 'Remarks'];
      const lines: unknown[][] = [head];
      for (const p of all) {
        for (const [i, it] of (p.items as any[]).entries()) {
          lines.push([day(p.businessDate), p.code, p.locationCode, p.locationName, p.supplierName, p.supplierRefNo, it.itemName, it.quantity, it.unitCode, it.rate, it.lineTotal,
            i === 0 ? p.otherCharges : '', i === 0 ? p.discount : '', i === 0 ? p.totalAmount : '', p.paymentMode, i === 0 ? p.paidAmount : '', i === 0 ? p.creditAmount : '',
            p.dueDate ? day(p.dueDate) : '', p.enteredByName, p.approvedByName, p.status !== 'ACTIVE' ? p.status : p.approvalStatus, p.remarks]);
        }
      }
      const blob = new Blob(['﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `purchases-${range.from}_${range.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  const pages = meta ? Math.max(1, Math.ceil(meta.total / PAGE)) : 1;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker period={period} label={t('purchases')} />
        <button className="btn-secondary" disabled={!rows || busy === 'csv'} onClick={downloadCsv}>⬇ {t('downloadCsv')}</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {!fixedLocationId && (
          <div>
            <label htmlFor="ll" className="label">{t('atLocation')}</label>
            <select id="ll" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </select>
          </div>
        )}
        {!fixedSupplierId && (
          <div>
            <label htmlFor="lsp" className="label">{t('supplier')}</label>
            <select id="lsp" className="field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('allTypes')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="lst" className="label">{t('approvalStatus')}</label>
          <select id="lst" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            {['SUBMITTED', 'APPROVED', 'REJECTED'].map((s) => <option key={s} value={s}>{t(STATUS_KEY[s])}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lse" className="label">{t('settlement')}</label>
          <select id="lse" className="field" value={settlement} onChange={(e) => setSettlement(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            <option value="open">{t('settleOpen')}</option>
            <option value="settled">{t('settleDone')}</option>
          </select>
        </div>
        <div>
          <label htmlFor="lm2" className="label">{t('paymentMode')}</label>
          <select id="lm2" className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">{t('allModes')}</option>
            {MODES.map((m) => <option key={m} value={m}>{MODE_KEY[m] ? t(MODE_KEY[m]) : m}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lq2" className="label">{t('search')}</label>
          <input id="lq2" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('invoiceNo')} / ${t('remarks2')}`} />
        </div>
      </div>
      {!valid && <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {t('invalidRange')}</p>}
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-64" /> : (
        <section className={`card overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-50' : ''}`} aria-label={t('purchases')}>
          {rows.length === 0 ? <p className="p-4 text-slate-600">{t('noPurchases')}</p> : (
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{t('dateLabel')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('atLocation')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('supplier')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('itemsLabel')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('purchaseTotal')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('paidLabel')} / {t('creditLeft')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('dueDate')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('enteredBy')} / {t('approvedBy')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('approvalStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y align-top">
                {rows.map((p) => {
                  const st = p.status !== 'ACTIVE' ? p.status : p.approvalStatus;
                  const overdue = p.approvalStatus === 'APPROVED' && p.status === 'ACTIVE' && dec(p.creditAmount).greaterThan(0) && p.dueDate && day(p.dueDate) < today;
                  return (
                    <tr key={p.id} className={`cursor-pointer hover:bg-slate-50 ${p.status !== 'ACTIVE' ? 'text-slate-500' : ''}`} onClick={() => open(p.id)}>
                      <td className="px-3 py-2">{prettyDate(day(p.businessDate))}<p className="font-mono text-xs text-slate-500">{p.code}</p></td>
                      <td className="px-3 py-2">{pick(p.locationName, p.locationNameTa)}<p className="font-mono text-xs text-slate-500">{p.locationCode}</p></td>
                      <td className="px-3 py-2">{p.supplierName}{p.supplierRefNo && <p className="text-xs text-slate-500">{p.supplierRefNo}</p>}</td>
                      <td className="max-w-[220px] px-3 py-2">
                        {(p.items as any[]).slice(0, 2).map((i) => <p key={i.id} className="truncate">{pick(i.itemName, i.itemNameTa)} <span className="text-slate-500">{dec(i.quantity).toString()} {i.unitCode}</span></p>)}
                        {p.items.length > 2 && <p className="text-xs text-slate-500">+{p.items.length - 2}</p>}
                        {p.receiptCount > 0 && <span className="text-xs text-slate-500">🧾 {p.receiptCount}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formatINR(p.totalAmount)}<p className="text-xs font-normal text-slate-500">{MODE_KEY[p.paymentMode] ? t(MODE_KEY[p.paymentMode]) : p.paymentMode}</p></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatINR(p.paidAmount)}{dec(p.creditAmount).greaterThan(0) && <p className={`text-xs ${overdue ? 'font-semibold text-red-700' : 'text-amber-800'}`}>{overdue ? '▼ ' : ''}{formatINR(p.creditAmount)} {t('creditLeft')}</p>}</td>
                      <td className="whitespace-nowrap px-3 py-2">{p.dueDate ? <span className={overdue ? 'font-semibold text-red-700' : ''}>{overdue ? '▼ ' : ''}{prettyDate(day(p.dueDate))}</span> : '—'}</td>
                      <td className="px-3 py-2"><p><span className="text-xs text-slate-500">{t('enteredBy')}:</span> {p.enteredByName ?? '—'}</p><p><span className="text-xs text-slate-500">{t('approvedBy')}:</span> {p.approvedByName ?? '—'}</p></td>
                      <td className="px-3 py-2"><StatusPill status={st} />{p.approvalStatus === 'REJECTED' && p.rejectionReason && <p className="mt-1 max-w-[160px] text-xs text-red-700">{p.rejectionReason}</p>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {meta && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p>
            {t('showing')} {rows?.length ?? 0} {t('of')} {meta.total} · <b className="tabular-nums text-ink">{t('total')}: {formatINR(meta.totalAmount)}</b>
            {' · '}{t('paidLabel')} {formatINR(meta.totalPaid)} · {t('creditLeft')} {formatINR(meta.totalCredit)}
          </p>
          <div className="flex items-center gap-2">
            <button className="btn-secondary min-h-[36px] px-3" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← {t('prevPage')}</button>
            <span className="tabular-nums">{page} / {pages}</span>
            <button className="btn-secondary min-h-[36px] px-3" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('nextPage')} →</button>
          </div>
        </div>
      )}

      <Sheet open={!!detail && !action} onClose={() => setDetail(null)} title={detail ? `${t('purchaseDetails')} · ${detail.code}` : ''}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-slate-600">{prettyDate(day(detail.businessDate))} · {pick(detail.locationName, detail.locationNameTa)} · <b>{detail.supplierName}</b></p>
              <StatusPill status={detail.status !== 'ACTIVE' ? detail.status : detail.approvalStatus} />
            </div>
            <ul className="divide-y rounded-card border border-slate-200">
              {(detail.items as any[]).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>{pick(i.itemName, i.itemNameTa)}<span className="block text-xs text-slate-500">{dec(i.quantity).toString()} {i.unitCode} × ₹{dec(i.rate).toString()}</span></span>
                  <span className="tabular-nums">{formatINR(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1">
              <Row l={t('subtotal')} v={detail.subtotal} />
              {dec(detail.otherCharges).greaterThan(0) && <Row l={`+ ${t('otherCharges')}`} v={detail.otherCharges} />}
              {dec(detail.discount).greaterThan(0) && <Row l={`− ${t('discount')}`} v={detail.discount} />}
              <Row l={t('purchaseTotal')} v={detail.totalAmount} bold />
              <Row l={`${t('paidLabel')} · ${MODE_KEY[detail.paymentMode] ? t(MODE_KEY[detail.paymentMode]) : detail.paymentMode}`} v={detail.paidAmount} />
              <Row l={`${t('creditLeft')}${detail.dueDate ? ` · ${t('dueDate')} ${prettyDate(day(detail.dueDate))}` : ''}`} v={detail.creditAmount} bold />
            </div>
            {detail.supplierRefNo && <p><span className="text-slate-500">{t('invoiceNo')}:</span> {detail.supplierRefNo}</p>}
            {detail.remarks && <p className="rounded-card bg-slate-50 px-3 py-2">{detail.remarks}</p>}
            <p className="text-xs text-slate-500">{t('enteredBy')}: {detail.enteredByName ?? '—'}{detail.approvedByName && ` · ${t('approvedBy')}: ${detail.approvedByName}`}</p>
            {detail.approvalStatus === 'REJECTED' && detail.rejectionReason && <p className="text-red-800">✕ {detail.rejectionReason}</p>}
            {(detail.attachments as any[]).length > 0 && (
              <div className="flex flex-wrap gap-2">{(detail.attachments as any[]).map((a) => <button key={a.id} className="min-h-[40px] rounded-card border border-slate-300 px-3 hover:bg-slate-100" onClick={() => viewReceipt(a.id)}>🧾 {t('receiptsLabel')}</button>)}</div>
            )}
            {(detail.payments as any[]).length > 0 && (
              <div>
                <p className="mb-1 font-semibold">{t('paymentsLabel')}</p>
                <ul className="divide-y rounded-card border border-slate-200">
                  {(detail.payments as any[]).map((p) => (
                    <li key={p.id} className={`flex justify-between px-3 py-1.5 ${p.status !== 'ACTIVE' ? 'text-slate-400 line-through' : ''}`}>
                      <span>{prettyDate(day(p.businessDate))} · {MODE_KEY[p.paymentMode] ? t(MODE_KEY[p.paymentMode]) : p.paymentMode}{p.referenceNo ? ` · ${p.referenceNo}` : ''}</span>
                      <span className="tabular-nums">{formatINR(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {detail.status === 'ACTIVE' && detail.approvalStatus === 'SUBMITTED' && can('purchase:approve') && (
                <>
                  <button className="btn-primary" disabled={!!busy} onClick={() => run('approve')}>✓ {t('approve')}</button>
                  <button className="btn-danger" disabled={!!busy} onClick={() => { setReason(''); setAction('reject'); }}>✕ {t('reject')}</button>
                </>
              )}
              {detail.status === 'ACTIVE' && ['SUBMITTED', 'REJECTED'].includes(detail.approvalStatus) && can('purchase:create') && (
                <button className="btn-secondary" disabled={!!busy} onClick={() => run('cancel')}>{t('cancelEntry')}</button>
              )}
              {detail.status === 'ACTIVE' && detail.approvalStatus === 'APPROVED' && can('purchase:approve') && (
                <button className="btn-secondary" disabled={!!busy} onClick={() => { setReason(''); setAction('reverse'); }}>↺ {t('reverse')}</button>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!action} onClose={() => setAction(null)} title={action ? `${t(action)} · ${detail?.code ?? ''}` : ''}>
        <div className="space-y-3">
          {action === 'reverse' && <p className="text-sm text-slate-600">{t('reverseHelp')}</p>}
          <label htmlFor="pra" className="label">{t('reason')} *</label>
          <textarea id="pra" className="field min-h-[96px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setAction(null)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={!reason.trim() || !!busy} onClick={() => run(action!)}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Row({ l, v, bold }: { l: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}><span className="text-slate-600">{l}</span><span className="tabular-nums">{formatINR(v)}</span></div>;
}
