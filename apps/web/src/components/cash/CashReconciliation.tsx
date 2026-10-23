'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, uploadAttachment, type Warning } from '@/lib/api';
import { addDays, prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { compressImage } from '@/lib/image';
import { MOVEMENT_KEY, REASON_KEY } from '@/lib/labels';
import { amt, dec, formatINR, sumDec } from '@/lib/money';
import { submitOffline, useOutbox } from '@/lib/outbox';
import { AutoTextarea, Chips, ErrorBox, MoneyInput, Sheet, Skeleton, TextField, Warnings } from '../ui';
import { openPhoto, VarianceChip, varianceTone } from './parts';

const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];
const MAX_PHOTOS = 3;
const MANUAL = ['OTHER_RECEIPT', 'WITHDRAWAL', 'DEPOSIT_TO_BANK', 'ADJUSTMENT'];

interface Props {
  locationId: string;
  date: string;
  /** Closing flow: show a "continue" button after saving. */
  onContinue?: () => void;
}

/**
 * The branch manager's daily cash reconciliation: expected cash from the day's movements, the counted cash,
 * the difference (surplus / shortage), and - when there is one - the reason, explanation, optional photos and
 * "send for approval". Saving works offline; sending for approval needs the server.
 */
export function CashReconciliation({ locationId, date, onContinue }: Props) {
  const { t } = useT();
  const { waiting, online } = useOutbox(locationId, date);
  const [cash, setCash] = useState<any>(null);
  const [closing, setClosing] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [override, setOverride] = useState('');
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [photos, setPhotos] = useState<Array<{ blob: Blob; name: string; url: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [c, s, m, h] = await Promise.all([
        api.get(`/cash/reconciliation/${locationId}/${date}`),
        api.get(`/closings/${locationId}/${date}`),
        api.get(`/cash/transactions?locationId=${locationId}&date=${date}`),
        api.get(`/cash/variance-report?locationId=${locationId}&from=${addDays(date, -29)}&to=${date}`),
      ]);
      setCash(c); setClosing(s.closing); setMoves(m); setHistory(h.rows);
      // a typed total is saved with an empty note count ({}), so only a non-empty note count means the notes were used
      if (c.denominations && Object.keys(c.denominations).length) setCounts(Object.fromEntries(Object.entries(c.denominations as Record<string, number>).map(([k, v]) => [k, String(v)])));
      else if (c.actualClosing != null) setOverride(String(c.actualClosing));
      if (c.varianceReason) setReason(c.varianceReason);
      if (c.managerExplanation) setExplanation(c.managerExplanation);
    } catch (e) {
      if (e instanceof ApiError && !e.isNetwork) setError(e.message);
    }
  }, [locationId, date]);
  useEffect(() => { void load(); }, [load]);

  const denomTotal = sumDec(DENOMS.map((d) => dec(counts[d] || 0).mul(d)));
  const hasCount = override !== '' || !denomTotal.isZero();
  const actual = override !== '' ? dec(override) : denomTotal;
  const expected = dec(cash?.expectedClosing);
  const variance = actual.minus(expected);
  const tallied = variance.isZero();
  const tone = varianceTone(variance);
  const closingStatus = closing?.status ?? 'PENDING';
  const locked = closingStatus === 'SUBMITTED' || closingStatus === 'APPROVED' || !!cash?.isLocked;
  const explained = tallied || (reason !== '' && explanation.trim().length >= 10);
  const approval = cash?.varianceApproval as string | null;
  const savedHasVariance = cash?.variance != null && !dec(cash.variance).isZero();
  const photoCount = (cash?.photos?.length ?? 0) + photos.length;

  const payload = (extra: Record<string, unknown> = {}) => ({
    locationId, businessDate: date, actualClosing: actual.toFixed(2),
    denominations: Object.fromEntries(Object.entries(counts).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])),
    varianceReason: tallied ? undefined : reason || undefined, managerExplanation: tallied ? undefined : explanation || undefined, ...extra,
  });

  /** Save as a draft. Works offline: the outbox uploads photos and applies the count exactly once. */
  async function save(): Promise<boolean> {
    setBusy(true); setError(null); setNotice(null); setWarnings([]);
    try {
      const row = await submitOffline({
        entityType: 'CASH_RECONCILIATION', op: 'UPDATE', locationId, businessDate: date, baseVersion: cash?.version ?? undefined,
        payload: payload(), blobs: photos.length ? photos.map((p) => ({ blob: p.blob, name: p.name })) : undefined,
      });
      if (row.state === 'REJECTED' || row.state === 'CONFLICT') { setError(row.lastError ?? 'Could not save'); return false; }
      setWarnings((row.warnings as Warning[]) ?? []);
      setPhotos([]);
      setNotice(row.state === 'DONE' ? (tallied ? t('synced') : t('savedDraft')) : t('offline'));
      await load();
      return true;
    } finally { setBusy(false); }
  }

  /** The closing's next step reads the count from the server, so a typed count must be saved before moving on. */
  async function saveAndContinue() {
    if (locked || (await save())) onContinue?.();
  }

  /** Save then send for approval. Online only: the server checks the reason and explanation. */
  async function send() {
    if (waiting > 0) { setError(t('syncFirst')); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const keys: string[] = [];
      for (const p of photos) keys.push(await uploadAttachment(p.blob, p.name, locationId));
      await api.put(`/cash/reconciliation/${locationId}/${date}`, payload(keys.length ? { attachmentKeys: keys, version: cash?.version ?? undefined } : { version: cash?.version ?? undefined }));
      await api.post(`/cash/reconciliation/${locationId}/${date}/submit`);
      setPhotos([]);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send');
    } finally { setBusy(false); }
  }

  async function cancelMove(id: string) {
    setBusy(true); setError(null);
    try { await api.post(`/cash/transactions/${id}/cancel`, {}); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not cancel'); }
    finally { setBusy(false); }
  }

  async function pick(file: File | undefined) {
    if (!file || photoCount >= MAX_PHOTOS) return;
    const blob = await compressImage(file);
    setPhotos((p) => [...p, { blob, name: file.name || 'cash.jpg', url: URL.createObjectURL(blob) }]);
  }

  if (!cash || !closing) return error ? <ErrorBox error={error} /> : <Skeleton className="h-96" />;
  const live = moves.filter((m) => m.status === 'ACTIVE');

  return (
    <div className="space-y-4">
      {closingStatus === 'REJECTED' && closing.reviewComment && (
        <div role="alert" className="rounded-card border border-red-300 bg-red-50 p-3 text-sm text-red-900">✕ {t('reviewComment')}: {closing.reviewComment}</div>
      )}
      {locked && <p role="status" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{closingStatus === 'APPROVED' ? '✓ ' : '◔ '}{t(closingStatus === 'APPROVED' ? 'approved' : 'submitted')}</p>}

      {/* 1. workings: Opening + cash sales + other receipts - expenses - withdrawals = expected */}
      <section className="card space-y-1 text-sm" aria-label={t('expectedCash')}>
        <Row label={t('openingCash')} value={cash.openingCash} />
        <Row label={`+ ${t('cash')} ${t('sales')}`} value={cash.cashSales} />
        {!dec(cash.otherReceipts).isZero() && <Row label={`+ ${t('otherReceipts')}`} value={cash.otherReceipts} />}
        <Row label={`− ${t('expenses')}`} value={cash.cashExpenses} />
        {!dec(cash.cashPurchases).isZero() && <Row label={`− ${t('purchases')}`} value={cash.cashPurchases} />}
        {!dec(cash.otherCashOut).isZero() && <Row label={`− ${t('supplierAdvances')}`} value={cash.otherCashOut} />}
        {!dec(cash.withdrawals).isZero() && <Row label={`− ${t('withdrawals')}`} value={cash.withdrawals} />}
        <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold">
          <span>{t('expectedCash')}</span><span className="tabular-nums">{formatINR(cash.expectedClosing, { decimals: false })}</span>
        </div>
      </section>

      {/* 2. movements that feed the workings */}
      <section className="card space-y-2" aria-label={t('cashMovements')}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t('cashMovements')}</h3>
          <button className="btn-secondary min-h-[40px] px-3 text-sm" disabled={locked} onClick={() => setAdding(true)}>+ {t('addCashMove')}</button>
        </div>
        {live.length === 0 ? <p className="text-sm text-slate-500">—</p> : (
          <ul className="divide-y text-sm">
            {live.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{MOVEMENT_KEY[m.txnType] ? t(MOVEMENT_KEY[m.txnType]) : m.txnType}</p>
                  {m.description && <p className="truncate text-xs text-slate-500">{m.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`tabular-nums ${m.direction < 0 ? 'text-slate-700' : 'font-semibold text-emerald-800'}`}>{m.direction < 0 ? '−' : '+'} {formatINR(m.amount)}</span>
                  {!locked && !m.sourceType && MANUAL.includes(m.txnType) && (
                    <button className="min-h-[36px] rounded-card border border-slate-300 px-2 text-xs hover:bg-slate-100" disabled={busy} onClick={() => cancelMove(m.id)} aria-label={`${t('cancelEntry')}: ${MOVEMENT_KEY[m.txnType] ? t(MOVEMENT_KEY[m.txnType]) : m.txnType}`}>✕</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. the count */}
      <section className="card space-y-3" aria-label={t('denominations')}>
        <h3 className="font-semibold">{t('denominations')}</h3>
        <div className="grid grid-cols-3 gap-2">
          {DENOMS.map((d) => (
            <label key={d} className="block">
              <span className="label">₹{d}</span>
              <input
                className="field text-center text-lg" inputMode="numeric" placeholder="0" disabled={locked}
                value={counts[d] ?? ''} onChange={(e) => { setOverride(''); setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, '').slice(0, 5) })); }}
              />
            </label>
          ))}
        </div>
        <MoneyInput id="typed" label={t('typeTotal')} value={override} onChange={setOverride} disabled={locked} />
        <div className="flex items-center justify-between rounded-card bg-slate-100 px-3 py-3 font-semibold">
          <span>{t('actualCash')}</span><span className="text-lg tabular-nums">{hasCount ? formatINR(actual) : '—'}</span>
        </div>
      </section>

      {/* 4. surplus / shortage */}
      {hasCount && (
        <div role="status" className={`flex items-center justify-between rounded-card border px-3 py-3 font-semibold ${tone.cls}`}>
          <span>{tone.icon} {t(tone.key)}</span>
          <span className="flex items-center gap-2 tabular-nums">{formatINR(variance.abs())}{savedHasVariance && <VarianceChip status={approval} />}</span>
        </div>
      )}

      {/* 5. a difference needs a reason, an explanation and (optionally) a photo, then approval */}
      {hasCount && !tallied && (
        <section className="card space-y-3" aria-label={t('explanation')}>
          <Chips label={`${t('reason')} *`} value={reason as any} onChange={setReason} options={Object.keys(REASON_KEY).map((v) => ({ value: v, label: t(REASON_KEY[v]) }))} />
          <div>
            <AutoTextarea id="explanation" label={`${t('explanation')} *`} value={explanation} onChange={setExplanation} disabled={locked} minRows={3} />
            {explanation.length > 0 && explanation.trim().length < 10 && <p className="mt-1 text-xs text-red-700">{t('atLeast10')}</p>}
          </div>

          <div>
            <span className="label">{t('photoOptional')} · {t('maxPhotos')}</span>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="flex flex-wrap items-center gap-2">
              {(cash.photos as any[]).map((p) => (
                <button key={p.id} type="button" className="min-h-[44px] rounded-card border border-slate-300 px-3 text-sm hover:bg-slate-100" onClick={() => openPhoto(p.id)}>🖼 {t('viewPhoto')}</button>
              ))}
              {photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.url} src={p.url} alt="Attached photo" className="h-12 w-12 rounded-card border object-cover" />
              ))}
              {photoCount < MAX_PHOTOS && !locked && <button type="button" className="btn-secondary min-h-[44px] px-3 text-sm" onClick={() => fileRef.current?.click()}>📷 {t('addPhotoShort')}</button>}
            </div>
          </div>

          {approval === 'SUBMITTED' && <p role="status" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">◔ {t('sentHint')}</p>}
          {approval === 'APPROVED' && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ {t('approvedBy')}: {cash.approvedBy ?? '—'}</p>}
        </section>
      )}

      <Warnings items={warnings} />
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ {notice}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <button className="btn-secondary" disabled={busy || locked || !hasCount} onClick={save}>{busy ? t('loading') : t('save')}</button>
        {!tallied && hasCount && (
          <button
            className="btn-primary" onClick={send}
            disabled={busy || locked || !explained || !online || approval === 'SUBMITTED' || approval === 'APPROVED'}
          >{t('sendApproval')}</button>
        )}
      </div>
      {!online && !tallied && hasCount && <p className="text-center text-xs text-slate-500">{t('offline')}</p>}
      {onContinue && (
        <button className="btn-primary w-full" onClick={saveAndContinue} disabled={busy || (!locked && !hasCount)}>{busy ? t('loading') : `${t('submit')} →`}</button>
      )}

      {/* 6. recent differences for this branch */}
      <section className="card space-y-2" aria-label={t('recentDiffs')}>
        <h3 className="font-semibold">{t('recentDiffs')}</h3>
        {history.length === 0 ? <p className="text-sm text-slate-500">{t('noDiffs')}</p> : (
          <ul className="divide-y text-sm">
            {history.slice(0, 8).map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                <span>{prettyDate(h.businessDate)}<span className="ml-2 text-xs text-slate-500">{h.reason && REASON_KEY[h.reason] ? t(REASON_KEY[h.reason]) : ''}</span></span>
                <span className="flex items-center gap-2"><b className={`tabular-nums ${dec(h.variance).isNegative() ? 'text-red-700' : ''}`}>{dec(h.variance).isNegative() ? '▼ ' : '▲ '}{formatINR(dec(h.variance).abs())}</b><VarianceChip status={h.approvalStatus} /></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('addCashMove')}>
        <MoveForm locationId={locationId} date={date} onSaved={() => { setAdding(false); void load(); }} />
      </Sheet>
    </div>
  );
}

function MoveForm({ locationId, date, onSaved }: { locationId: string; date: string; onSaved: () => void }) {
  const { t } = useT();
  const [type, setType] = useState<'OTHER_RECEIPT' | 'WITHDRAWAL' | 'DEPOSIT_TO_BANK'>('OTHER_RECEIPT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.post('/cash/transactions', { locationId, businessDate: date, type, amount: amt(amount), description: note || undefined });
      onSaved();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Chips
        label={t('typeLabel')} value={type} onChange={setType}
        options={[{ value: 'OTHER_RECEIPT', label: `+ ${t('mvOtherReceipt')}` }, { value: 'WITHDRAWAL', label: `− ${t('mvWithdrawal')}` }, { value: 'DEPOSIT_TO_BANK', label: `− ${t('mvDeposit')}` }]}
      />
      <MoneyInput id="mvamt" label={t('amount')} value={amount} onChange={setAmount} required />
      <TextField id="mvnote" label={t('note')} value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorBox error={error} />
      <button className="btn-primary w-full" disabled={busy || !amount || dec(amount).isZero()} onClick={save}>{busy ? t('loading') : t('save')}</button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="flex justify-between"><span className="text-slate-600">{label}</span><span className="tabular-nums">{formatINR(value)}</span></div>;
}
