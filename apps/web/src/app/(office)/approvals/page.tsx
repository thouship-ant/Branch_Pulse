'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Sheet, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { MODE_KEY } from '@/lib/labels';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useLive } from '@/lib/live';

function age(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? '<1h' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** A square tick box that is easy to hit and clearly shows "selected". */
function Tick({ checked, onChange, label, partial }: { checked: boolean; onChange: () => void; label: string; partial?: boolean }) {
  return (
    <label className="relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl transition hover:bg-slate-100">
      <input type="checkbox" aria-label={label} checked={checked} onChange={onChange} className="peer sr-only" />
      <span className={`grid h-[22px] w-[22px] place-items-center rounded-md border-2 transition peer-focus-visible:ring-4 peer-focus-visible:ring-brand/20 ${checked || partial ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-surface'}`}>
        {checked ? <Icon name="tick" size={14} strokeWidth={3.2} /> : partial ? <span className="h-0.5 w-2.5 rounded bg-white" /> : null}
      </span>
    </label>
  );
}

export default function Approvals() {
  const { t, pick } = useT();
  const { me, can } = useSession();
  // closings and missed-day requests are decided by the Admin only; others never see those tabs
  const showClosing = can('closing:approve');
  const showBackdate = can('closing:reopen');
  const [tab, setTab] = useState<'expenses' | 'closing' | 'backdate'>('expenses');
  const [requests, setRequests] = useState<any[] | null>(null);
  const [deciding, setDeciding] = useState<{ r: any; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [rowsAll, setRows] = useState<any[] | null>(null);
  const [closingsAll, setClosings] = useState<any[] | null>(null);
  // an approval waits 5 seconds so it can be undone: the row disappears at once, the server call follows (UX-06)
  const [hidden, setHidden] = useState<string[]>([]);
  const [toast, setToast] = useState<{ id: string; label: string } | null>(null);
  const timers = useRef(new Map<string, { run: () => Promise<void>; t: ReturnType<typeof setTimeout> }>());
  const rows = rowsAll ? rowsAll.filter((e) => !hidden.includes(e.id)) : null;
  const closings = closingsAll ? closingsAll.filter((c) => !hidden.includes(c.closingId)) : null;
  const params = useSearchParams();
  useEffect(() => { const k = params.get('tab'); if ((k === 'closing' && showClosing) || (k === 'backdate' && showBackdate) || k === 'expenses') setTab(k); }, [params, showClosing, showBackdate]);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // tick boxes + bulk actions (a separate selection per tab)
  const [pickedExp, setPickedExp] = useState<string[]>([]);
  const [pickedCl, setPickedCl] = useState<string[]>([]);
  const [bulk, setBulk] = useState<'approve' | 'reject' | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [report, setReport] = useState<{ ok: number; failed: string[] } | null>(null);
  const ids = tab === 'expenses' ? (rows ?? []).map((e) => e.id as string) : tab === 'closing' ? (closings ?? []).map((c) => c.closingId as string) : [];
  const picked = (tab === 'expenses' ? pickedExp : pickedCl).filter((id) => ids.includes(id));
  const setPicked = tab === 'expenses' ? setPickedExp : setPickedCl;
  const allPicked = ids.length > 0 && picked.length === ids.length;
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const load = useCallback(async () => {
    try {
      const [ex, cl, bd] = await Promise.all([api.get('/expenses?status=SUBMITTED&pageSize=100'), api.get('/closings/awaiting').catch(() => []), api.get('/backdate-requests?status=PENDING').catch(() => [])]);
      setRows(ex); setClosings(cl); setRequests(bd as any[]); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLive(load, ['EXPENSE', 'DAILY_CLOSING', 'BACKDATE_REQUEST']);

  const branch = (id: string) => {
    const l = me?.locations.find((x) => x.id === id);
    return pick(l?.name, l?.nameTa);
  };

  /** Approve with a 5-second undo: the row leaves the list now, and the server is told when the time is up (or when you leave the page). */
  function queueApprove(id: string, label: string, call: () => Promise<unknown>) {
    setHidden((h) => [...h, id]);
    setToast({ id, label });
    const run = async () => {
      timers.current.delete(id);
      try { await call(); }
      catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
      finally { setHidden((h) => h.filter((x) => x !== id)); await load(); window.dispatchEvent(new Event('bp:attention')); }
    };
    const t = setTimeout(() => { setToast((cur) => (cur?.id === id ? null : cur)); void run(); }, 5000);
    timers.current.set(id, { run, t });
  }
  function undo() {
    if (!toast) return;
    const q = timers.current.get(toast.id);
    if (q) { clearTimeout(q.t); timers.current.delete(toast.id); }
    setHidden((h) => h.filter((x) => x !== toast.id));
    setToast(null);
  }
  // leaving the page must not lose an approval that is still counting down
  useEffect(() => () => { for (const q of timers.current.values()) { clearTimeout(q.t); void q.run(); } }, []);

  const approve = (id: string) => { const e = rowsAll?.find((x) => x.id === id); if (e) queueApprove(id, `${e.code} · ${formatINR(e.amount)}`, () => api.post(`/expenses/${id}/approve`)); };
  const approveClosing = (id: string) => { const c = closingsAll?.find((x) => x.closingId === id); if (c) queueApprove(id, `${pick(c.locationName, c.locationNameTa)} · ${prettyDate(String(c.businessDate).slice(0, 10))}`, () => api.post(`/closings/${id}/approve`, {})); };

  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try {
      if (rejecting.closingId) await api.post(`/closings/${rejecting.closingId}/reject`, { comment: reason });
      else await api.post(`/expenses/${rejecting.id}/reject`, { reason });
      setRejecting(null); setReason(''); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  /** Runs the action on every ticked item one after the other and reports how many went through. */
  async function runBulk() {
    if (!bulk) return;
    setBusy('bulk');
    let ok = 0;
    const failed: string[] = [];
    for (const id of picked) {
      const label = tab === 'expenses' ? rows?.find((e) => e.id === id)?.code : closings?.find((c) => c.closingId === id)?.locationName;
      try {
        if (tab === 'expenses') await api.post(`/expenses/${id}/${bulk}`, bulk === 'reject' ? { reason: bulkReason } : undefined);
        else await api.post(`/closings/${id}/${bulk}`, bulk === 'reject' ? { comment: bulkReason } : {});
        ok++;
      } catch (e) { failed.push(`${label ?? id}: ${e instanceof ApiError ? e.message : 'Failed'}`); }
    }
    setBulk(null); setBulkReason(''); setPicked([]); setBusy(null);
    setReport({ ok, failed });
    await load();
  }

  async function decide() {
    if (!deciding) return;
    setBusy('decide');
    try {
      await api.post(`/backdate-requests/${deciding.r.id}/${deciding.approve ? 'approve' : 'reject'}`, { note: note.trim() || undefined });
      setDeciding(null); setNote(''); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
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

  const empty = (
    <p role="status" className="flex items-center gap-3 rounded-card border border-emerald-300 bg-emerald-50 px-4 py-4 font-medium text-emerald-900">
      <Icon name="checkCircle" size={22} />{t('noExceptions')}
    </p>
  );
  const rowCls = (on: boolean) =>
    `card grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-3 !p-3 transition sm:grid-cols-[auto_1fr_8.5rem_auto] sm:gap-x-4 sm:!px-4 ${on ? 'border-brand/60 bg-brand-light/50 ring-2 ring-brand/30' : ''}`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">{t('approvals')}</h2>
        <p className="text-sm text-slate-600">{tab === 'expenses' ? t('expenses') : tab === 'closing' ? t('closings') : t('bdTab')}</p>
      </div>
      <div role="tablist" className="flex gap-2 tabs-pills">
        {([['expenses', t('expenses'), rows?.length ?? 0], ['closing', t('closings'), closings?.length ?? 0], ['backdate', t('bdTab'), requests?.length ?? 0]] as const).filter(([k]) => (k === 'closing' ? showClosing : k === 'backdate' ? showBackdate : true)).map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}{n > 0 ? <><span className="ml-2 hidden rounded-full bg-white/25 px-2 py-0.5 text-xs md:inline">{n}</span><span className="md:hidden"> ({n})</span></> : null}
          </button>
        ))}
      </div>
      <Sheet open={!!error} onClose={() => setError(null)} title={t('errorTitle')}>
        <p role="alert" className="text-sm text-slate-700">{error}</p>
        <div className="mt-4 flex justify-end">
          <button className="btn-primary min-h-[44px] px-6" autoFocus onClick={() => setError(null)}>{t('ok')}</button>
        </div>
      </Sheet>

      {ids.length > 0 && (
        <div className="card sticky top-[68px] z-20 flex flex-nowrap items-center gap-x-3 !p-2 sm:!px-4">
          <div className="flex items-center gap-1">
            <Tick checked={allPicked} partial={picked.length > 0 && !allPicked} onChange={() => setPicked(allPicked ? [] : ids)} label={t('selectAll')} />
            <span className="whitespace-nowrap font-semibold">{t('selectAll')}</span>
          </div>
          <span className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-sm tabular-nums text-slate-700"><b>{picked.length}</b> / {ids.length}</span>
          <div className="ml-auto flex flex-nowrap gap-2">
            <button type="button" className="inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-3 text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={picked.length === 0 || busy !== null} onClick={() => setBulk('approve')} aria-label={allPicked ? t('approveAll') : t('approveSelected')} title={allPicked ? t('approveAll') : t('approveSelected')}><Icon name="thumbsUp" size={22} />{picked.length > 0 && <span className="text-sm font-bold tabular-nums">{picked.length}</span>}</button>
            <button type="button" className="inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full border-2 border-red-300 bg-red-50 px-3 text-red-700 transition hover:bg-red-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={picked.length === 0 || busy !== null} onClick={() => { setBulkReason(''); setBulk('reject'); }} aria-label={allPicked ? t('rejectAll') : t('rejectSelected')} title={allPicked ? t('rejectAll') : t('rejectSelected')}><Icon name="thumbsDown" size={22} />{picked.length > 0 && <span className="text-sm font-bold tabular-nums">{picked.length}</span>}</button>
          </div>
        </div>
      )}

      {tab === 'backdate' ? (
        !requests ? <Skeleton className="h-64" /> : requests.length === 0 ? empty : (
          <ul className="space-y-2.5">
            {requests.map((r) => (
              <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 !p-3 sm:!px-4">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-base font-bold">{pick(r.locationName, r.locationNameTa)} · {prettyDate(String(r.businessDate).slice(0, 10))}</p>
                  <p className="text-sm text-slate-600">{r.requestedByName} <span className="text-slate-400">({r.requestedByUsername})</span> · ⏱ {age(r.createdAt)}</p>
                  <p className="text-sm">“{r.reason}”</p>
                </div>
                <div className="flex w-full justify-end gap-3 sm:w-auto">
                  <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy !== null} onClick={() => { setNote(''); setDeciding({ r, approve: true }); }} aria-label={t('approve')} title={t('approve')}><Icon name="thumbsUp" size={22} /></button>
                  <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-red-300 bg-red-50 text-red-700 transition hover:bg-red-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy !== null} onClick={() => { setNote(''); setDeciding({ r, approve: false }); }} aria-label={t('reject')} title={t('reject')}><Icon name="thumbsDown" size={22} /></button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : tab === 'closing' ? (
        !closings ? <Skeleton className="h-64" /> : closings.length === 0 ? empty : (
          <ul className="space-y-2.5">
            {closings.map((c) => {
              const day = String(c.businessDate).slice(0, 10);
              const off = c.cashVariance != null && Number(c.cashVariance) !== 0;
              return (
                <li key={c.closingId} className={rowCls(picked.includes(c.closingId)).replace('grid-cols-[auto_1fr]', 'grid-cols-[auto_1fr_auto]')}>
                  <Tick checked={picked.includes(c.closingId)} onChange={() => toggle(c.closingId)} label={t('selectAll')} />
                  <div className="min-w-0">
                      <p className="truncate text-base font-bold">{pick(c.locationName, c.locationNameTa)}</p>
                      <p className="text-sm text-slate-600">{prettyDate(day)}{c.submittedAt ? <span className="text-slate-400"> · ⏱ {age(c.submittedAt)}</span> : null}</p>
                      {off && <p className="mt-0.5 text-xs font-semibold text-amber-800">{t('difference')} {formatINR(c.cashVariance)}</p>}
                    </div>
                  <div className="text-right">
                      <p className="text-xs text-slate-500">{t('sales')}</p>
                      <p className="text-lg font-extrabold tabular-nums">{c.totalSales != null ? formatINR(c.totalSales) : '—'}</p>
                    </div>
                  <div className="col-span-3 flex flex-wrap items-center justify-end gap-3 sm:col-span-1">
                    <Link href={`/closings/${c.locationId}/${day}`} className="btn-secondary flex min-h-[42px] flex-1 items-center justify-center px-4 text-sm sm:flex-none">{t('view')}</Link>
                    <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy === c.closingId} onClick={() => approveClosing(c.closingId)} aria-label={t('approve')} title={t('approve')}><Icon name="thumbsUp" size={22} /></button>
                    <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-red-300 bg-red-50 text-red-700 transition hover:bg-red-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy === c.closingId} onClick={() => { setReason(''); setRejecting({ ...c, id: c.closingId, code: `${c.locationCode} ${day}` }); }} aria-label={t('reject')} title={t('reject')}><Icon name="thumbsDown" size={22} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : !rows ? <Skeleton className="h-64" /> : rows.length === 0 ? empty : (
        <ul className="space-y-2.5">
          {rows.map((e) => (
            <li key={e.id} className={rowCls(picked.includes(e.id)).replace('grid-cols-[auto_1fr]', 'grid-cols-[auto_1fr_auto] items-start sm:items-center')}>
              <Tick checked={picked.includes(e.id)} onChange={() => toggle(e.id)} label={t('selectAll')} />
              <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-base font-bold">{pick(e.categoryName, e.categoryNameTa)}</span>
                    <span className="chip border-slate-300 bg-slate-100 !py-0.5 text-xs text-slate-700">{MODE_KEY[e.paymentMode] ? t(MODE_KEY[e.paymentMode]) : e.paymentMode}</span>
                  </p>
                  <p className="text-sm text-slate-600">{branch(e.locationId)} · {prettyDate(e.businessDate)}{e.payeeName ? ` · ${e.payeeName}` : ''}</p>
                  {e.description && <p className="text-sm font-medium text-slate-800">“{e.description}”</p>}
                  {e.receiptCount === 0 && Number(e.amount) > 500 && <p className="text-xs font-semibold text-red-700">⚠ {t('noReceiptWarn')}</p>}
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                    <span className="font-mono">{e.code}</span><span>⏱ {age(e.createdAt)}</span>
                    <button
                      type="button" onClick={() => viewReceipt(e.id)}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold transition ${e.receiptCount === 0 ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-brand-light text-brand hover:brightness-95'}`}
                    >
                      <span aria-hidden>🧾</span>{e.receiptCount === 0 ? t('noReceipt') : t('receipt')}
                    </button>
                  </p>
                </div>
              <div className="flex flex-col items-end gap-2.5 sm:contents"><p className="text-xl font-extrabold tabular-nums sm:text-right">{formatINR(e.amount)}</p>
              <div className="flex justify-end gap-2 sm:col-span-1 sm:gap-3">
                <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy === e.id} onClick={() => approve(e.id)} aria-label={t('approve')} title={t('approve')}><Icon name="thumbsUp" size={22} /></button>
                <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-red-300 bg-red-50 text-red-700 transition hover:bg-red-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy === e.id} onClick={() => setRejecting(e)} aria-label={t('reject')} title={t('reject')}><Icon name="thumbsDown" size={22} /></button>
              </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <div role="status" className="anim-fade fixed bottom-20 left-1/2 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-xl bg-emerald-900 px-4 py-3 text-sm text-white shadow-xl md:bottom-6 md:left-auto md:right-6 md:translate-x-0">
          <span className="min-w-0 flex-1 truncate">✓ {t('approvedToast')}: {toast.label}</span>
          <button type="button" className="shrink-0 rounded-md px-2 py-1 font-bold text-amber-200 hover:bg-white/10" onClick={undo}>{t('undoLabel')}</button>
        </div>
      )}
      <Sheet open={!!deciding} onClose={() => setDeciding(null)} title={`${deciding?.approve ? t('approve') : t('reject')} · ${deciding ? prettyDate(String(deciding.r.businessDate).slice(0, 10)) : ''}`}>
        <div className="space-y-3">
          <label htmlFor="bdn" className="label">{deciding?.approve ? t('comment') : `${t('reason')} *`}</label>
          <textarea id="bdn" className="field min-h-[80px] py-2" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDeciding(null)}>{t('cancel')}</button>
            <button className={deciding?.approve ? 'btn-primary' : 'btn-danger'} disabled={busy !== null || (!deciding?.approve && !note.trim())} onClick={decide}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!bulk} onClose={() => setBulk(null)} title={`${bulk === 'approve' ? (allPicked ? t('approveAll') : t('approveSelected')) : allPicked ? t('rejectAll') : t('rejectSelected')} (${picked.length})`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-700">{bulk === 'approve' ? t('bulkConfirmApprove') : t('bulkConfirmReject')}</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm">
            {picked.map((id) => <li key={id}>{tab === 'expenses' ? (() => { const e = rows?.find((x) => x.id === id); return e ? `${e.code} · ${formatINR(e.amount)}` : id; })() : (() => { const c = closings?.find((x) => x.closingId === id); return c ? `${pick(c.locationName, c.locationNameTa)} · ${prettyDate(c.businessDate)}` : id; })()}</li>)}
          </ul>
          {bulk === 'reject' && (<><label htmlFor="br" className="label">{t('reason')} *</label><textarea id="br" className="field min-h-[96px] py-2" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} /></>)}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setBulk(null)}>{t('cancel')}</button>
            <button className={bulk === 'reject' ? 'btn-danger' : 'btn-primary'} disabled={busy !== null || (bulk === 'reject' && !bulkReason.trim())} onClick={runBulk}>{busy === 'bulk' ? t('loading') : t('confirm')}</button>
          </div>
        </div>
      </Sheet>
      <Sheet open={!!report} onClose={() => setReport(null)} title={t('bulkDone')}>
        {report && (
          <div className="space-y-3">
            <p className="text-sm"><b className="text-emerald-700">✓ {report.ok}</b> {t('itemsWord')}{report.failed.length > 0 && <> · <b className="text-red-700">✕ {report.failed.length}</b> {t('bulkFailed')}</>}</p>
            {report.failed.length > 0 && <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-red-50 p-3 text-sm text-red-900">{report.failed.map((f) => <li key={f}>{f}</li>)}</ul>}
            <div className="flex justify-end"><button className="btn-primary min-h-[44px] px-6" autoFocus onClick={() => setReport(null)}>{t('ok')}</button></div>
          </div>
        )}
      </Sheet>

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
