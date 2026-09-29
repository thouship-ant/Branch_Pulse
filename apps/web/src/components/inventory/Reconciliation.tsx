'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { COUNT_REASON_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { DateNav } from '../DateNav';
import { ErrorBox, Sheet, Skeleton } from '../ui';
import type { LocationOption } from '../purchases/PurchaseForm';
import { fmtQty, toBase, toDisplay } from './qty';

const SIGNIFICANT_PCT = 5; // the shop-wide default; the server decides per item
const clean = (v: string) => v.replace(/[^\d.]/g, '').replace(/^(\d*\.\d{0,3}).*$/, '$1');
// a zero-width space after ₹ gives the browser one soft-wrap point, so an unusually large figure
// wraps onto a second line in a narrow summary tile instead of being cut off or overflowing it
const amt = (v: string) => formatINR(v, { decimals: false }).replace('₹', '₹​');

/** Shortage (below the books), excess (above) or tallied: icon + word, never colour alone. */
export function VarianceBadge({ variance, size = 'sm' }: { variance: string | null; size?: 'sm' | 'md' }) {
  const { t } = useT();
  if (variance === null) return <span className="text-slate-400">—</span>;
  const v = dec(variance);
  const [cls, icon, label] = v.isZero() ? ['border-emerald-300 bg-emerald-50 text-emerald-800', '✓', t('invTallied')]
    : v.isNegative() ? ['border-red-300 bg-red-50 text-red-800', '▼', t('shortage')] : ['border-amber-300 bg-amber-50 text-amber-900', '▲', t('excess')];
  return <span className={`chip ${cls} ${size === 'md' ? 'text-sm' : ''}`}><span aria-hidden>{icon}</span>{label}</span>;
}

/**
 * Daily stock reconciliation for one location: per item, opening + purchases + transfers in - transfers out - consumption - wastage
 * = expected closing, then the physical count and the difference (shortage or excess). Managers enter what was used and what they
 * counted; a significant difference needs a reason and explanation and is approved by the owner.
 */
