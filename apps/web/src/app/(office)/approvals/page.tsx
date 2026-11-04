'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Sheet, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { MODE_KEY } from '@/lib/labels';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

function age(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? '<1h' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export default function Approvals() {
  const { t, pick } = useT();
  const { me } = useSession();
  const [tab, setTab] = useState<'expenses' | 'closing'>('expenses');
  const [rows, setRows] = useState<any[] | null>(null);
  const [closings, setClosings] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ex, cl] = await Promise.all([api.get('/expenses?status=SUBMITTED&pageSize=100'), api.get('/closings/awaiting').catch(() => [])]);
      setRows(ex); setClosings(cl); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const branch = (id: string) => {
    const l = me?.locations.find((x) => x.id === id);
    return pick(l?.name, l?.nameTa);
  };

  async function approve(id: string) {
    setBusy(id);
    try { await api.post(`/expenses/${id}/approve`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  async function approveClosing(id: string) {
    setBusy(id);
    try { await api.post(`/closings/${id}/approve`, {}); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try {
      if (rejecting.closingId) await api.post(`/closings/${rejecting.closingId}/reject`, { comment: reason });
      else await api.post(`/expenses/${rejecting.id}/reject`, { reason }); setRejecting(null); setReason(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  async function viewReceipt(id: string) {
    try {
      const detail = await api.get(`/expenses/${id}`);
      const att = detail.attachments?.[0];
      if (!att) { setError('No receipt attached'); return; }
      const { url } = await api.get(`/attachments/${att.id}/url`);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('approvals')} · {tab === 'expenses' ? t('expenses') : t('closings')}</h2>
      <div role="tablist" className="flex gap-2">
        {([['expenses', t('expenses'), rows?.length ?? 0], ['closing', t('closings'), closings?.length ?? 0]] as const).map(([k, label, n]) => (
          <button
            key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-[44px] rounded-full px-5 text-sm font-bold ${tab === k ? 'bg-brand text-white' : 'bg-white text-slate-700 shadow-sm'}`}
          >
            {label}{n > 0 ? <span className="ml-2 rounded-full bg-white/25 px-2 py-0.5 text-xs">{n}</span> : null}
          </button>
        ))}
      </div>
      <Sheet open={!!error} onClose={() => setError(null)} title={t('errorTitle')}>
        <p role="alert" className="text-sm text-slate-700">{error}</p>
        <div className="mt-4 flex justify-end">
          <button className="btn-primary min-h-[44px] px-6" autoFocus onClick={() => setError(null)}>{t('ok')}</button>
        </div>
      </Sheet>
      {tab === 'closing' ? (
        !closings ? <Skeleton className="h-64" /> : closings.length === 0 ? (
          <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-4 py-3 font-medium text-emerald-900">✓ {t('noExceptions')}</p>
        ) : (
          <ul className="space-y-3">
            {closings.map((c) => (
              <li key={c.closingId} className="card flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{pick(c.locationName, c.locationNameTa)} · {prettyDate(c.businessDate)}</p>
                  <p className="text-sm text-slate-600"><span className="tabular-nums">{c.totalSales != null ? formatINR(c.totalSales) : '—'}</span>{c.cashVariance != null && Number(c.cashVariance) !== 0 ? <> · {t('difference')} <span className="tabular-nums">{formatINR(c.cashVariance)}</span></> : null}</p>
                  {c.submittedAt && <p className="text-xs text-slate-500">⏱ {age(c.submittedAt)}</p>}
                </div>
                <div className="flex gap-2">
                  <Link href={`/closings/${c.locationId}/${String(c.businessDate).slice(0, 10)}`} className="btn-secondary flex min-h-[44px] items-center px-4">{t('view')}</Link>
                  <button className="btn-primary min-h-[44px] px-4" disabled={busy === c.closingId} onClick={() => approveClosing(c.closingId)}>✓ {t('approve')}</button>
                  <button className="btn-danger min-h-[44px] px-4" disabled={busy === c.closingId} onClick={() => { setReason(''); setRejecting({ ...c, id: c.closingId, code: `${c.locationCode} ${String(c.businessDate).slice(0, 10)}` }); }}>✕ {t('reject')}</button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : !rows ? <Skeleton className="h-64" /> : rows.length === 0 ? (
        <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-4 py-3 font-medium text-emerald-900">✓ {t('noExceptions')}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((e) => (
            <li key={e.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{pick(e.categoryName, e.categoryNameTa)} ·<span className="tabular-nums">{formatINR(e.amount)}</span></p>
                <p className="text-sm text-slate-600">{branch(e.locationId)} · {prettyDate(e.businessDate)} · {MODE_KEY[e.paymentMode] ? t(MODE_KEY[e.paymentMode]) : e.paymentMode}{e.payeeName ? ` · ${e.payeeName}` : ''}</p>
                <p className="text-xs text-slate-500">{e.code} · ⏱ {age(e.createdAt)}</p>
              </div>
              <div className="flex gap-2">
                <button
                  className={`btn-secondary relative min-h-[44px] px-3 ${e.receiptCount === 0 ? 'opacity-70' : ''}`}
                  onClick={() => viewReceipt(e.id)} aria-label={e.receiptCount === 0 ? t('noReceipt') : t('receipt')} title={e.receiptCount === 0 ? t('noReceipt') : t('receipt')}
                >
                  🧾
                  {e.receiptCount === 0 && (
                    <span aria-hidden className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-red-600 text-[11px] font-bold leading-none text-white shadow">✕</span>
                  )}
                </button>
                <button className="btn-primary min-h-[44px] px-4" disabled={busy === e.id} onClick={() => approve(e.id)}>✓ {t('approve')}</button>
                <button className="btn-danger min-h-[44px] px-4" disabled={busy === e.id} onClick={() => setRejecting(e)}>✕ {t('reject')}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`${t('reject')} · ${rejecting?.code ?? ''}`}>
        <div className="space-y-3">
          <label htmlFor="r" className="label">{t('reason')} *</label>
          <textarea id="r" className="field min-h-[96px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRejecting(null)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={!reason.trim() || busy !== null} onClick={reject}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
