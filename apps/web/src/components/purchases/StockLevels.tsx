'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { dec, formatINR } from '@/lib/money';
import { ErrorBox, Sheet, Skeleton } from '../ui';
import type { LocationOption } from './PurchaseForm';

const qty = (v: string) => dec(v).toDecimalPlaces(3).toString();

/** Stock on hand per item (and location), low-stock flags, and the movements behind each figure. */
export function StockLevels({ locations, fixedLocationId, refreshKey = 0 }: { locations: LocationOption[]; fixedLocationId?: string; refreshKey?: number }) {
  const { t, pick } = useT();
  const [locationId, setLocationId] = useState(fixedLocationId ?? locations[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<any | null>(null);
  const [moves, setMoves] = useState<any[] | null>(null);

  useEffect(() => { if (!locationId && locations[0]) setLocationId(locations[0].id); }, [locations, locationId]);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const p = new URLSearchParams({ locationId });
      if (q.trim()) p.set('q', q.trim());
      if (low) p.set('low', 'true');
      setRows(await api.get(`/stock?${p}`)); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [locationId, q, low]);
  useEffect(() => { const h = setTimeout(() => void load(), 250); return () => clearTimeout(h); }, [load, refreshKey]);

  async function showMoves(r: any) {
    setOpen(r); setMoves(null);
    try { setMoves(await api.get(`/stock/movements?locationId=${r.locationId}&itemId=${r.itemId}&pageSize=30`)); } catch (e: any) { setError(e.message); }
  }

  const total = rows?.reduce((a, r) => a.plus(dec(r.value)), dec(0));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {!fixedLocationId && (
          <div className="min-w-[200px]">
            <label htmlFor="sl" className="label">{t('atLocation')}</label>
            <select id="sl" className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </select>
          </div>
        )}
        <div className="min-w-[180px] flex-1">
          <label htmlFor="sq" className="label">{t('search')}</label>
          <input id="sq" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('itemLabel')} />
        </div>
        <label className="flex min-h-touch items-center gap-2 rounded-card border border-slate-300 px-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[#2563eb]" checked={low} onChange={(e) => setLow(e.target.checked)} /> {t('onlyLow')}
        </label>
      </div>
      <ErrorBox error={error} />
      {!rows ? <Skeleton className="h-48" /> : rows.length === 0 ? <p className="card text-slate-600">{t('noData')}</p> : (
        <section className="card overflow-x-auto p-0" aria-label={t('stockOnHand')}>
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">{t('itemLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('onHand')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('avgCost')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('stockValue')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('minStock')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={`${r.locationId}-${r.itemId}`} className="group cursor-pointer hover:bg-slate-50" onClick={() => showMoves(r)}>
                  <th scope="row" className="sticky left-0 z-10 border-r border-slate-200 bg-surface px-3 py-2 text-left font-medium group-hover:bg-slate-50">
                    {pick(r.itemName, r.itemNameTa)}
                    {r.low && <span className="ml-2 chip border-red-300 bg-red-50 text-red-800"><span aria-hidden>▼</span>{t('lowStock')}</span>}
                    <p className="font-mono text-xs font-normal text-slate-500">{r.itemCode}</p>
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(r.quantity)} <span className="text-slate-500">{r.unit}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{dec(r.avgCost).greaterThan(0) ? `₹${dec(r.avgCost).toDecimalPlaces(4).toString()}` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{dec(r.minStock).isZero() ? '—' : qty(r.minStock)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold">
              <tr><td className="px-3 py-2" colSpan={3}>{t('stockValue')}</td><td className="px-3 py-2 text-right tabular-nums">{formatINR(total)}</td><td /></tr>
            </tfoot>
          </table>
        </section>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? `${pick(open.itemName, open.itemNameTa)} · ${t('movements')}` : ''}>
        {!moves ? <Skeleton className="h-32" /> : moves.length === 0 ? <p className="text-slate-600">{t('noData')}</p> : (
          <ul className="divide-y text-sm">
            {moves.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{m.txnType.replace(/_/g, ' ').toLowerCase().replace(/^./, (c: string) => c.toUpperCase())}{m.sourceCode ? ` · ${m.sourceCode}` : ''}</p>
                  <p className="text-xs text-slate-500">{prettyDate(String(m.businessDate).slice(0, 10))} · {t('balanceAfter')} {qty(m.balanceAfter)} {m.unit}</p>
                </div>
                <span className={`tabular-nums ${dec(m.quantity).isNegative() ? 'text-red-700' : 'font-semibold text-emerald-800'}`}>{dec(m.quantity).isNegative() ? '' : '+'}{qty(m.quantity)} {m.unit}</span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
