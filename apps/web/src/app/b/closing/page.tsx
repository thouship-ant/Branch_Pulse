'use client';

import { useCallback, useEffect, useState } from 'react';
import { Chips, ErrorBox, Skeleton, StatusPill, Warnings } from '@/components/ui';
import { api, ApiError, type Warning } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { REASON_KEY } from '@/lib/labels';
import { dec, formatINR, sumDec } from '@/lib/money';
import { submitOffline, useOutbox } from '@/lib/outbox';
import { useBranch } from '@/lib/useBranch';

const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

export default function ClosingPage() {
  const { t } = useT();
  const { locationId, date } = useBranch();
  const { waiting, online } = useOutbox(locationId, date);
  const [step, setStep] = useState<1 | 2>(1);
  const [cash, setCash] = useState<any>(null);
  const [screen, setScreen] = useState<any>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [manualTotal, setManualTotal] = useState('');
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [remarks, setRemarks] = useState('');
  const [stockNotes, setStockNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Array<{ code: string; message: string }>>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [c, s] = await Promise.all([
        api.get(`/cash/reconciliation/${locationId}/${date}`),
        api.get(`/closings/${locationId}/${date}`),
      ]);
      setCash(c);
      setScreen(s);
      if (c.denominations) {
        setCounts(Object.fromEntries(Object.entries(c.denominations as Record<string, number>).map(([k, v]) => [k, String(v)])));
      }
      if (c.varianceReason) setReason(c.varianceReason);
      if (c.managerExplanation) setExplanation(c.managerExplanation);
      if (c.actualClosing && !c.denominations) setManualTotal(String(c.actualClosing));
    } catch (e) {
      if (e instanceof ApiError && !e.isNetwork) setError(e.message);
    }
  }, [locationId, date]);

  useEffect(() => { void load(); }, [load]);

  const denomTotal = sumDec(DENOMS.map((d) => dec(counts[d] || 0).mul(d)));
  const actual = denomTotal.isZero() && manualTotal ? dec(manualTotal) : denomTotal;
  const hasCount = !actual.isZero() || manualTotal !== '' || Object.values(counts).some(Boolean);
  const expected = dec(cash?.expectedClosing);
  const variance = actual.minus(expected);
  const tallied = variance.isZero();
  const label = tallied ? t('tallied') : variance.isNegative() ? t('shortage') : t('surplus');

  const status = screen?.closing?.status ?? 'PENDING';
  const locked = status === 'SUBMITTED' || status === 'APPROVED';
  const explanationOk = tallied || (reason !== '' && explanation.trim().length >= 10);

  async function saveCount() {
    setBusy(true); setError(null); setWarnings([]);
    try {
      const row = await submitOffline({
        entityType: 'CASH_RECONCILIATION', op: 'UPDATE', locationId, businessDate: date, baseVersion: cash?.version ?? undefined,
        payload: {
          locationId, businessDate: date, actualClosing: actual.toFixed(2),
          denominations: Object.fromEntries(Object.entries(counts).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])),
          varianceReason: tallied ? undefined : reason, managerExplanation: tallied ? undefined : explanation,
        },
      });
      if (row.state === 'REJECTED' || row.state === 'CONFLICT') { setError(row.lastError ?? 'Could not save'); return; }
      setWarnings((row.warnings as Warning[]) ?? []);
      await load();
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

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

  if (!cash || !screen) return error ? <ErrorBox error={error} /> : <Skeleton className="h-96" />;
  const tot = screen.totals;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{prettyDate(date)}</p>
          <h2 className="text-xl font-bold">{t('closing')}</h2>
        </div>
        <StatusPill status={status} />
      </div>

      {status === 'REJECTED' && screen.closing.reviewComment && (
        <div role="alert" className="rounded-card border border-red-300 bg-red-50 p-3 text-sm text-red-900">✕ {t('reviewComment')}: {screen.closing.reviewComment}</div>
      )}
      {locked && <p role="status" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{status === 'APPROVED' ? '✓ ' : '◔ '}{t(status === 'APPROVED' ? 'approved' : 'submitted')}</p>}

      <ol className="flex gap-2 text-sm font-medium" aria-label="Steps">
        <li className={`chip ${step === 1 ? 'border-brand bg-brand text-white' : 'border-slate-300'}`}>1 · {t('cash')}</li>
        <li className={`chip ${step === 2 ? 'border-brand bg-brand text-white' : 'border-slate-300'}`}>2 · {t('submit')}</li>
      </ol>

      {step === 1 && (
        <>
          <section className="card space-y-1 text-sm" aria-label={t('expectedCash')}>
            <Row label={t('openingCash')} value={cash.openingCash} />
            <Row label={`+ ${t('cash')} ${t('sales')}`} value={cash.cashSales} />
            {!dec(cash.otherReceipts).isZero() && <Row label={`+ ${t('otherReceipts')}`} value={cash.otherReceipts} />}
            <Row label={`− ${t('expenses')}`} value={cash.cashExpenses} />
            {!dec(cash.cashPurchases).isZero() && <Row label={`− ${t('purchases')}`} value={cash.cashPurchases} />}
            {!dec(cash.otherCashOut).isZero() && <Row label={`− ${t('supplierAdvances')}`} value={cash.otherCashOut} />}
            {!dec(cash.withdrawals).isZero() && <Row label={`− ${t('withdrawals')}`} value={cash.withdrawals} />}
            <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold">
              <span>{t('expectedCash')}</span><span className="tabular-nums">{formatINR(cash.expectedClosing)}</span>
            </div>
          </section>

          <section className="card space-y-3" aria-label={t('denominations')}>
            <h3 className="font-semibold">{t('denominations')}</h3>
            <div className="grid grid-cols-3 gap-2">
              {DENOMS.map((d) => (
                <label key={d} className="block">
                  <span className="label">₹{d}</span>
                  <input
                    className="field text-center text-lg" inputMode="numeric" placeholder="0" disabled={locked}
                    value={counts[d] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-card bg-slate-100 px-3 py-3 font-semibold">
              <span>{t('actualCash')}</span><span className="text-lg tabular-nums">{formatINR(actual)}</span>
            </div>
          </section>

          {hasCount && (
            <div role="status" className={`flex items-center justify-between rounded-card border px-3 py-3 font-semibold ${tallied ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : variance.isNegative() ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              <span>{tallied ? '✓' : variance.isNegative() ? '▼' : '▲'} {label}</span>
              <span className="tabular-nums">{formatINR(variance.abs())}</span>
            </div>
          )}

          {hasCount && !tallied && (
            <section className="card space-y-3">
              <Chips label={t('reason')} value={reason as any} onChange={setReason} options={Object.keys(REASON_KEY).map((v) => ({ value: v, label: t(REASON_KEY[v]) }))} />
              <div>
                <label htmlFor="explanation" className="label">{t('explanation')} *</label>
                <textarea id="explanation" className="field min-h-[80px] py-2" value={explanation} onChange={(e) => setExplanation(e.target.value)} disabled={locked} />
                {explanation.length > 0 && explanation.trim().length < 10 && <p className="mt-1 text-xs text-red-700">{t('atLeast10')}</p>}
              </div>
            </section>
          )}

          <Warnings items={warnings} />
          <ErrorBox error={error} />
          <button className="btn-primary w-full" disabled={busy || locked || !hasCount || !explanationOk} onClick={saveCount}>{busy ? t('loading') : t('save')} →</button>
          {locked && <button className="btn-secondary w-full" onClick={() => setStep(2)}>{t('submit')} →</button>}
        </>
      )}

      {step === 2 && (
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
          <button className="btn-secondary w-full" onClick={() => setStep(1)}>← {t('cash')}</button>
        </>
      )}
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
