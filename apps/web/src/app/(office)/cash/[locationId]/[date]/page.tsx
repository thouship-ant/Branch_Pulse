'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { openPhoto, VarianceChip, varianceTone } from '@/components/cash/parts';
import { ErrorBox, Sheet, Skeleton, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate, prettyTime, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { MOVEMENT_KEY, REASON_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

/** One branch's cash for one day, as the owner sees it: workings, count, difference, explanation, photos, decision. */
export default function CashDetail() {
  const { locationId, date } = useParams<{ locationId: string; date: string }>();
  const { t, pick } = useT();
  const { me, can } = useSession();
  const [cash, setCash] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [closing, setClosing] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, m, s] = await Promise.all([
        api.get(`/cash/reconciliation/${locationId}/${date}`),
        api.get(`/cash/transactions?locationId=${locationId}&date=${date}`),
        api.get(`/closings/${locationId}/${date}`),
      ]);
      setCash(c); setMoves(m); setClosing(s.closing); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [locationId, date]);
  useEffect(() => { void load(); }, [load]);

  async function decide(kind: 'approve' | 'reject') {
    setBusy(true); setError(null);
    try {
      await api.post(`/cash/reconciliation/${cash.id}/${kind}`, kind === 'reject' ? { comment } : {});
      setRejecting(false); setComment(''); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); setRejecting(false); }
    finally { setBusy(false); }
  }

  if (!cash || !closing) return error ? <ErrorBox error={error} /> : <Skeleton className="h-96" />;
  const loc = me?.locations.find((l) => l.id === locationId);
  const v = cash.variance === null ? null : dec(cash.variance);
  const tone = v ? varianceTone(v) : null;
  const canDecide = cash.varianceApproval === 'SUBMITTED' && can('cash:approve');
  const denoms = cash.denominations as Record<string, number> | null;
  const denomLine = denoms ? Object.entries(denoms).filter(([, n]) => n).sort((a, b) => Number(b[0]) - Number(a[0])).map(([d, n]) => `₹${d} × ${n}`).join('   ') : '';

  return (
    <div className="space-y-4">
      <Link href={`/cash?date=${date}`} className="btn-secondary min-h-[40px] px-4 text-sm">← {t('cashRecon')}</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-slate-500">{prettyDate(date)}</p>
          <h2 className="text-2xl font-bold">{loc ? pick(loc.name, loc.nameTa) : ''} · {t('cashRecon')}</h2>
        </div>
        <div className="flex items-center gap-2"><VarianceChip status={cash.varianceApproval} /><StatusPill status={closing.status} /></div>
      </div>
      <ErrorBox error={error} />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-1 text-sm" aria-label={t('expectedCash')}>
          <h3 className="mb-1 font-semibold">{t('expectedCash')}</h3>
          <Row l={t('openingCash')} v={cash.openingCash} />
          <Row l={`+ ${t('cash')} ${t('sales')}`} v={cash.cashSales} />
          <Row l={`+ ${t('otherReceipts')}`} v={cash.otherReceipts} />
          <Row l={`− ${t('expenses')}`} v={cash.cashExpenses} />
          {!dec(cash.cashPurchases).isZero() && <Row l={`− ${t('purchases')}`} v={cash.cashPurchases} />}
          {!dec(cash.otherCashOut).isZero() && <Row l={`− ${t('supplierAdvances')}`} v={cash.otherCashOut} />}
          <Row l={`− ${t('withdrawals')}`} v={cash.withdrawals} />
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold"><span>{t('expectedCash')}</span><span className="tabular-nums">{formatINR(cash.expectedClosing, { decimals: false })}</span></div>
          <Row l={t('actualCash')} v={cash.actualClosing} bold />
          {v && tone && <div className={`mt-2 flex items-center justify-between rounded-card border px-3 py-2 font-semibold ${tone.cls}`}><span>{tone.icon} {t(tone.key)}</span><span className="tabular-nums">{formatINR(v.abs())}</span></div>}
        </section>

        <section className="card space-y-2 text-sm" aria-label={t('cashMovements')}>
          <h3 className="mb-1 font-semibold">{t('cashMovements')}</h3>
          {moves.filter((m) => m.status === 'ACTIVE').length === 0 ? <p className="text-slate-500">—</p> : (
            <ul className="divide-y">
              {moves.filter((m) => m.status === 'ACTIVE').map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0"><p>{MOVEMENT_KEY[m.txnType] ? t(MOVEMENT_KEY[m.txnType]) : m.txnType}</p>{m.description && <p className="truncate text-xs text-slate-500">{m.description}</p>}</div>
                  <span className="tabular-nums">{m.direction < 0 ? '−' : '+'} {formatINR(m.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {denomLine && (
            <div className="border-t pt-2">
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('denominations')}</p>
              <p className="tabular-nums text-slate-700">{denomLine}</p>
            </div>
          )}
        </section>
      </div>

      {v && !v.isZero() && (
        <section className="card space-y-3 text-sm" aria-label={t('explanation')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t('explanation')}</h3>
            <VarianceChip status={cash.varianceApproval} />
          </div>
          <p><span className="text-slate-500">{t('reason')}:</span> <b>{cash.varianceReason && REASON_KEY[cash.varianceReason] ? t(REASON_KEY[cash.varianceReason]) : cash.varianceReason ?? '—'}</b></p>
          <p className="whitespace-pre-wrap rounded-card bg-slate-50 px-3 py-2">{cash.managerExplanation ?? '—'}</p>
          {(cash.photos as any[]).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(cash.photos as any[]).map((p) => <button key={p.id} className="min-h-[44px] rounded-card border border-slate-300 px-3 hover:bg-slate-100" onClick={() => openPhoto(p.id)}>🖼 {t('viewPhoto')}</button>)}
            </div>
          )}
          {cash.varianceApproval === 'APPROVED' && <p className="text-emerald-800">✓ {t('approvedBy')}: <b>{cash.approvedBy ?? '—'}</b>{cash.approvedAt ? ` · ${prettyDate(todayIST(new Date(cash.approvedAt)))} ${prettyTime(cash.approvedAt)}` : ''}</p>}
          {closing.status === 'REJECTED' && closing.reviewComment && <p className="text-red-800">✕ {closing.reviewComment}</p>}
          {canDecide && (
            <div className="flex flex-wrap gap-3 border-t pt-3">
              <button className="btn-primary" disabled={busy} onClick={() => decide('approve')}>✓ {t('approve')}</button>
              <button className="btn-danger" disabled={busy} onClick={() => setRejecting(true)}>✕ {t('reject')}</button>
            </div>
          )}
        </section>
      )}

      <Link className="btn-secondary" href={`/closings/${locationId}/${date}`}>{t('closing')} →</Link>

      <Sheet open={rejecting} onClose={() => setRejecting(false)} title={t('reject')}>
        <div className="space-y-3">
          <label htmlFor="rj" className="label">{t('comment')} *</label>
          <textarea id="rj" className="field min-h-[96px] py-2" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRejecting(false)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={!comment.trim() || busy} onClick={() => decide('reject')}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Row({ l, v, bold }: { l: string; v: string | null | undefined; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}><span className="text-slate-600">{l}</span><span className="tabular-nums">{formatINR(v)}</span></div>;
}
