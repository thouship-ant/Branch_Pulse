'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PaymentHistory } from '@/components/purchases/PaymentHistory';
import type { LocationOption } from '@/components/purchases/PurchaseForm';
import { PurchaseLedger } from '@/components/purchases/PurchaseLedger';
import { PaySheet, StatementView, SupplierEditSheet } from '@/components/purchases/SupplierSheets';
import { ErrorBox, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

type Tab = 'purchases' | 'payments' | 'statement';
const day = (d: unknown) => String(d).slice(0, 10);
const money = (v: string | number | null | undefined) => (v === null || v === undefined ? '—' : formatINR(v));

/** One supplier: contact details, payment terms, items supplied, the money picture, and their purchase and payment history. */
export default function SupplierProfile() {
  const { id } = useParams<{ id: string }>();
  const { t, pick } = useT();
  const { can } = useSession();
  const [s, setS] = useState<any>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [tab, setTab] = useState<Tab>('purchases');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    try { setS(await api.get(`/suppliers/${id}`)); setError(null); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.get('/locations').then((l) => setLocations(l as LocationOption[])).catch(() => undefined); }, []);
  const changed = () => { void load(); setRefresh((n) => n + 1); };

  if (!can('supplier:view')) return <p className="card">{t('noAccess')}</p>;
  if (!s) return error ? <ErrorBox error={error} /> : <Skeleton className="h-96" />;
  const tot = s.totals;
  const receiving = locations.filter((l) => l.type !== 'CENTRAL_OFFICE');
  const tabs: Array<[Tab, string]> = [['purchases', t('rPurchaseHistory')]];
  if (can('supplier:pay')) tabs.push(['payments', t('rPaymentHistory')], ['statement', t('statement')]);
  const owed = tot && dec(tot.outstanding).greaterThan(0);

  const Tile = ({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) => (
    <div className={`card ${tone ?? ''}`}><p className="text-sm text-slate-600">{label}</p><p className="text-xl font-bold tabular-nums">{value}</p>{sub && <p className="text-xs text-slate-500">{sub}</p>}</div>
  );

  return (
    <div className="space-y-4">
      <Link href="/purchases" className="text-sm text-brand underline">← {t('backToPurchases')}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-slate-500">{s.code}</p>
          <h2 className="text-2xl font-bold">{s.name} {s.status !== 'ACTIVE' && <span className="chip border-slate-300 bg-slate-100 align-middle text-sm text-slate-600">{t('inactiveLabel')}</span>}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('supplier:pay') && owed && s.status === 'ACTIVE' && <button className="btn-primary" onClick={() => setPaying(true)}>{t('paySupplier')}</button>}
          {can('supplier:manage') && <button className="btn-secondary" onClick={() => setEditing(true)}>{t('edit')}</button>}
        </div>
      </div>
      <ErrorBox error={error} />

      {tot && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" aria-label="Summary">
          <Tile label={t('openingBalance')} value={money(tot.openingBalance)} />
          <Tile label={t('totalPurchases')} value={money(tot.totalPurchases)} sub={`${t('entries')}: ${tot.purchaseCount}`} />
          <Tile label={t('totalPaid')} value={money(tot.totalPaid)} sub={`${t('paymentsLabel')}: ${tot.paymentCount}`} />
          <Tile label={t('outstanding')} value={money(tot.outstanding)} tone={owed ? 'border-amber-300' : ''} />
          <Tile label={t('overdueLabel')} value={`${dec(tot.overdue).greaterThan(0) ? '▼ ' : ''}${money(tot.overdue)}`} tone={dec(tot.overdue).greaterThan(0) ? 'border-red-300' : ''} />
          <Tile label={t('nextDue')} value={tot.nextDue ? prettyDate(day(tot.nextDue)) : '—'} sub={tot.lastPurchaseOn ? `${t('lastPurchase')}: ${prettyDate(day(tot.lastPurchaseOn))}` : undefined} />
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2 text-sm" aria-label={t('supplierProfile')}>
          <h3 className="font-semibold">{t('supplierProfile')}</h3>
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-slate-500">{t('contactNumber')}</dt><dd>{s.phone ? <a className="text-brand underline" href={`tel:${s.phone}`}>{s.phone}</a> : '—'}</dd>
            <dt className="text-slate-500">{t('contactPerson')}</dt><dd>{s.contactPerson ?? '—'}</dd>
            <dt className="text-slate-500">{t('address')}</dt><dd className="whitespace-pre-wrap">{s.address ?? '—'}</dd>
            <dt className="text-slate-500">{t('paymentTerms')}</dt><dd>{s.paymentTermsDays > 0 ? `${s.paymentTermsDays} ${t('daysCredit')}` : t('cashOnly')}</dd>
            <dt className="text-slate-500">{t('gstin')}</dt><dd>{s.gstin ?? '—'}</dd>
          </dl>
        </section>
        <section className="card space-y-2 text-sm" aria-label={t('itemsSupplied')}>
          <h3 className="font-semibold">{t('itemsSupplied')} ({s.items.length})</h3>
          {s.items.length === 0 ? <p className="text-slate-500">{t('noItemsSupplied')}</p> : (
            <ul className="flex flex-wrap gap-2">{(s.items as any[]).map((i) => <li key={i.id} className="chip border-slate-300 bg-slate-50">{pick(i.nameEn, i.nameTa)}</li>)}</ul>
          )}
        </section>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-touch whitespace-nowrap border-b-2 px-4 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-slate-600 hover:text-ink'}`}>{label}</button>
        ))}
      </div>
      {tab === 'purchases' && <PurchaseLedger locations={receiving} fixedSupplierId={id} refreshKey={refresh} onChanged={changed} />}
      {tab === 'payments' && <PaymentHistory fixedSupplierId={id} refreshKey={refresh} />}
      {tab === 'statement' && <StatementView key={refresh} supplierId={id} onChanged={changed} />}

      <SupplierEditSheet open={editing} supplier={s} onClose={() => setEditing(false)} onSaved={changed} />
      <PaySheet supplier={paying ? { ...s, outstanding: tot?.outstanding } : null} payLocations={locations} onClose={() => setPaying(false)} onPaid={changed} />
    </div>
  );
}
