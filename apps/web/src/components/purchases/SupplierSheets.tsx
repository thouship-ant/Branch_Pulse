'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { MODE_KEY } from '@/lib/labels';
import { amt, dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { Chips, ErrorBox, MoneyInput, Sheet, Skeleton, TextField } from '../ui';
import type { LocationOption } from './PurchaseForm';

const day = (d: unknown) => String(d).slice(0, 10);
const PAY_MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'] as const;
type PayMode = (typeof PAY_MODES)[number];

interface Draft { name: string; contact: string; phone: string; address: string; gstin: string; terms: string; opening: string; active: boolean; itemIds: string[] }

/** Add or edit a supplier: name, contact number, address, payment terms, opening balance (new only) and the items they supply. */
export function SupplierEditSheet({ open, supplier, onClose, onSaved }: { open: boolean; supplier: any | null; onClose: () => void; onSaved: () => void }) {
  const { t, pick } = useT();
  const [d, setD] = useState<Draft | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null); setQ('');
    setD(supplier
      ? { name: supplier.name, contact: supplier.contactPerson ?? '', phone: supplier.phone ?? '', address: supplier.address ?? '', gstin: supplier.gstin ?? '', terms: String(supplier.paymentTermsDays ?? 0), opening: '', active: supplier.status === 'ACTIVE', itemIds: supplier.itemIds ?? [] }
      : { name: '', contact: '', phone: '', address: '', gstin: '', terms: '0', opening: '', active: true, itemIds: [] });
    api.get('/sync/bootstrap').then((b) => setItems((b.items as any[]).filter((i) => i.status === 'ACTIVE'))).catch(() => undefined);
  }, [open, supplier]);

  async function save() {
    if (!d) return;
    setBusy(true); setError(null);
    try {
      const body = { name: d.name.trim(), contactPerson: d.contact.trim() || undefined, phone: d.phone.trim() || undefined, address: d.address.trim() || undefined, gstin: d.gstin.trim() || undefined, paymentTermsDays: Number(d.terms) || 0, itemIds: d.itemIds };
      if (supplier) await api.patch(`/suppliers/${supplier.id}`, { ...body, active: d.active });
      else await api.post('/suppliers', { ...body, openingBalance: amt(d.opening) });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((x: any) => x.message).join('; ') : e.message) : 'Could not save'); }
    finally { setBusy(false); }
  }

  const shown = items.filter((i) => !q.trim() || `${i.nameEn} ${i.nameTa ?? ''} ${i.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => d && setD({ ...d, itemIds: d.itemIds.includes(id) ? d.itemIds.filter((x) => x !== id) : [...d.itemIds, id] });

  return (
    <Sheet open={open} onClose={onClose} title={supplier ? t('editSupplier') : t('addSupplier')}>
      {d && (
        <div className="space-y-3">
          <TextField id="sn" label={`${t('supplierName')} *`} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={100} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField id="sp" label={t('contactNumber')} inputMode="tel" placeholder="9876543210" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value.replace(/[^\d+\s-]/g, '') })} maxLength={15} />
            <TextField id="sc" label={t('contactPerson')} value={d.contact} onChange={(e) => setD({ ...d, contact: e.target.value })} maxLength={60} />
            <TextField id="st" label={`${t('paymentTerms')} (${t('daysCredit')})`} inputMode="numeric" value={d.terms} onChange={(e) => setD({ ...d, terms: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
            <TextField id="sg" label={t('gstin')} value={d.gstin} onChange={(e) => setD({ ...d, gstin: e.target.value.toUpperCase() })} maxLength={15} />
          </div>
          <div>
            <label htmlFor="sa" className="label">{t('address')}</label>
            <textarea id="sa" className="field min-h-[72px] py-2" value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} maxLength={500} />
          </div>
          {!supplier && <MoneyInput id="so" label={t('openingOwed')} value={d.opening} onChange={(v) => setD({ ...d, opening: v })} />}

          <div>
            <span className="label">{t('chooseItems')} ({d.itemIds.length})</span>
            <input className="field mb-2" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} />
            <ul className="max-h-48 divide-y overflow-y-auto rounded-card border border-slate-200">
              {shown.map((i) => (
                <li key={i.id}>
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 hover:bg-slate-50">
                    <input type="checkbox" className="h-5 w-5 accent-[#2563eb]" checked={d.itemIds.includes(i.id)} onChange={() => toggle(i.id)} />
                    <span>{pick(i.nameEn, i.nameTa)} <span className="font-mono text-xs text-slate-500">{i.code}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          {supplier && (
            <label className="flex min-h-touch items-center gap-3 rounded-card border border-slate-300 px-3">
              <input type="checkbox" className="h-5 w-5 accent-[#2563eb]" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> <span>{t('active')}</span>
            </label>
          )}
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
            <button className="btn-primary" disabled={busy || !d.name.trim()} onClick={save}>{busy ? t('loading') : t('save')}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Pay a supplier: part or full, from a branch / warehouse till or account; oldest dues first unless a purchase is chosen. */
export function PaySheet({ supplier, payLocations, onClose, onPaid }: { supplier: any | null; payLocations: LocationOption[]; onClose: () => void; onPaid: () => void }) {
  const { t, pick } = useT();
  const [loc, setLoc] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PayMode>('CASH');
  const [ref, setRef] = useState('');
  const [purchase, setPurchase] = useState('');
  const [open, setOpen] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supplier) return;
    setAmount(''); setMode('CASH'); setRef(''); setPurchase(''); setError(null);
    setLoc((l) => l || payLocations[0]?.id || '');
    api.get(`/suppliers/${supplier.id}/ledger`).then((s) => setOpen(s.openPurchases)).catch(() => setOpen([]));
  }, [supplier, payLocations]);

  async function pay() {
    setBusy(true); setError(null);
    try {
      await api.post(`/suppliers/${supplier.id}/payments`, { locationId: loc, amount: dec(amount).toFixed(2), paymentMode: mode, referenceNo: ref.trim() || undefined, purchaseId: purchase || undefined });
      onPaid(); onClose();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }

  return (
    <Sheet open={!!supplier} onClose={onClose} title={supplier ? `${t('paySupplier')} · ${supplier.name}` : ''}>
      {supplier && (
        <div className="space-y-4">
          <p className="flex justify-between rounded-card bg-slate-100 px-3 py-2 font-semibold"><span>{t('outstanding')}</span><span className="tabular-nums">{formatINR(supplier.outstanding)}</span></p>
          <MoneyInput id="pa" label={`${t('amount')} *`} value={amount} onChange={setAmount} />
          <Chips label={t('paymentMode')} value={mode} onChange={setMode} options={PAY_MODES.map((m) => ({ value: m, label: t(MODE_KEY[m]) }))} />
          <div>
            <label htmlFor="pal" className="label">{t('payFrom')} *</label>
            <select id="pal" className="field" value={loc} onChange={(e) => setLoc(e.target.value)}>
              {payLocations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </select>
            {mode === 'CASH' && <p className="mt-1 text-xs text-slate-500">{t('cashRecon')}</p>}
          </div>
          <div>
            <label htmlFor="pap" className="label">{t('settlePurchase')}</label>
            <select id="pap" className="field" value={purchase} onChange={(e) => { setPurchase(e.target.value); const p = open.find((x) => x.id === e.target.value); if (p && !amount) setAmount(dec(p.creditAmount).toString()); }}>
              <option value="">{t('payOldest')}</option>
              {open.map((p) => <option key={p.id} value={p.id}>{p.code} · {formatINR(p.creditAmount)}{p.dueDate ? ` · ${prettyDate(day(p.dueDate))}` : ''}{p.overdue ? ' ▼' : ''}</option>)}
            </select>
          </div>
          <TextField id="par" label={t('referenceNo')} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={40} />
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
            <button className="btn-primary" disabled={busy || !loc || dec(amount).lessThanOrEqualTo(0)} onClick={pay}>{busy ? t('loading') : t('paySupplier')}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Ledger statement with a running balance, the credit purchases still open, and a reverse button on payments. */
export function StatementView({ supplierId, onChanged }: { supplierId: string; onChanged?: () => void }) {
  const { t } = useT();
  const { can } = useSession();
  const [stmt, setStmt] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reversing, setReversing] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/suppliers/${supplierId}/ledger`).then((s) => { setStmt(s); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, [supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reverse() {
    setBusy(true);
    try {
      await api.post(`/suppliers/payments/${reversing.sourceId}/reverse`, { reason });
      setReversing(null); setReason(''); await load(); onChanged?.();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); setReversing(null); }
    finally { setBusy(false); }
  }

  if (!stmt) return error ? <ErrorBox error={error} /> : <Skeleton className="h-40" />;
  const reversed = new Set<string>((stmt.entries as any[]).filter((e) => e.sourceType === 'SUPPLIER_PAYMENT_REVERSAL').map((e) => e.sourceId));

  return (
    <div className="space-y-3 text-sm">
      <ErrorBox error={error} />
      <p className="flex justify-between rounded-card bg-slate-100 px-3 py-2 font-semibold"><span>{t('outstanding')}</span><span className="tabular-nums">{formatINR(stmt.outstanding)}</span></p>
      {stmt.openPurchases.length > 0 && (
        <div>
          <p className="mb-1 font-semibold">{t('openCredits')}</p>
          <ul className="divide-y rounded-card border border-slate-200">
            {stmt.openPurchases.map((p: any) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span>{p.code}<span className={`block text-xs ${p.overdue ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{p.dueDate ? `${p.overdue ? '▼ ' : ''}${t('dueDate')} ${prettyDate(day(p.dueDate))}` : ''}</span></span>
                <span className="font-semibold tabular-nums">{formatINR(p.creditAmount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="mb-1 font-semibold">{prettyDate(stmt.from)} – {prettyDate(stmt.to)}</p>
        <ul className="divide-y rounded-card border border-slate-200">
          <li className="flex justify-between px-3 py-1.5 text-slate-600"><span>{t('balanceLabel')}</span><span className="tabular-nums">{formatINR(stmt.openingBalance)}</span></li>
          {(stmt.entries as any[]).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="min-w-0">
                {prettyDate(day(e.entryDate))} · {e.narration ?? e.entryType}
                {e.sourceType === 'SUPPLIER_PAYMENT' && can('supplier:pay') && !reversed.has(e.sourceId) && (
                  <button className="ml-2 rounded-card border border-slate-300 px-1.5 text-xs hover:bg-slate-100" onClick={() => { setReason(''); setReversing(e); }}>↺ {t('reversePayment')}</button>
                )}
              </span>
              <span className="whitespace-nowrap text-right tabular-nums">
                <span className={dec(e.credit).greaterThan(0) ? 'text-emerald-800' : ''}>{dec(e.debit).greaterThan(0) ? `+${formatINR(e.debit)}` : `−${formatINR(e.credit)}`}</span>
                <span className="block text-xs text-slate-500">{formatINR(e.balance)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Sheet open={!!reversing} onClose={() => setReversing(null)} title={reversing ? `${t('reversePayment')} · ${reversing.narration ?? ''}` : ''}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('reverseHelp')}</p>
          <label htmlFor="rpr" className="label">{t('reason')} *</label>
          <textarea id="rpr" className="field min-h-[96px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setReversing(null)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={!reason.trim() || busy} onClick={reverse}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
