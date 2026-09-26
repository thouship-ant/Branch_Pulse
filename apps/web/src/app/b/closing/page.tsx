'use client';

import { useCallback, useEffect, useState } from 'react';
import { CashReconciliation } from '@/components/cash/CashReconciliation';
import { ErrorBox, Skeleton, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { useOutbox } from '@/lib/outbox';
import { useBranch } from '@/lib/useBranch';

export default function ClosingPage() {
  const { t } = useT();
  const { locationId, date } = useBranch();
  const { waiting, online } = useOutbox(locationId, date);
  const [step, setStep] = useState<1 | 2>(1);
  const [cash, setCash] = useState<any>(null);
  const [screen, setScreen] = useState<any>(null);
  const [remarks, setRemarks] = useState('');
  const [stockNotes, setStockNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Array<{ code: string; message: string }>>([]);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [c, s] = await Promise.all([
        api.get(`/cash/reconciliation/${locationId}/${date}`),
        api.get(`/closings/${locationId}/${date}`),
      ]);
      setCash(c);
      setScreen(s);
    } catch (e) {
      if (e instanceof ApiError && !e.isNetwork) setError(e.message);
    }
  }, [locationId, date]);

  // reload the summary whenever the user comes back to step 2 (the count may have just changed in step 1)
  useEffect(() => { void load(); }, [load, step, waiting]);

  async function submitClosing() {
    setBusy(true); setError(null); setFailed([]);
    try {
      await api.post(`/closings/${screen.closing.id}/submit`, { remarks: remarks || undefined, stockNotes: stockNotes || undefined });
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CLOSING_PRECHECK_FAILED') setFailed(e.details ?? []);
      else setError(e instanceof ApiError ? e.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  }

  if (!locationId) return <Skeleton className="h-96" />;
  const status = screen?.closing?.status ?? 'PENDING';
  const locked = status === 'SUBMITTED' || status === 'APPROVED';
  const tot = screen?.totals;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{prettyDate(date)}</p>
          <h2 className="text-xl font-bold">{t('closing')}</h2>
        </div>
        <StatusPill status={status} />
      </div>

      <ol className="flex gap-2 text-sm font-medium" aria-label="Steps">
        <li className={`chip ${step === 1 ? 'border-brand bg-brand text-white' : 'border-slate-300'}`}>1 · {t('cashRecon')}</li>
        <li className={`chip ${step === 2 ? 'border-brand bg-brand text-white' : 'border-slate-300'}`}>2 · {t('submit')}</li>
      </ol>

      {step === 1 && <CashReconciliation locationId={locationId} date={date} onContinue={() => setStep(2)} />}

      {step === 2 && (!cash || !screen ? (error ? <ErrorBox error={error} /> : <Skeleton className="h-96" />) : (
        <>
          <section className="card space-y-2 text-sm" aria-label="Summary">
            <Row label={t('totalSales')} value={screen.sales?.totalSales} bold />
            <Row label={t('cash')} value={screen.sales?.cashSales} />
            <Row label={t('upi')} value={screen.sales?.upiSales} />
            <Row label={t('card')} value={screen.sales?.cardSales} />
            <Row label={`${t('expenses')} (${tot.expenseCount})`} value={tot.totalExpenses} />
            <Row label={`${t('purchases')} (${tot.purchaseCount})`} value={tot.totalPurchases} />
            <Row label={t('wastage')} value={tot.totalWastageValue} />
            <Row label={t('expectedCash')} value={cash.expectedClosing} />
            <Row label={t('actualCash')} value={cash.actualClosing} />
            <Row label={`${t('variance')} · ${cash.varianceLabel ?? ''}`} value={cash.variance} bold />
          </section>

          <section className="card space-y-2" aria-label={t('prechecks')}>
            <h3 className="font-semibold">{t('prechecks')}</h3>
            <ul className="space-y-1 text-sm">
              {screen.prechecks.map((p: any) => (
                <li key={p.code} className={p.ok ? 'text-emerald-800' : 'text-red-800'}>{p.ok ? '✓' : '✕'} {p.message}</li>
              ))}
            </ul>
          </section>

          {!locked && (
            <section className="card space-y-3">
              <div>
                <label htmlFor="stockNotes" className="label">{t('stockNotes')}</label>
                <textarea id="stockNotes" className="field min-h-[64px] py-2" value={stockNotes} onChange={(e) => setStockNotes(e.target.value)} />
              </div>
              <div>
                <label htmlFor="remarks" className="label">{t('remarks')}</label>
                <textarea id="remarks" className="field min-h-[64px] py-2" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </section>
          )}

          {failed.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-card border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              {failed.map((f) => <li key={f.code}>✕ {f.message}</li>)}
            </ul>
          )}
          <ErrorBox error={error} />

          {/* closing needs server-side validation: it is online-only and waits for the outbox to drain */}
          <button className="btn-primary w-full" disabled={busy || locked || !screen.canSubmit || waiting > 0 || !online} onClick={submitClosing}>
            {busy ? t('loading') : t('submitClosing')}
          </button>
          {!online && <p className="text-center text-xs text-slate-500">{t('offline')}</p>}
          {waiting > 0 && online && <p className="text-center text-xs text-slate-500">{waiting} {t('waiting')}</p>}
          <button className="btn-secondary w-full" onClick={() => setStep(1)}>← {t('cashRecon')}</button>
        </>
      ))}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string | null | undefined; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span className="text-slate-600">{label}</span>
      <span className="tabular-nums">{formatINR(value)}</span>
    </div>
  );
}
