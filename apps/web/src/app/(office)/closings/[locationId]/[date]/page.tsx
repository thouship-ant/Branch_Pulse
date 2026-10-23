'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ErrorBox, Sheet, Skeleton, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate, prettyTime } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { REASON_KEY } from '@/lib/labels';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

type Action = 'approve' | 'reject' | 'reopen';

export default function ClosingDetail() {
  const { locationId, date } = useParams<{ locationId: string; date: string }>();
  const { t, pick } = useT();
  const { can, me } = useSession();
  const [screen, setScreen] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.get(`/closings/${locationId}/${date}`);
      setScreen(s);
      setEvents(await api.get(`/closings/${s.closing.id}/events`));
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [locationId, date]);
  useEffect(() => { void load(); }, [load]);

  async function run() {
    if (!action) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/closings/${screen.closing.id}/${action}`, { comment: comment || undefined });
      setAction(null); setComment('');
      await load();
    } catch (e) {
      setAction(null);
      setError(e instanceof ApiError ? `${e.message}${e.code === 'CLOSING_HAS_PENDING_ITEMS' ? ' (see Approvals)' : ''}` : 'Failed');
    } finally { setBusy(false); }
  }

  if (!screen) return error ? <ErrorBox error={error} /> : <Skeleton className="h-96" />;
  const c = screen.closing;
  const cash = screen.cash;
  const loc = me?.locations.find((l) => l.id === locationId);
  const locName = pick(loc?.name, loc?.nameTa);
  const needComment = action === 'reject' || action === 'reopen';

  return (
    <div className="space-y-4">
      <Link href={`/closings?date=${date}`} className="btn-secondary min-h-[40px] px-4 text-sm">← {t('closings')}</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-slate-500">{prettyDate(date)}</p>
          <h2 className="text-2xl font-bold">{locName} · {t('closing')}</h2>
        </div>
        <StatusPill status={c.status} />
      </div>
      <ErrorBox error={error} />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-1 text-sm" aria-label="Sales">
          <h3 className="mb-1 font-semibold">{t('sales')}</h3>
          <Row l={t('totalSales')} v={screen.sales?.totalSales} bold />
          <Row l={t('cash')} v={screen.sales?.cashSales} /><Row l={t('upi')} v={screen.sales?.upiSales} /><Row l={t('card')} v={screen.sales?.cardSales} />
          {screen.sales && screen.sales.mismatchAmount !== '0' && <Row l={t('mismatch')} v={screen.sales.mismatchAmount} />}
          <Row l={`${t('expenses')} (${screen.totals.expenseCount})`} v={screen.totals.totalExpenses} />
          <Row l={`${t('purchases')} (${screen.totals.purchaseCount})`} v={screen.totals.totalPurchases} />
          <Row l={t('wastage')} v={screen.totals.totalWastageValue} />
        </section>

        <section className="card space-y-1 text-sm" aria-label={t('cash')}>
          <h3 className="mb-1 font-semibold">{t('cash')}</h3>
          <Row l={t('openingCash')} v={cash?.openingCash} />
          <Row l={t('expectedCash')} v={cash?.expectedClosing} whole />
          <Row l={t('actualCash')} v={cash?.actualClosing} />
          <Row l={`${t('variance')} · ${cash?.varianceLabel ?? ''}`} v={cash?.variance} bold />
          {cash?.varianceReason && <p className="pt-2 text-slate-600">{t('reason')}: {REASON_KEY[cash.varianceReason] ? t(REASON_KEY[cash.varianceReason]) : cash.varianceReason}</p>}
          {cash?.managerExplanation && <p className="text-slate-600">“{cash.managerExplanation}”</p>}
          {cash?.varianceApproval && <p className="pt-1 text-xs text-slate-500">Variance: {cash.varianceApproval}</p>}
        </section>
      </div>

      {(c.remarks || c.stockNotes) && (
        <section className="card text-sm">
          {c.remarks && <p><b>{t('remarks')}:</b> {c.remarks}</p>}
          {c.stockNotes && <p><b>{t('stockNotes')}:</b> {c.stockNotes}</p>}
        </section>
      )}

      {(screen.pending.expenses + screen.pending.purchases + screen.pending.wastage) > 0 && (
        <p role="status" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠ {screen.pending.expenses} {t('expenses')} · {screen.pending.purchases} {t('purchases')} · {screen.pending.wastage} {t('wastage')} — <Link href="/approvals" className="underline">{t('approvals')}</Link>
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {c.status === 'SUBMITTED' && can('closing:approve') && (
          <>
            <button className="btn-primary" onClick={() => setAction('approve')}>✓ {t('approve')}</button>
            <button className="btn-danger" onClick={() => setAction('reject')}>✕ {t('reject')}</button>
          </>
        )}
        {c.status === 'APPROVED' && can('closing:reopen') && <button className="btn-secondary" onClick={() => setAction('reopen')}>↺ {t('reopen')}</button>}
      </div>

      <section className="card" aria-label={t('history')}>
        <h3 className="mb-2 font-semibold">{t('history')}</h3>
        <ol className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              <span className="w-16 tabular-nums text-slate-500">{prettyTime(e.createdAt)}</span>
              <span>{e.fromStatus ?? '—'} → <b>{e.toStatus}</b></span>
              {e.comment && <span className="text-slate-600">“{e.comment}”</span>}
            </li>
          ))}
          {events.length === 0 && <li className="text-slate-500">—</li>}
        </ol>
      </section>

      <Sheet open={!!action} onClose={() => setAction(null)} title={action ? t(action) : ''}>
        <div className="space-y-3">
          <div>
            <label htmlFor="c" className="label">{t('comment')}{needComment && ' *'}</label>
            <textarea id="c" className="field min-h-[96px] py-2" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setAction(null)}>{t('cancel')}</button>
            <button className={action === 'approve' ? 'btn-primary' : action === 'reject' ? 'btn-danger' : 'btn-secondary'} disabled={busy || (needComment && !comment.trim())} onClick={run}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Row({ l, v, bold, whole }: { l: string; v: string | null | undefined; bold?: boolean; whole?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span className="text-slate-600">{l}</span><span className="tabular-nums">{formatINR(v, whole ? { decimals: false } : undefined)}</span>
    </div>
  );
}