export function Reconciliation({ locations, fixedLocationId }: { locations: LocationOption[]; fixedLocationId?: string }) {
  const { t, pick } = useT();
  const { can } = useSession();
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [date, setDate] = useState(todayIST());
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState<Record<string, string>>({});
  const [phys, setPhys] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [expl, setExpl] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState<any[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');

  useEffect(() => { if (!locationId && locations[0]) setLocationId(locations[0].id); }, [locations, locationId]);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const d = await api.get(`/stock/reconciliation?locationId=${locationId}&date=${date}`);
      setData(d); setError(null);
      const u: Record<string, string> = {}, p: Record<string, string> = {}, rs: Record<string, string> = {}, ex: Record<string, string> = {};
      for (const r of d.rows as any[]) {
        if (dec(r.consumption).greaterThan(0)) u[r.itemId] = toDisplay(r.consumption, r.displayFactor);
        if (r.physical !== null) p[r.itemId] = toDisplay(r.physical, r.displayFactor);
        if (r.reason) rs[r.itemId] = r.reason;
        if (r.explanation) ex[r.itemId] = r.explanation;
      }
      setUsed(u); setPhys(p); setReason(rs); setExpl(ex);
    } catch (e: any) { setError(e.message); }
  }, [locationId, date]);
  useEffect(() => { setData(null); setNotice(null); setProblems([]); void load(); }, [load]);

  const loadWaiting = useCallback(async () => {
    if (!can('count:approve')) return;
    try { setWaiting(await api.get('/stock/counts?status=SUBMITTED')); } catch { /* ignore */ }
  }, [can]);
  useEffect(() => { void loadWaiting(); }, [loadWaiting, data]);

  const count = data?.count as { id: string; status: string; reviewComment?: string | null; countedBy?: string | null; approvedBy?: string | null } | null | undefined;
  const status = count?.status ?? 'NONE';
  const locked = status === 'SUBMITTED' || status === 'APPROVED';
  const editable = !locked && can('count:enter');

  /** What the row would look like with the numbers typed so far (the server recomputes on save). */
  const calc = useCallback((r: any) => {
    const savedUse = dec(r.consumption);
    const typedUse = used[r.itemId] !== undefined && used[r.itemId] !== '' ? dec(toBase(used[r.itemId], r.displayFactor)) : savedUse;
    const expected = locked ? dec(r.expected) : dec(r.expected).plus(savedUse).minus(typedUse);
    const counted = phys[r.itemId] !== undefined && phys[r.itemId] !== '' ? dec(toBase(phys[r.itemId], r.displayFactor)) : null;
    const variance = locked ? (r.variance === null ? null : dec(r.variance)) : counted === null ? null : counted.minus(expected);
    const pct = variance && expected.greaterThan(0) ? variance.abs().div(expected).mul(100) : null;
    const significant = locked ? !!r.isSignificant : !!variance && !variance.isZero() && (expected.lessThanOrEqualTo(0) || (pct !== null && pct.greaterThan(SIGNIFICANT_PCT))) || !!r.isSignificant;
    return { typedUse, expected, counted, variance, value: variance ? variance.mul(dec(r.avgCost)) : null, significant };
  }, [used, phys, locked]);

  const rows: any[] = data?.rows ?? [];
  const calcs = useMemo(() => new Map(rows.map((r) => [r.itemId, calc(r)])), [rows, calc]);
  const anyCounted = rows.some((r) => phys[r.itemId] !== undefined && phys[r.itemId] !== '');

  async function save(): Promise<boolean> {
    setBusy(true); setError(null); setProblems([]); setNotice(null);
    try {
      const useLines = rows
        .filter((r) => used[r.itemId] !== undefined && used[r.itemId] !== '' && !dec(toBase(used[r.itemId], r.displayFactor)).equals(dec(r.consumption)))
        .map((r) => ({ itemId: r.itemId, quantity: toBase(used[r.itemId], r.displayFactor) }));
      if (useLines.length) await api.put('/stock/consumption', { locationId, businessDate: date, items: useLines });
      const countLines = rows
        .filter((r) => phys[r.itemId] !== undefined && phys[r.itemId] !== '')
        .map((r) => ({ itemId: r.itemId, physicalQty: toBase(phys[r.itemId], r.displayFactor), reason: reason[r.itemId] || undefined, explanation: expl[r.itemId]?.trim() || undefined }));
      if (countLines.length) await api.put(`/stock/counts/${locationId}/${date}`, { items: countLines });
      await load();
      setNotice(t('itemSaved'));
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
      return false;
    } finally { setBusy(false); }
  }

  async function send() {
    if (!(await save())) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/stock/counts/${locationId}/${date}/submit`);
      await load(); setNotice(null);
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) { setError(e.message); setProblems((e.details as any[]).map((d) => d.message)); }
      else setError(e instanceof ApiError ? e.message : 'Could not send');
    } finally { setBusy(false); }
  }

  async function decide(kind: 'approve' | 'reject', id: string, why?: string) {
    setBusy(true); setError(null);
    try {
      await api.post(`/stock/counts/${id}/${kind}`, kind === 'reject' ? { comment: why } : undefined);
      setRejecting(false); setComment('');
      await load(); await loadWaiting();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  const tot = data?.totals;
  const statusChip = status === 'APPROVED' ? ['border-emerald-300 bg-emerald-50 text-emerald-800', '✓', t('countApproved')]
    : status === 'SUBMITTED' ? ['border-amber-300 bg-amber-50 text-amber-900', '◔', t('countSent')]
    : status === 'REJECTED' ? ['border-red-300 bg-red-50 text-red-800', '✕', t('countRejected')]
    : status === 'IN_PROGRESS' ? ['border-slate-300 bg-slate-100 text-slate-700', '○', t('countInProgress')] : null;

  const num = 'w-24 rounded-card border border-slate-300 bg-surface px-2 py-1.5 text-right tabular-nums disabled:bg-slate-100';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {!fixedLocationId && (
            <div className="min-w-[220px]">
              <label htmlFor="rl" className="label">{t('atLocation')}</label>
              <select id="rl" className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
              </select>
            </div>
          )}
          <DateNav id="rdate" date={date} onChange={setDate} />
        </div>
        {statusChip && <span className={`chip ${statusChip[0]}`}><span aria-hidden>{statusChip[1]}</span>{statusChip[2]}{count?.countedBy && ` · ${count.countedBy}`}</span>}
      </div>
      <p className="text-xs text-slate-500">{t('reconHint')}</p>

      {can('count:approve') && waiting.length > 0 && (
        <section className="card space-y-2 border-amber-300" aria-label={t('countsWaiting')}>
          <h3 className="font-semibold">◔ {t('countsWaiting')} ({waiting.length})</h3>
          <ul className="divide-y text-sm">
            {waiting.map((w) => (
              <li key={w.id}>
                <button className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-slate-50" onClick={() => { setLocationId(w.locationId); setDate(String(w.businessDate).slice(0, 10)); }}>
                  <span>{pick(w.locationName, w.locationNameTa)} · {String(w.businessDate).slice(0, 10)}</span>
                  <span className="tabular-nums text-red-700">▼ {formatINR(w.shortageValue, { decimals: false })}{dec(w.excessValue).greaterThan(0) && <span className="ml-2 text-amber-800">▲ {formatINR(w.excessValue, { decimals: false })}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {status === 'REJECTED' && count?.reviewComment && <div role="alert" className="rounded-card border border-red-300 bg-red-50 p-3 text-sm text-red-900">✕ {count.reviewComment}</div>}
      <ErrorBox error={error} />
      {problems.length > 0 && <ul role="alert" className="space-y-1 rounded-card border border-red-300 bg-red-50 p-3 text-sm text-red-900">{problems.map((p, i) => <li key={i}>✕ {p}</li>)}</ul>}

      {!data ? <Skeleton className="h-64" /> : (
        <>
          <section className="grid grid-cols-3 gap-2 lg:grid-cols-5 lg:gap-3" aria-label="Summary">
            <div className="card min-w-0 p-3 lg:p-4"><p className="truncate text-xs text-slate-600 lg:text-sm">{t('colExpected')}</p><p className="break-words text-[15px] font-bold leading-tight tabular-nums lg:text-lg">{amt(tot.expectedValue)}</p></div>
            <div className="card min-w-0 p-3 lg:p-4"><p className="truncate text-xs text-slate-600 lg:text-sm">{t('colActual')}</p><p className="break-words text-[15px] font-bold leading-tight tabular-nums lg:text-lg">{amt(tot.physicalValue)}</p><p className="text-xs text-slate-500">{tot.itemsCounted} / {tot.itemsTotal}</p></div>
            <div className={`card min-w-0 p-3 lg:p-4 ${dec(tot.shortageValue).greaterThan(0) ? 'border-red-300' : ''}`}><p className="truncate text-xs text-slate-600 lg:text-sm">▼ {t('shortage')}</p><p className="break-words text-[15px] font-bold leading-tight tabular-nums lg:text-lg">{amt(tot.shortageValue)}</p><p className="text-xs text-slate-500">{tot.shortages}</p></div>
            <div className={`card min-w-0 p-3 lg:p-4 ${dec(tot.excessValue).greaterThan(0) ? 'border-amber-300' : ''}`}><p className="truncate text-xs text-slate-600 lg:text-sm">▲ {t('excess')}</p><p className="break-words text-[15px] font-bold leading-tight tabular-nums lg:text-lg">{amt(tot.excessValue)}</p><p className="text-xs text-slate-500">{tot.excesses}</p></div>
            <div className="card min-w-0 p-3 lg:p-4"><p className="truncate text-xs text-slate-600 lg:text-sm">{t('colWastage')}</p><p className="break-words text-[15px] font-bold leading-tight tabular-nums lg:text-lg">{amt(tot.wastageValue)}</p></div>
          </section>

          {/* desktop: the formula as a table */}
          <section className="card hidden overflow-x-auto p-0 lg:block" aria-label={t('tabRecon')}>
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{t('itemLabel')}</th>
                  <th scope="col" className="px-2 py-2 text-right">{t('colOpening')}</th>
                  <th scope="col" className="px-2 py-2 text-right">+ {t('colPurchases')}</th>
                  <th scope="col" className="px-2 py-2 text-right">+ {t('colTransIn')}</th>
                  <th scope="col" className="px-2 py-2 text-right">− {t('colTransOut')}</th>
                  <th scope="col" className="px-2 py-2 text-right">− {t('colConsumption')}</th>
                  <th scope="col" className="px-2 py-2 text-right">− {t('colWastage')}</th>
                  <th scope="col" className="px-2 py-2 text-right">= {t('colExpected')}</th>
                  <th scope="col" className="px-2 py-2 text-right">{t('colActual')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('colVariance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y align-top">
                {rows.map((r) => {
                  const c = calcs.get(r.itemId)!;
                  const f = r.displayFactor;
                  const q = (v: string) => (dec(v).isZero() ? <span className="text-slate-300">—</span> : toDisplay(v, f));
                  return (
                    <tr key={r.itemId}>
                      <th scope="row" className="px-3 py-2 text-left font-medium">{pick(r.name, r.nameTa)} <span className="text-xs font-normal text-slate-500">{r.displayUnit}</span><p className="font-mono text-xs font-normal text-slate-500">{r.code}</p></th>
                      <td className="px-2 py-2 text-right tabular-nums">{toDisplay(r.opening, f)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{q(r.purchases)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{q(r.transfersIn)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{q(r.transfersOut)}</td>
                      <td className="px-2 py-2 text-right">
                        <input className={num} inputMode="decimal" placeholder="0" aria-label={`${t('usedToday')} ${r.name}`} disabled={!editable} value={used[r.itemId] ?? ''} onChange={(e) => setUsed((u) => ({ ...u, [r.itemId]: clean(e.target.value) }))} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{q(r.wastage)}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{toDisplay(c.expected.toString(), f)}</td>
                      <td className="px-2 py-2 text-right">
                        <input className={num} inputMode="decimal" placeholder="—" aria-label={`${t('countedQty')} ${r.name}`} disabled={!editable} value={phys[r.itemId] ?? ''} onChange={(e) => setPhys((p) => ({ ...p, [r.itemId]: clean(e.target.value) }))} />
                      </td>
                      <td className="px-3 py-2">
                        {c.variance === null ? <span className="text-xs text-slate-400">{t('notCountedYet')}</span> : (
                          <div className="space-y-1">
                            <VarianceBadge variance={c.variance.toString()} />
                            {!c.variance.isZero() && <p className="text-xs tabular-nums text-slate-600">{c.variance.isNegative() ? '−' : '+'}{toDisplay(c.variance.abs().toString(), f)} {r.displayUnit} · {formatINR(c.value!.abs(), { decimals: false })}</p>}
                            {!c.variance.isZero() && (
                              <ReasonFields r={r} c={c} editable={editable} reason={reason} setReason={setReason} expl={expl} setExpl={setExpl} />
                            )}
                          </div>
                        )}
                        {dec(r.adjustment).greaterThan(0) || dec(r.adjustment).isNegative() ? <p className="text-xs text-slate-500">{t('bookAdjust')} {fmtQty(r.adjustment, f, r.displayUnit)}</p> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* phone: one card per item */}
          <ul className="space-y-3 lg:hidden">
            {rows.map((r) => {
              const c = calcs.get(r.itemId)!;
              const f = r.displayFactor;
              const line = (label: string, v: string, sign: string) => (dec(v).isZero() ? null : <div className="flex justify-between"><span className="text-slate-600">{sign} {label}</span><span className="tabular-nums">{toDisplay(v, f)}</span></div>);
              return (
                <li key={r.itemId} className="card space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{pick(r.name, r.nameTa)} <span className="font-normal text-slate-500">({r.displayUnit})</span></p>
                    <VarianceBadge variance={c.variance === null ? null : c.variance.toString()} />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex justify-between"><span className="text-slate-600">{t('colOpening')}</span><span className="tabular-nums">{toDisplay(r.opening, f)}</span></div>
                    {line(t('colPurchases'), r.purchases, '+')}
                    {line(t('colTransIn'), r.transfersIn, '+')}
                    {line(t('colTransOut'), r.transfersOut, '−')}
                    {line(t('colWastage'), r.wastage, '−')}
                    <div className="flex justify-between border-t pt-1 font-semibold"><span>{t('colExpected')}</span><span className="tabular-nums">{toDisplay(c.expected.toString(), f)}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block"><span className="label">{t('usedToday')}</span>
                      <input className="field text-right tabular-nums" inputMode="decimal" placeholder="0" disabled={!editable} value={used[r.itemId] ?? ''} onChange={(e) => setUsed((u) => ({ ...u, [r.itemId]: clean(e.target.value) }))} />
                    </label>
                    <label className="block"><span className="label">{t('countedQty')}</span>
                      <input className="field text-right tabular-nums" inputMode="decimal" placeholder="—" disabled={!editable} value={phys[r.itemId] ?? ''} onChange={(e) => setPhys((p) => ({ ...p, [r.itemId]: clean(e.target.value) }))} />
                    </label>
                  </div>
                  {c.variance && !c.variance.isZero() && (
                    <>
                      <p className={`tabular-nums ${c.variance.isNegative() ? 'text-red-700' : 'text-amber-800'}`}>{c.variance.isNegative() ? '▼ −' : '▲ +'}{toDisplay(c.variance.abs().toString(), f)} {r.displayUnit} · {formatINR(c.value!.abs(), { decimals: false })}</p>
                      <ReasonFields r={r} c={c} editable={editable} reason={reason} setReason={setReason} expl={expl} setExpl={setExpl} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {notice && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ {notice}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {editable && (
              <>
                <button className="btn-secondary" disabled={busy} onClick={() => void save()}>{busy ? t('loading') : t('saveCount')}</button>
                <button className="btn-primary" disabled={busy || !anyCounted} onClick={send}>{t('submitCount')}</button>
              </>
            )}
            {status === 'SUBMITTED' && can('count:approve') && count && (
              <>
                <button className="btn-primary" disabled={busy} onClick={() => decide('approve', count.id)}>✓ {t('approve')}</button>
                <button className="btn-danger" disabled={busy} onClick={() => setRejecting(true)}>✕ {t('reject')}</button>
              </>
            )}
            {status === 'APPROVED' && count?.approvedBy && <p className="text-sm text-emerald-800">✓ {t('approvedBy')}: {count.approvedBy}</p>}
          </div>
        </>
      )}

      <Sheet open={rejecting} onClose={() => setRejecting(false)} title={t('reject')}>
        <div className="space-y-3">
          <label htmlFor="rc" className="label">{t('comment')} *</label>
          <textarea id="rc" className="field min-h-[96px] py-2" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRejecting(false)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={!comment.trim() || busy} onClick={() => count && decide('reject', count.id, comment)}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

/** Reason chips and an explanation for a counted difference; required when it is significant. */
function ReasonFields({ r, c, editable, reason, setReason, expl, setExpl }: {
  r: any; c: { significant: boolean }; editable: boolean; reason: Record<string, string>; setReason: (f: (x: Record<string, string>) => Record<string, string>) => void;
  expl: Record<string, string>; setExpl: (f: (x: Record<string, string>) => Record<string, string>) => void;
}) {
  const { t } = useT();
  if (!editable && !reason[r.itemId] && !expl[r.itemId]) return null;
  return (
    <div className="space-y-1.5 pt-1">
      {c.significant && editable && <p className="whitespace-normal text-xs font-semibold text-red-800">{t('reasonNeeded')} *</p>}
      {editable ? (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('reasonLabel2')}>
          {Object.keys(COUNT_REASON_KEY).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={reason[r.itemId] === k} onClick={() => setReason((x) => ({ ...x, [r.itemId]: k }))}
              className={`min-h-[32px] rounded-card border px-2 text-xs ${reason[r.itemId] === k ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-surface'}`}>{reason[r.itemId] === k && '✓ '}{t(COUNT_REASON_KEY[k])}</button>
          ))}
        </div>
      ) : reason[r.itemId] ? <p className="text-xs">{t(COUNT_REASON_KEY[reason[r.itemId]] ?? 'crOther')}</p> : null}
      {editable ? (
        <textarea aria-label={t('explanationLabel')} placeholder={t('explanationLabel')} className="field min-h-[56px] py-1.5 text-sm" value={expl[r.itemId] ?? ''} onChange={(e) => setExpl((x) => ({ ...x, [r.itemId]: e.target.value }))} />
      ) : expl[r.itemId] ? <p className="whitespace-pre-wrap text-xs text-slate-600">“{expl[r.itemId]}”</p> : null}
    </div>
  );
}
