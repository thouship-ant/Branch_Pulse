'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorBox, Sheet, Skeleton } from '@/components/ui';
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
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get('/expenses?status=SUBMITTED&pageSize=100')); setError(null); } catch (e: any) { setError(e.message); }
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
      if (!att) { setError('No receipt attached'); return; }
      const { url } = await api.get(`/attachments/${att.id}/url`);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('approvals')} · {t('expenses')}</h2>
      <ErrorBox error={error} />
      {!rows ? <Skeleton className="h-64" /> : rows.length === 0 ? (
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
                <button className="btn-secondary min-h-[44px] px-3" onClick={() => viewReceipt(e.id)} aria-label="View receipt">🧾</button>
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
