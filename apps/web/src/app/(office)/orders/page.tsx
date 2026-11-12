'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/DateNav';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Select';
import { Chips, ErrorBox, MoneyInput, Sheet, Skeleton, TextField } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { useT, type MessageKey } from '@/lib/i18n';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

const TYPES = ['BUSINESS_MEETING', 'FUNCTION', 'PARTY', 'CORPORATE', 'OTHER'] as const;
const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'] as const;
const MODE_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque' };
const PAY: Record<string, { key: MessageKey; cls: string; icon: string }> = {
  UNPAID: { key: 'oUnpaid', cls: 'border-red-300 bg-red-50 text-red-800', icon: '○' },
  PARTIAL: { key: 'oPartial', cls: 'border-amber-300 bg-amber-50 text-amber-900', icon: '◐' },
  PAID: { key: 'oPaidFull', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800', icon: '●' },
};
const STATUS: Record<string, { key: MessageKey; cls: string }> = {
  PLANNED: { key: 'oUpcoming', cls: 'border-sky-300 bg-sky-50 text-sky-900' },
  DELIVERED: { key: 'oDelivered', cls: 'border-slate-300 bg-slate-100 text-slate-700' },
  CANCELLED: { key: 'oCancelled', cls: 'border-slate-300 bg-slate-100 text-slate-500 line-through' },
};
const money = (v: unknown) => formatINR(String(v ?? 0), { decimals: false });

interface Draft { locationId: string; customerName: string; customerPhone: string; eventType: string; eventDate: string; eventTime: string; venue: string; itemsSummary: string; peopleCount: string; amount: string; advance: string; advanceMode: string; notes: string }

function PayChip({ status }: { status: string }) {
  const { t } = useT();
  const p = PAY[status] ?? PAY.UNPAID;
  return <span className={`chip ${p.cls}`}><span aria-hidden>{p.icon}</span>{t(p.key)}</span>;
}

/** Outside-shop orders: business meetings, functions and parties, with their payment status (not paid / partly paid / paid). */
export default function OrdersPage() {
  const { t, pick } = useT();
  const { can, me } = useSession();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'ALL' | 'PLANNED' | 'DELIVERED' | 'CANCELLED'>('ALL');
  const [pay, setPay] = useState<'' | 'UNPAID' | 'PARTIAL' | 'PAID'>('');
  const [branch, setBranch] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<any | null>(null);
  const [payment, setPayment] = useState({ amount: '', mode: 'CASH', reference: '', paidOn: todayIST() });

  const manage = can('order:manage');
  const locations = (me?.locations ?? []).filter((l) => l.type === 'BRANCH' || !l.type);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (tab !== 'ALL') qs.set('status', tab);
      if (pay) qs.set('paymentStatus', pay);
      if (branch) qs.set('locationId', branch);
      if (q.trim()) qs.set('q', q.trim());
      setRows(await api.get(`/orders?${qs}`)); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [tab, pay, branch, q]);
  useEffect(() => { const h = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);

  const totals = useMemo(() => {
    const live = (rows ?? []).filter((r) => r.status !== 'CANCELLED');
    return {
      value: live.reduce((a, r) => a + Number(r.amount), 0), received: live.reduce((a, r) => a + Number(r.paidAmount), 0),
      upcoming: live.filter((r) => r.status === 'PLANNED' && r.eventDate >= todayIST()).length,
    };
  }, [rows]);

  const blank = (): Draft => ({ locationId: locations[0]?.id ?? '', customerName: '', customerPhone: '', eventType: 'FUNCTION', eventDate: todayIST(), eventTime: '', venue: '', itemsSummary: '', peopleCount: '', amount: '', advance: '', advanceMode: 'CASH', notes: '' });

  async function create() {
    if (!adding) return;
    setBusy(true); setFormError(null);
    try {
      await api.post('/orders', {
        locationId: adding.locationId, customerName: adding.customerName.trim(), customerPhone: adding.customerPhone || undefined, eventType: adding.eventType, eventDate: adding.eventDate,
        eventTime: adding.eventTime || undefined, venue: adding.venue || undefined, itemsSummary: adding.itemsSummary || undefined, peopleCount: adding.peopleCount ? Number(adding.peopleCount) : undefined,
        amount: dec(adding.amount).toFixed(2), advance: adding.advance ? dec(adding.advance).toFixed(2) : undefined, advanceMode: adding.advance ? adding.advanceMode : undefined, notes: adding.notes || undefined,
      });
      setAdding(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save'); }
    finally { setBusy(false); }
  }

  async function openOrder(id: string) {
    try { setOpen(await api.get(`/orders/${id}`)); setPayment({ amount: '', mode: 'CASH', reference: '', paidOn: todayIST() }); setFormError(null); } catch (e: any) { setError(e.message); }
  }
  async function addPayment() {
    if (!open) return;
    setBusy(true); setFormError(null);
    try {
      await api.post(`/orders/${open.id}/payments`, { amount: dec(payment.amount).toFixed(2), mode: payment.mode, paidOn: payment.paidOn, reference: payment.reference || undefined });
      await openOrder(open.id); await load();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }
  async function setStatus(status: 'DELIVERED' | 'CANCELLED') {
    if (!open) return;
    setBusy(true);
    try { await api.patch(`/orders/${open.id}`, { status }); await openOrder(open.id); await load(); } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }

  if (!can('order:view')) return <p className="card">{t('noAccess')}</p>;

  const tile = (label: string, value: string, tone = '') => (
    <div className={`card ${tone}`}><p className="text-sm font-medium text-slate-600">{label}</p><p className="mt-0.5 text-[clamp(1.1rem,5.6vw,1.375rem)] font-bold tabular-nums sm:text-xl">{value}</p></div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t('ordersTitle')}</h2>
          <p className="text-sm text-slate-600">{t('oOrdersLead')}</p>
        </div>
        {manage && <button className="btn-primary" onClick={() => { setFormError(null); setAdding(blank()); }}>+ {t('newOrder')}</button>}
      </div>
      <ErrorBox error={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tile(t('oUpcoming'), String(totals.upcoming))}
        {tile(t('oTotalValue'), money(totals.value))}
        {tile(t('oReceived'), money(totals.received))}
        {tile(t('oOutstanding'), money(totals.value - totals.received), totals.value - totals.received > 0 ? 'border-amber-300' : '')}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div role="tablist" aria-label={t('oStatus')}>
          {(['ALL', 'PLANNED', 'DELIVERED', 'CANCELLED'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k === 'ALL' ? t('oAll') : t(STATUS[k].key)}</button>
          ))}
        </div>
        <Chips label={t('oPayStatus')} value={pay} onChange={(v) => setPay(pay === v ? '' : v)} options={(['UNPAID', 'PARTIAL', 'PAID'] as const).map((k) => ({ value: k, label: t(PAY[k].key) }))} />
        <div className="min-w-[200px]">
          <label htmlFor="ob" className="label">{t('oBranch')}</label>
          <Select id="ob" className="field" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">{t('oAllBranches')}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{pick(l.name, l.nameTa)}</option>)}
          </Select>
        </div>
        <div className="min-w-[220px] flex-1"><TextField id="oq" label={t('search')} placeholder={t('oSearch')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      {!rows ? <Skeleton className="h-64" /> : rows.length === 0 ? <p className="card text-sm text-slate-600">{t('oNoOrders')}</p> : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((o) => (
            <li key={o.id} className="flex">
              <button type="button" onClick={() => void openOrder(o.id)} className={`card flex h-full w-full flex-col gap-2 text-left transition duration-200 hover:-translate-y-px hover:border-brand/40 hover:shadow-lg ${o.status === 'CANCELLED' ? 'opacity-60' : ''}`}>
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-base font-bold">{o.customerName}</span>
                    <span className="block text-sm text-slate-600">{t(`et${o.eventType}` as MessageKey)} · {prettyDate(o.eventDate)}{o.eventTime ? ` · ${o.eventTime}` : ''}</span>
                  </span>
                  <PayChip status={o.paymentStatus} />
                </span>
                {o.venue && <span className="flex items-center gap-1.5 truncate text-sm text-slate-600"><Icon name="store" size={14} />{o.venue}{o.peopleCount ? ` · ${o.peopleCount} ${t('oPeople').toLowerCase()}` : ''}</span>}
                <span className="mt-auto flex items-end justify-between gap-2 border-t border-dashed border-slate-200 pt-2">
                  <span className="text-xs text-slate-500">{o.code} · {pick(o.locationName, o.locationNameTa)}</span>
                  <span className="text-right">
                    <span className="block text-lg font-extrabold tabular-nums">{money(o.amount)}</span>
                    {Number(o.balance) > 0 && o.status !== 'CANCELLED' && <span className="block text-xs font-semibold text-red-700">{t('oBalance')} {money(o.balance)}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* new order */}
      <Sheet open={!!adding} onClose={() => setAdding(null)} title={t('newOrder')}>
        {adding && (
          <div className="space-y-4">
            <div className="grid items-end gap-3 sm:grid-cols-2">
              <TextField id="o-c" label={`${t('oCustomer')} *`} value={adding.customerName} onChange={(e) => setAdding({ ...adding, customerName: e.target.value })} maxLength={100} />
              <TextField id="o-p" label={t('oPhone')} inputMode="numeric" value={adding.customerPhone} onChange={(e) => setAdding({ ...adding, customerPhone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
            </div>
            <Chips label={t('oEventType')} value={adding.eventType} onChange={(v) => setAdding({ ...adding, eventType: v })} options={TYPES.map((k) => ({ value: k, label: t(`et${k}` as MessageKey) }))} />
            <div className="grid items-end gap-3 sm:grid-cols-3">
              <div><label htmlFor="o-d" className="label">{t('oEventDate')} *</label><DateInput id="o-d" value={adding.eventDate} onChange={(v) => setAdding({ ...adding, eventDate: v || adding.eventDate })} /></div>
              <TextField id="o-t" label={t('oEventTime')} type="time" value={adding.eventTime} onChange={(e) => setAdding({ ...adding, eventTime: e.target.value })} />
              <TextField id="o-n" label={t('oPeople')} inputMode="numeric" value={adding.peopleCount} onChange={(e) => setAdding({ ...adding, peopleCount: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
            </div>
            <TextField id="o-v" label={t('oVenue')} value={adding.venue} onChange={(e) => setAdding({ ...adding, venue: e.target.value })} />
            <TextField id="o-i" label={t('oItems')} value={adding.itemsSummary} onChange={(e) => setAdding({ ...adding, itemsSummary: e.target.value })} />
            <div>
              <label htmlFor="o-l" className="label">{t('oBranch')} *</label>
              <Select id="o-l" className="field" value={adding.locationId} onChange={(e) => setAdding({ ...adding, locationId: e.target.value })}>
                {locations.map((l) => <option key={l.id} value={l.id}>{pick(l.name, l.nameTa)}</option>)}
              </Select>
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-2">
              <MoneyInput id="o-a" label={t('oAmount')} required value={adding.amount} onChange={(v) => setAdding({ ...adding, amount: v })} />
              <MoneyInput id="o-ad" label={t('oAdvance')} value={adding.advance} onChange={(v) => setAdding({ ...adding, advance: v })} />
            </div>
            {adding.advance && <Chips label={t('oAdvanceMode')} value={adding.advanceMode} onChange={(v) => setAdding({ ...adding, advanceMode: v })} options={MODES.map((k) => ({ value: k, label: MODE_LABEL[k] }))} />}
            <TextField id="o-no" label={t('oNotes')} value={adding.notes} onChange={(e) => setAdding({ ...adding, notes: e.target.value })} />
            <ErrorBox error={formError} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setAdding(null)}>{t('cancel')}</button>
              <button className="btn-primary" disabled={busy || !adding.customerName.trim() || !adding.locationId || !dec(adding.amount || '0').greaterThan(0)} onClick={create}>{busy ? t('loading') : t('oSave')}</button>
            </div>
          </div>
        )}
      </Sheet>

      {/* one order: details, payments, add payment */}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? `${open.customerName}` : ''}>
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <PayChip status={open.paymentStatus} />
              <span className={`chip ${STATUS[open.status].cls}`}>{t(STATUS[open.status].key)}</span>
              <span className="text-xs text-slate-500">{open.code}</span>
            </div>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              {[
                [t('oEventType'), t(`et${open.eventType}` as MessageKey)], [t('oEventDate'), `${prettyDate(open.eventDate)}${open.eventTime ? ` · ${open.eventTime}` : ''}`],
                [t('oBranch'), pick(open.locationName, open.locationNameTa)], [t('oPhone'), open.customerPhone ?? '—'], [t('oVenue'), open.venue ?? '—'], [t('oPeople'), open.peopleCount ?? '—'],
              ].map(([k, v]) => <div key={String(k)}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}
              {open.itemsSummary && <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('oItems')}</dt><dd className="font-medium">{open.itemsSummary}</dd></div>}
            </dl>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-center">
              <div><p className="text-xs text-slate-500">{t('oAmount')}</p><p className="font-bold tabular-nums">{money(open.amount)}</p></div>
              <div><p className="text-xs text-slate-500">{t('oPaid')}</p><p className="font-bold tabular-nums text-emerald-700">{money(open.paidAmount)}</p></div>
              <div><p className="text-xs text-slate-500">{t('oBalance')}</p><p className={`font-bold tabular-nums ${Number(open.balance) > 0 ? 'text-red-700' : ''}`}>{money(open.balance)}</p></div>
            </div>

            <div>
              <h3 className="mb-1.5 text-sm font-bold">{t('oPayments')}</h3>
              {open.payments.length === 0 ? <p className="text-sm text-slate-500">{t('oNoPayments')}</p> : (
                <ul className="divide-y divide-slate-200 text-sm">
                  {open.payments.map((p: any) => (
                    <li key={p.id} className="flex items-center justify-between py-2"><span>{prettyDate(p.paidOn)} · {MODE_LABEL[p.mode] ?? p.mode}{p.reference ? ` · ${p.reference}` : ''}</span><b className="tabular-nums">{money(p.amount)}</b></li>
                  ))}
                </ul>
              )}
            </div>

            {manage && open.status !== 'CANCELLED' && Number(open.balance) > 0 && (
              <div className="space-y-3 rounded-2xl border border-slate-200 p-3">
                <h3 className="text-sm font-bold">{t('oAddPayment')}</h3>
                <div className="grid items-end gap-3 sm:grid-cols-2">
                  <MoneyInput id="op-a" label={t('oAmount')} value={payment.amount} onChange={(v) => setPayment({ ...payment, amount: v })} hint={`${t('oBalance')}: ${money(open.balance)}`} />
                  <div><label htmlFor="op-d" className="label">{t('oPaidOn')}</label><DateInput id="op-d" value={payment.paidOn} max={todayIST()} onChange={(v) => setPayment({ ...payment, paidOn: v || payment.paidOn })} /></div>
                </div>
                <Chips label={t('oMode')} value={payment.mode} onChange={(v) => setPayment({ ...payment, mode: v })} options={MODES.map((k) => ({ value: k, label: MODE_LABEL[k] }))} />
                <TextField id="op-r" label={t('oRef')} value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} />
                <button className="btn-primary w-full" disabled={busy || !dec(payment.amount || '0').greaterThan(0)} onClick={addPayment}>{t('oAddPayment')}</button>
              </div>
            )}
            <ErrorBox error={formError} />
            {manage && open.status === 'PLANNED' && (
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-secondary" disabled={busy} onClick={() => setStatus('CANCELLED')}>{t('oCancelOrder')}</button>
                <button className="btn-primary" disabled={busy} onClick={() => setStatus('DELIVERED')}>✓ {t('oMarkDelivered')}</button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
