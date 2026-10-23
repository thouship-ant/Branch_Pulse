'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { ErrorBox, Sheet, Skeleton } from '../ui';
import type { LocationOption } from './PurchaseForm';
import { PaySheet, StatementView, SupplierEditSheet } from './SupplierSheets';

const day = (d: unknown) => String(d).slice(0, 10);
const money = (v: string | number | null | undefined) => (v === null || v === undefined ? '—' : formatINR(v, { decimals: false }));

/** Suppliers with their totals: total purchases, total paid, outstanding, overdue and next due. Open a supplier for its full profile. */
export function SupplierManager({ payLocations, onChanged }: { payLocations: LocationOption[]; onChanged?: () => void }) {
  const { t } = useT();
  const { can } = useSession();
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [owing, setOwing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ supplier: any | null } | null>(null);
  const [paying, setPaying] = useState<any | null>(null);
  const [stmt, setStmt] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (owing) p.set('owing', 'true');
      setRows(await api.get(`/suppliers?${p}`)); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [q, owing]);
  useEffect(() => { const h = setTimeout(() => void load(), 250); return () => clearTimeout(h); }, [load]);
  const changed = () => { void load(); onChanged?.(); };

  const list = rows ?? [];
  const showBalance = list.length > 0 && list[0].outstanding !== null;
  const sumOf = (k: string) => list.reduce((a, s) => a.plus(s[k] && dec(s[k]).greaterThan(0) ? dec(s[k]) : 0), dec(0));
  const totalOwed = sumOf('outstanding');
  const totalOverdue = sumOf('overdue');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <label htmlFor="sup-q" className="label">{t('search')}</label>
            <input id="sup-q" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('supplierName')} />
          </div>
          {showBalance && (
            <label className="flex min-h-touch items-center gap-2 rounded-card border border-slate-300 px-3 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={owing} onChange={(e) => setOwing(e.target.checked)} /> {t('onlyOwing')}
            </label>
          )}
        </div>
        {can('supplier:manage') && <button className="btn-primary" onClick={() => setEditing({ supplier: null })}>+ {t('addSupplier')}</button>}
      </div>
      <ErrorBox error={error} />

      {showBalance && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-label="Summary">
          <div className="card"><p className="text-sm text-slate-600">{t('totalOwed')}</p><p className="text-xl font-bold tabular-nums">{money(totalOwed.toString())}</p></div>
          <div className={`card ${totalOverdue.greaterThan(0) ? 'border-red-300' : ''}`}><p className="text-sm text-slate-600">{t('overdueLabel')}</p><p className="text-xl font-bold tabular-nums">{totalOverdue.greaterThan(0) ? '▼ ' : ''}{money(totalOverdue.toString())}</p></div>
          <div className="card"><p className="text-sm text-slate-600">{t('suppliersTitle')}</p><p className="text-xl font-bold tabular-nums">{list.length}</p></div>
        </section>
      )}

      {!rows ? <Skeleton className="h-48" /> : list.length === 0 ? <p className="card text-slate-600">{t('noData')}</p> : (
        <section className="card overflow-x-auto p-0" aria-label={t('suppliersTitle')}>
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('supplier')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('paymentTerms')}</th>
                {showBalance && <th scope="col" className="px-3 py-2 text-right">{t('openingBalance')}</th>}
                {showBalance && <th scope="col" className="px-3 py-2 text-right">{t('totalPurchases')}</th>}
                {showBalance && <th scope="col" className="px-3 py-2 text-right">{t('totalPaid')}</th>}
                {showBalance && <th scope="col" className="px-3 py-2 text-right">{t('outstanding')}</th>}
                {showBalance && <th scope="col" className="px-3 py-2 text-left">{t('overdueLabel')} / {t('nextDue')}</th>}
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              {list.map((s) => {
                const owed = s.outstanding !== null && dec(s.outstanding).greaterThan(0);
                const late = dec(s.overdue ?? 0).greaterThan(0);
                return (
                  <tr key={s.id} className={s.status !== 'ACTIVE' ? 'text-slate-500' : ''}>
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      <Link href={`/purchases/suppliers/${s.id}`} className="hover:underline">{s.name}</Link>
                      {s.status !== 'ACTIVE' && <span className="ml-2 chip border-slate-300 bg-slate-100 text-slate-600">{t('inactiveLabel')}</span>}
                      <p className="font-mono text-xs font-normal text-slate-500">{s.code}{s.phone ? ` · ${s.phone}` : ''}</p>
                      <p className="text-xs font-normal text-slate-500">{t('itemsLabel')}: {s.itemCount}</p>
                    </th>
                    <td className="px-3 py-2">{s.paymentTermsDays > 0 ? `${s.paymentTermsDays} ${t('daysCredit')}` : t('cashOnly')}</td>
                    {showBalance && <td className="px-3 py-2 text-right tabular-nums">{dec(s.openingBalance).isZero() ? '—' : money(s.openingBalance)}</td>}
                    {showBalance && <td className="px-3 py-2 text-right tabular-nums">{money(s.totalPurchases)}</td>}
                    {showBalance && <td className="px-3 py-2 text-right tabular-nums">{money(s.totalPaid)}</td>}
                    {showBalance && <td className="px-3 py-2 text-right font-semibold tabular-nums">{owed ? formatINR(s.outstanding) : <span className="font-normal text-slate-400">—</span>}</td>}
                    {showBalance && (
                      <td className="px-3 py-2">
                        {late ? <p className="font-semibold text-red-700">▼ {money(s.overdue)}</p> : null}
                        {s.nextDue ? <p className="text-xs text-slate-600">{t('nextDue')}: {prettyDate(day(s.nextDue))}</p> : !late ? '—' : null}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Link className="btn-secondary flex min-h-[34px] items-center px-2.5 text-xs" href={`/purchases/suppliers/${s.id}`}>{t('viewProfile')}</Link>
                        {can('supplier:pay') && <button className="btn-secondary min-h-[34px] px-2.5 text-xs" onClick={() => setStmt(s)}>{t('statement')}</button>}
                        {can('supplier:pay') && owed && s.status === 'ACTIVE' && <button className="btn-primary min-h-[34px] px-2.5 text-xs" onClick={() => setPaying(s)}>{t('paySupplier')}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <SupplierEditSheet open={!!editing} supplier={editing?.supplier ?? null} onClose={() => setEditing(null)} onSaved={changed} />
      <PaySheet supplier={paying} payLocations={payLocations} onClose={() => setPaying(null)} onPaid={changed} />
      <Sheet open={!!stmt} onClose={() => setStmt(null)} title={stmt ? `${t('statement')} · ${stmt.name}` : ''}>
        {stmt && <StatementView supplierId={stmt.id} onChanged={changed} />}
      </Sheet>
    </div>
  );
}
