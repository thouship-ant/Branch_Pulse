'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { VarianceChip, varianceTone } from '@/components/cash/parts';
import { VarianceReport } from '@/components/cash/VarianceReport';
import { DateNav } from '@/components/DateNav';
import { ErrorBox, Sheet, Skeleton, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

type Tab = 'daily' | 'report';

/** Owner / accountant: every branch's cash for a day (approve or reject differences), and the variance report. */
export default function CashPage() {
  const { t } = useT();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('daily');
  if (!can('cash:view')) return <p className="card">{t('noAccess')}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('cashRecon')}</h2>
      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {([['daily', t('tabDaily')], ['report', t('varianceReport')]] as Array<[Tab, string]>).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-touch border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {tab === 'daily' ? <Daily /> : <VarianceReport linkRows />}
    </div>
  );
}

function Daily() {
  const { t, pick } = useT();
  const { can } = useSession();
  const [date, setDate] = useState(todayIST());
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.get(`/cash/overview?date=${date}`)); setError(null); } catch (e: any) { setError(e.message); }
  }, [date]);
  useEffect(() => { setData(null); void load(); }, [load]);

  async function approve(id: string) {
    setBusy(id);
    try { await api.post(`/cash/reconciliation/${id}/approve`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }
  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.reconId);
    try { await api.post(`/cash/reconciliation/${rejecting.reconId}/reject`, { comment }); setRejecting(null); setComment(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  const tot = data?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateNav id="cd" date={date} onChange={setDate} />
      </div>
      <ErrorBox error={error} />
      {!data ? <Skeleton className="h-64" /> : (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="card"><p className="text-sm text-slate-600">{t('expectedCash')}</p><p className="text-xl font-bold tabular-nums">{formatINR(tot.expected, { decimals: false })}</p></div>
            <div className="card"><p className="text-sm text-slate-600">{t('actualCash')}</p><p className="text-xl font-bold tabular-nums">{formatINR(tot.actual, { decimals: false })}</p><p className="text-xs text-slate-500">{tot.branchesCounted} / {data.rows.length}</p></div>
            <div className={`card ${dec(tot.netVariance).isNegative() ? 'border-red-300' : ''}`}><p className="text-sm text-slate-600">{t('netVariance')}</p><p className="text-xl font-bold tabular-nums">{dec(tot.netVariance).isNegative() ? '▼ ' : dec(tot.netVariance).isZero() ? '' : '▲ '}{formatINR(dec(tot.netVariance).abs(), { decimals: false })}</p><p className="text-xs text-slate-500">{tot.shortages} {t('shortage')} · {tot.surpluses} {t('surplus')}</p></div>
            <div className={`card ${tot.awaitingApproval ? 'border-amber-300' : ''}`}><p className="text-sm text-slate-600">{t('awaiting')}</p><p className="text-xl font-bold tabular-nums">{tot.awaitingApproval}</p></div>
          </section>

          <section className="card overflow-x-auto p-0" aria-label={t('cashRecon')}>
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{t('branch')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('openingCash')}</th>
                  <th scope="col" className="px-3 py-2 text-right">+ {t('cash')} {t('sales')}</th>
                  <th scope="col" className="px-3 py-2 text-right">+ {t('otherReceipts')}</th>
                  <th scope="col" className="px-3 py-2 text-right">− {t('expenses')}</th>
                  <th scope="col" className="px-3 py-2 text-right">− {t('withdrawals')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('expectedCash')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('actualCash')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('variance')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{t('closing')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.map((r: any) => {
                  const v = r.variance === null ? null : dec(r.variance);
                  const tone = v ? varianceTone(v) : null;
                  const other = dec(r.otherCashOut).plus(r.cashPurchases); // supplier / advances / purchases paid from the till
                  return (
                    <tr key={r.locationId} className="align-top hover:bg-slate-50">
                      <th scope="row" className="px-3 py-3 text-left font-medium">
                        <Link className="hover:underline" href={`/cash/${r.locationId}/${date}`}>{pick(r.name, r.nameTa)}</Link>
                        <p className="font-mono text-xs font-normal text-slate-500">{r.code}</p>
                      </th>
                      <td className="px-3 py-3 text-right tabular-nums">{formatINR(r.openingCash, { decimals: false })}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatINR(r.cashSales, { decimals: false })}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatINR(r.otherReceipts, { decimals: false })}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatINR(r.cashExpenses, { decimals: false })}{!other.isZero() && <p className="text-xs text-slate-500">+ {formatINR(other, { decimals: false })}</p>}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatINR(r.withdrawals, { decimals: false })}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatINR(r.expectedClosing, { decimals: false })}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.actualClosing === null ? <span className="text-slate-500">{t('notCounted')}</span> : formatINR(r.actualClosing, { decimals: false })}</td>
                      <td className="px-3 py-3">
                        {v && tone ? (
                          <div className="space-y-1">
                            <span className={`chip ${tone.cls}`}><span aria-hidden>{tone.icon}</span>{t(tone.key)}{!v.isZero() && ` ${formatINR(v.abs(), { decimals: false })}`}</span>
                            {r.varianceApproval && <div><VarianceChip status={r.varianceApproval} /></div>}
                            {r.varianceApproval === 'SUBMITTED' && can('cash:approve') && (
                              <div className="flex gap-2 pt-1">
                                <button className="btn-primary min-h-[36px] px-3 text-sm" disabled={busy === r.reconId} onClick={() => approve(r.reconId)}>✓ {t('approve')}</button>
                                <button className="btn-danger min-h-[36px] px-3 text-sm" disabled={busy === r.reconId} onClick={() => setRejecting(r)}>✕ {t('reject')}</button>
                              </div>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-3"><StatusPill status={r.closingStatus} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={rejecting ? `${t('reject')} · ${rejecting.name}` : ''}>
        <div className="space-y-3">
          <label htmlFor="rc" className="label">{t('comment')} *</label>
          <textarea id="rc" className="field min-h-[96px] py-2" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRejecting(null)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={!comment.trim() || busy !== null} onClick={reject}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
