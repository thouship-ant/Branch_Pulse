'use client';

import { Select } from '@/components/Select';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { MODE_KEY, STATUS_KEY } from '@/lib/labels';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { ErrorBox, Sheet, Skeleton, StatusPill } from '../ui';

const PAGE = 25;
const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT'];
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every expense with all its fields: date, branch, category, sub-category, amount, mode, payee, description, receipt, who entered / approved it, status. */
export function ExpenseLedger({ fixedLocationId }: { fixedLocationId?: string }) {
  const { t, pick } = useT();
  const { can } = useSession();
  const period = usePeriod('30');
  const { range, valid } = period;
  const [branchId, setBranchId] = useState(fixedLocationId ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [subId, setSubId] = useState('');
  const [mode, setMode] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [branches, setBranches] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [rows, setRows] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; totalAmount: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!fixedLocationId) api.get('/locations?type=BRANCH').then((b) => setBranches(b as any[])).catch(() => undefined);
    api.get('/expense-categories').then((c) => setCategories(c as any[])).catch(() => undefined);
  }, [fixedLocationId]);

  // typing in the search box waits a moment before it queries
  useEffect(() => { const h = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 350); return () => clearTimeout(h); }, [q]);
  useEffect(() => { setPage(1); }, [range.from, range.to, branchId, categoryId, subId, mode, status]);

  const qs = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ from: range.from, to: range.to, ...extra });
    if (branchId) p.set('locationId', branchId);
    if (categoryId) p.set('categoryId', categoryId);
    if (subId) p.set('subCategoryId', subId);
    if (mode) p.set('paymentMode', mode);
    if (status) p.set('status', status);
    if (query) p.set('q', query);
    return p;
  }, [range.from, range.to, branchId, categoryId, subId, mode, status, query]);

  const load = useCallback(async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const { data, meta: m } = await api.full.get(`/expenses?${qs({ page: String(page), pageSize: String(PAGE) })}`);
      setRows(data); setMeta({ total: Number(m?.total ?? 0), totalAmount: String(m?.totalAmount ?? '0') }); setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [qs, page, valid]);
  useEffect(() => { void load(); }, [load]);

  const top = categories.filter((c) => !c.parentId);
  const subs = categories.filter((c) => c.parentId === categoryId);
  const locName = (e: any) => pick(e.locationName, e.locationNameTa);

  async function approve(id: string) {
    setBusy(id);
    try { await api.post(`/expenses/${id}/approve`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }
  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try { await api.post(`/expenses/${rejecting.id}/reject`, { reason }); setRejecting(null); setReason(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }
  async function viewReceipt(id: string) {
    try {
      const detail = await api.get(`/expenses/${id}`);
      const att = detail.attachments?.[0];
      if (!att) { setError(t('noReceipt')); return; }
      const { url } = await api.get(`/attachments/${att.id}/url`);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) { setError(e.message); }
  }

  async function downloadCsv() {
    setBusy('csv');
    try {
      const all: any[] = [];
      for (let p = 1; p <= 30; p++) { // up to 3,000 rows
        const { data, meta: m } = await api.full.get(`/expenses?${qs({ page: String(p), pageSize: '100' })}`);
        all.push(...data);
        if (all.length >= Number(m?.total ?? 0) || data.length === 0) break;
      }
      const head = ['Date', 'Expense no.', 'Branch ID', 'Branch', 'Category', 'Sub-category', 'Amount', 'Payment mode', 'Supplier', 'Payee', 'Description', 'Receipt attached', 'Entered by', 'Approved by', 'Approval status', 'Record status'];
      const lines = [head, ...all.map((e) => [
        String(e.businessDate).slice(0, 10), e.code, e.locationCode, e.locationName, e.categoryName, e.subCategoryName, e.amount, e.paymentMode,
        e.supplierName, e.payeeName, e.description, e.receiptCount > 0 ? 'Yes' : 'No', e.enteredByName, e.approvedByName, e.approvalStatus, e.status,
      ])];
      const blob = new Blob(['﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `expenses-${range.from}_${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  const pages = meta ? Math.max(1, Math.ceil(meta.total / PAGE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker period={period} label={t('expenses')} />
        <button className="btn-secondary" disabled={!rows || busy === 'csv'} onClick={downloadCsv}>⬇ {t('downloadCsv')}</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!fixedLocationId && (
          <div>
            <label htmlFor="lb" className="label">{t('branch')}</label>
            <Select id="lb" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {pick(b.name, b.nameTa)}</option>)}
            </Select>
          </div>
        )}
        <div>
          <label htmlFor="lc" className="label">{t('category')}</label>
          <Select id="lc" className="field" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubId(''); }}>
            <option value="">{t('allCategories')}</option>
            {top.map((c) => <option key={c.id} value={c.id}>{pick(c.nameEn, c.nameTa)}</option>)}
          </Select>
        </div>
        {subs.length > 0 && (
          <div>
            <label htmlFor="ls" className="label">{t('subCategory')}</label>
            <Select id="ls" className="field" value={subId} onChange={(e) => setSubId(e.target.value)}>
              <option value="">{t('allTypes')}</option>
              {subs.map((c) => <option key={c.id} value={c.id}>{pick(c.nameEn, c.nameTa)}</option>)}
            </Select>
          </div>
        )}
        <div>
          <label htmlFor="lm" className="label">{t('paymentMode')}</label>
          <Select id="lm" className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">{t('allModes')}</option>
            {MODES.map((m) => <option key={m} value={m}>{MODE_KEY[m] ? t(MODE_KEY[m]) : m}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="lt" className="label">{t('approvalStatus')}</label>
          <Select id="lt" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            {['SUBMITTED', 'APPROVED', 'REJECTED'].map((s) => <option key={s} value={s}>{t(STATUS_KEY[s])}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="lq" className="label">{t('search')}</label>
          <input id="lq" className="field" value={q} placeholder={`${t('payee')} / ${t('description')}`} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {!valid && <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {t('invalidRange')}</p>}
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-64" /> : (
        <section className={`card overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-50' : ''}`} aria-label={t('expenses')}>
          {rows.length === 0 ? <p className="p-4 text-slate-600">{t('noData')}</p> : (
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{t('dateLabel')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('branch')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('category')} › {t('subCategory')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('amount')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('paymentMode')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('supplier')} / {t('payee')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('description')}</th>
                  <th scope="col" className="px-3 py-2 text-center">{t('receipt')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('enteredBy')} / {t('approvedBy')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('approvalStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y align-top">
                {rows.map((e) => {
                  const st = e.status !== 'ACTIVE' ? e.status : e.approvalStatus;
                  return (
                    <tr key={e.id} className={e.status !== 'ACTIVE' ? 'text-slate-500' : ''}>
                      <td className="px-3 py-2">{prettyDate(String(e.businessDate).slice(0, 10))}<p className="font-mono text-xs text-slate-500">{e.code}</p></td>
                      <td className="px-3 py-2">{locName(e)}<p className="font-mono text-xs text-slate-500">{e.locationCode}</p></td>
                      <td className="px-3 py-2">{pick(e.categoryName, e.categoryNameTa)}{e.subCategoryName && <p className="text-xs text-slate-500">› {pick(e.subCategoryName, e.subCategoryNameTa)}</p>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formatINR(e.amount)}</td>
                      <td className="px-3 py-2">{MODE_KEY[e.paymentMode] ? t(MODE_KEY[e.paymentMode]) : e.paymentMode}</td>
                      <td className="px-3 py-2">{[e.supplierName, e.payeeName].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="max-w-[170px] whitespace-pre-wrap break-words px-3 py-2">{e.description ?? '—'}</td>
                      <td className="px-3 py-2 text-center">
                        {e.receiptCount > 0
                          ? <button className="min-h-[36px] min-w-[36px] rounded-card border border-slate-300 hover:bg-slate-100" onClick={() => viewReceipt(e.id)} aria-label={`${t('receipt')} ${e.code}`}>🧾</button>
                          : <span className="text-slate-400" title={t('noReceipt')}>—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <p><span className="text-xs text-slate-500">{t('enteredBy')}:</span> {e.enteredByName ?? '—'}</p>
                        <p><span className="text-xs text-slate-500">{t('approvedBy')}:</span> {e.approvedByName ?? '—'}</p>
                      </td>
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <StatusPill status={st} />
                          {e.approvalStatus === 'REJECTED' && e.rejectionReason && <p className="max-w-[180px] text-xs text-red-700">{e.rejectionReason}</p>}
                          {e.approvalStatus === 'SUBMITTED' && e.status === 'ACTIVE' && can('expense:approve') && (
                            <div className="flex gap-1.5 pt-1">
                              <button className="btn-primary min-h-[34px] px-2.5 text-xs" disabled={busy === e.id} onClick={() => approve(e.id)}>✓ {t('approve')}</button>
                              <button className="btn-danger min-h-[34px] px-2.5 text-xs" disabled={busy === e.id} onClick={() => setRejecting(e)}>✕ {t('reject')}</button>
                            </div>
                          )}
                        </div>
                      </td>
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
          <p>{t('showing')} {rows?.length ?? 0} {t('of')} {meta.total} · <b className="tabular-nums text-ink">{t('total')}: {formatINR(meta.totalAmount)}</b></p>
          <div className="flex items-center gap-2">
            <button className="btn-secondary min-h-[36px] px-3" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← {t('prevPage')}</button>
            <span className="tabular-nums">{page} / {pages}</span>
            <button className="btn-secondary min-h-[36px] px-3" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('nextPage')} →</button>
          </div>
        </div>
      )}

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`${t('reject')} · ${rejecting?.code ?? ''}`}>
        <div className="space-y-3">
          <label htmlFor="rr" className="label">{t('reason')} *</label>
          <textarea id="rr" className="field min-h-[96px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRejecting(null)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={!reason.trim() || busy !== null} onClick={reject}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
