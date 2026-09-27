'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { TRANSFER_STATUS_KEY } from '@/lib/labels';
import { cleanAmount, dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import type { LocationOption } from '../purchases/PurchaseForm';
import { ErrorBox, Sheet, Skeleton, TextField } from '../ui';
import { fmtQty, toBase, toDisplay } from './qty';

const day = (d: unknown) => String(d).slice(0, 10);

function TransferChip({ status }: { status: string }) {
  const { t } = useT();
  const [cls, icon] =
    status === 'RECEIVED' ? ['border-emerald-300 bg-emerald-50 text-emerald-800', '✓']
    : status === 'PARTIALLY_RECEIVED' ? ['border-amber-300 bg-amber-50 text-amber-900', '▲']
    : status === 'DISPATCHED' ? ['border-blue-300 bg-blue-50 text-blue-800', '➜']
    : status === 'CANCELLED' ? ['border-slate-300 bg-slate-100 text-slate-500', '✕']
    : status === 'APPROVED' ? ['border-slate-300 bg-slate-100 text-slate-700', '○'] : ['border-amber-300 bg-amber-50 text-amber-900', '◔'];
  return <span className={`chip ${cls}`}><span aria-hidden>{icon}</span>{t(TRANSFER_STATUS_KEY[status] ?? 'trPending')}</span>;
}

interface Line { key: number; itemId: string; unitId: string; qty: string }
let lineKey = 1;

/** Move stock between the warehouse and branches: request, approve, send (stock leaves), receive (stock arrives; short quantity needs a reason). */
export function TransfersPanel({ locations, fixedLocationId }: { locations: LocationOption[]; fixedLocationId?: string }) {
  const { t, pick } = useT();
  const { can, me } = useSession();
  const [rows, setRows] = useState<any[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [got, setGot] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [boot, setBoot] = useState<any>(null);
  // create form
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: lineKey++, itemId: '', unitId: '', qty: '' }]);
  const [vehicle, setVehicle] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const mine = (id: string) => !!me?.locations.some((l) => l.id === id);
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (fixedLocationId) p.set('locationId', fixedLocationId);
      if (status) p.set('status', status);
      setRows(await api.get(`/transfers?${p}`)); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [fixedLocationId, status]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.get('/sync/bootstrap').then(setBoot).catch(() => undefined); }, []);

  const items = ((boot?.items ?? []) as any[]).filter((i) => i.status === 'ACTIVE');
  const unitsFor = (itemId: string) => { const it = items.find((i) => i.id === itemId); return it ? ((boot?.units ?? []) as any[]).filter((u) => u.id === it.baseUnitId || u.baseUnitId === it.baseUnitId) : []; };

  async function open(id: string) {
    try { setDetail(await api.get(`/transfers/${id}`)); } catch (e: any) { setError(e.message); }
  }
  async function act(kind: 'approve' | 'dispatch' | 'cancel') {
    setBusy(true); setError(null);
    try { await api.post(`/transfers/${detail.id}/${kind}`, kind === 'cancel' ? {} : undefined); setDetail(null); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }
  function startReceive() {
    const g: Record<string, string> = {};
    for (const i of detail.items) g[i.itemId] = toDisplay(i.sentQty, i.displayFactor);
    setGot(g); setWhy({}); setReceiving(true); setFormError(null);
  }
  async function receive() {
    setBusy(true); setFormError(null);
    try {
      await api.post(`/transfers/${detail.id}/receive`, { items: detail.items.map((i: any) => ({ itemId: i.itemId, receivedQty: toBase(got[i.itemId] ?? '0', i.displayFactor), reason: why[i.itemId]?.trim() || undefined })) });
      setReceiving(false); setDetail(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }
  async function create() {
    setBusy(true); setFormError(null);
    try {
      await api.post('/transfers', {
        fromLocationId: from, toLocationId: to, businessDate: todayIST(), vehicleRef: vehicle.trim() || undefined, remarks: remarks.trim() || undefined,
        items: lines.filter((l) => l.itemId && dec(l.qty).greaterThan(0)).map((l) => ({ itemId: l.itemId, unitId: l.unitId, quantity: dec(l.qty).toString() })),
      });
      setCreating(false); setLines([{ key: lineKey++, itemId: '', unitId: '', qty: '' }]); setVehicle(''); setRemarks(''); await load();
    } catch (e) { setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Failed'); }
    finally { setBusy(false); }
  }

  const lname = (t2: any, which: 'from' | 'to') => pick(which === 'from' ? t2.fromLocationName : t2.toLocationName, which === 'from' ? t2.fromLocationNameTa : t2.toLocationNameTa);
  const short = detail && receiving ? detail.items.some((i: any) => dec(toBase(got[i.itemId] ?? '0', i.displayFactor)).lessThan(dec(i.sentQty))) : false;
  const canReceiveNow = detail && detail.status === 'DISPATCHED' && can('transfer:receive') && mine(detail.toLocationId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[200px]">
          <label htmlFor="tst" className="label">{t('status')}</label>
          <select id="tst" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            {['PENDING_APPROVAL', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'PARTIALLY_RECEIVED', 'CANCELLED'].map((s) => <option key={s} value={s}>{t(TRANSFER_STATUS_KEY[s])}</option>)}
          </select>
        </div>
        {can('transfer:create') && <button className="btn-primary" onClick={() => { setFormError(null); setCreating(true); }}>+ {t('newTransfer')}</button>}
      </div>
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? <p className="card text-slate-600">{t('noTransfers')}</p> : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const incoming = r.status === 'DISPATCHED' && mine(r.toLocationId);
            return (
              <li key={r.id}>
                <button className={`card flex w-full flex-wrap items-center justify-between gap-2 text-left hover:border-brand ${incoming ? 'border-blue-300' : ''}`} onClick={() => open(r.id)}>
                  <div className="min-w-0">
                    <p className="font-medium">{lname(r, 'from')} <span aria-hidden>➜</span> {lname(r, 'to')}</p>
                    <p className="text-xs text-slate-500">{r.code} · {prettyDate(day(r.businessDate))}{r.vehicleRef ? ` · ${r.vehicleRef}` : ''}</p>
                    <p className="truncate text-xs text-slate-600">{(r.items as any[]).map((i) => `${pick(i.itemName, i.itemNameTa)} ${toDisplay(i.sentQty, i.displayFactor)} ${i.displayUnit}`).join(', ')}</p>
                  </div>
                  <div className="text-right"><TransferChip status={r.status} />{dec(r.lostValue).greaterThan(0) && <p className="mt-1 text-xs text-red-700">▼ {t('lostInTransit')}: {formatINR(r.lostValue, { decimals: false })}</p>}{incoming && <p className="mt-1 text-xs font-semibold text-blue-800">{t('toReceive')}</p>}</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!detail && !receiving} onClose={() => setDetail(null)} title={detail ? `${t('transferDetails')} · ${detail.code}` : ''}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2"><p className="font-medium">{lname(detail, 'from')} ➜ {lname(detail, 'to')}</p><TransferChip status={detail.status} /></div>
            <ul className="divide-y rounded-card border border-slate-200">
              {(detail.items as any[]).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>{pick(i.itemName, i.itemNameTa)}</span>
                  <span className="text-right tabular-nums">{fmtQty(i.sentQty, i.displayFactor, i.displayUnit)}
                    {i.receivedQty !== null && dec(i.receivedQty).lessThan(dec(i.sentQty)) && <span className="block text-xs text-red-700">{t('receivedQty')} {fmtQty(i.receivedQty, i.displayFactor, i.displayUnit)}{i.varianceReason ? ` · ${i.varianceReason}` : ''}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              {detail.requestedByName && `${detail.requestedByName}`}{detail.approvedByName && ` · ${t('approvedBy')}: ${detail.approvedByName}`}{detail.dispatchedByName && ` · ${t('dispatchAction')}: ${detail.dispatchedByName}`}{detail.receivedByName && ` · ${t('receiveAction')}: ${detail.receivedByName}`}
            </p>
            {detail.vehicleRef && <p><span className="text-slate-500">{t('vehicleRef')}:</span> {detail.vehicleRef}</p>}
            {detail.remarks && <p className="rounded-card bg-slate-50 px-3 py-2">{detail.remarks}</p>}
            {dec(detail.lostValue).greaterThan(0) && <p className="text-red-800">▼ {t('lostInTransit')}: {formatINR(detail.lostValue)}</p>}
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {detail.status === 'PENDING_APPROVAL' && can('transfer:approve') && <button className="btn-primary" disabled={busy} onClick={() => act('approve')}>✓ {t('approve')}</button>}
              {detail.status === 'APPROVED' && can('transfer:dispatch') && mine(detail.fromLocationId) && <button className="btn-primary" disabled={busy} onClick={() => act('dispatch')}>➜ {t('dispatchAction')}</button>}
              {canReceiveNow && <button className="btn-primary" disabled={busy} onClick={startReceive}>✓ {t('receiveAction')}</button>}
              {['PENDING_APPROVAL', 'APPROVED'].includes(detail.status) && can('transfer:create') && <button className="btn-secondary" disabled={busy} onClick={() => act('cancel')}>{t('cancelEntry')}</button>}
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={receiving} onClose={() => setReceiving(false)} title={detail ? `${t('receiveAction')} · ${detail.code}` : ''}>
        {detail && (
          <div className="space-y-3">
            {(detail.items as any[]).map((i) => {
              const lessNow = dec(toBase(got[i.itemId] ?? '0', i.displayFactor)).lessThan(dec(i.sentQty));
              return (
                <div key={i.id} className="space-y-1.5 rounded-card border border-slate-200 p-3">
                  <p className="flex justify-between font-medium"><span>{pick(i.itemName, i.itemNameTa)}</span><span className="text-sm font-normal text-slate-500">{t('sentQty')}: {fmtQty(i.sentQty, i.displayFactor, i.displayUnit)}</span></p>
                  <label className="block"><span className="label">{t('receivedQty')} ({i.displayUnit})</span>
                    <input className="field text-right tabular-nums" inputMode="decimal" value={got[i.itemId] ?? ''} onChange={(e) => setGot((g) => ({ ...g, [i.itemId]: cleanAmount(e.target.value, 3) }))} />
                  </label>
                  {lessNow && <TextField id={`why${i.itemId}`} label={`${t('shortReason')} *`} value={why[i.itemId] ?? ''} onChange={(e) => setWhy((w) => ({ ...w, [i.itemId]: e.target.value }))} maxLength={40} />}
                </div>
              );
            })}
            <ErrorBox error={formError} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setReceiving(false)}>{t('cancel')}</button>
              <button className="btn-primary" disabled={busy || (short && detail.items.some((i: any) => dec(toBase(got[i.itemId] ?? '0', i.displayFactor)).lessThan(dec(i.sentQty)) && !why[i.itemId]?.trim()))} onClick={receive}>{busy ? t('loading') : t('receiveAction')}</button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={creating} onClose={() => setCreating(false)} title={t('newTransfer')}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="tf" className="label">{t('fromLocation')} *</label>
              <select id="tf" className="field" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">{t('chooseLocation')}</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}</select></div>
            <div><label htmlFor="tt" className="label">{t('toLocation')} *</label>
              <select id="tt" className="field" value={to} onChange={(e) => setTo(e.target.value)}><option value="">{t('chooseLocation')}</option>{locations.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}</select></div>
          </div>
          {lines.map((l) => (
            <div key={l.key} className="space-y-2 rounded-card border border-slate-200 p-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1"><label htmlFor={`ti${l.key}`} className="label">{t('itemLabel')}</label>
                  <select id={`ti${l.key}`} className="field" value={l.itemId} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, itemId: e.target.value, unitId: it?.purchaseUnitId ?? it?.baseUnitId ?? '' } : x))); }}>
                    <option value="">{t('chooseItem')}</option>{items.map((i) => <option key={i.id} value={i.id}>{pick(i.nameEn, i.nameTa)}</option>)}</select></div>
                {lines.length > 1 && <button className="btn-secondary min-h-touch px-3" aria-label={t('removeItem')} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label htmlFor={`tq${l.key}`} className="label">{t('quantity')}</label>
                  <input id={`tq${l.key}`} className="field tabular-nums" inputMode="decimal" placeholder="0" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: cleanAmount(e.target.value, 3) } : x)))} /></div>
                <div><label htmlFor={`tu${l.key}`} className="label">{t('unitLabel')}</label>
                  <select id={`tu${l.key}`} className="field" value={l.unitId} disabled={!l.itemId} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, unitId: e.target.value } : x)))}>{unitsFor(l.itemId).map((u: any) => <option key={u.id} value={u.id}>{u.code}</option>)}</select></div>
              </div>
            </div>
          ))}
          <button className="btn-secondary" onClick={() => setLines((ls) => [...ls, { key: lineKey++, itemId: '', unitId: '', qty: '' }])}>+ {t('addItem')}</button>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField id="tv" label={t('vehicleRef')} value={vehicle} onChange={(e) => setVehicle(e.target.value)} maxLength={40} />
            <TextField id="tr" label={t('remarks2')} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
          </div>
          <ErrorBox error={formError} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setCreating(false)}>{t('cancel')}</button>
            <button className="btn-primary" disabled={busy || !from || !to || !lines.some((l) => l.itemId && dec(l.qty).greaterThan(0))} onClick={create}>{busy ? t('loading') : t('save')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
