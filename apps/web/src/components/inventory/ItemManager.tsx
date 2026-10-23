'use client';

import { Select } from '@/components/Select';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { cleanAmount, dec } from '@/lib/money';
import { ActiveChip, ErrorBox, Sheet, Skeleton, TextField } from '../ui';
import type { LocationOption } from '../purchases/PurchaseForm';
import { toBase, toDisplay } from './qty';

const CATEGORIES = ['DAIRY', 'BEVERAGE_BASE', 'GRAIN', 'SPICE', 'FUEL', 'SNACKS', 'PACKAGING', 'CONSUMABLE', 'RAW_MATERIAL', 'OTHER'];
const nice = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase());

interface Draft { id?: string; nameEn: string; nameTa: string; category: string; baseUnitId: string; purchaseUnitId: string; perishable: boolean; daily: boolean; pct: string; qty: string; active: boolean; mins: Record<string, string> }

/** The owner's item list: add or edit items, the unit they are kept and bought in, daily-count and difference limits, minimum stock per location. */
export function ItemManager({ locations }: { locations: LocationOption[] }) {
  const { t, pick } = useT();
  const [items, setItems] = useState<any[] | null>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get('/items?includeInactive=true')); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); api.get('/sync/bootstrap').then((b) => setUnits(b.units)).catch(() => undefined); }, [load]);

  const baseUnits = units.filter((u) => !u.baseUnitId);
  const blank = (): Draft => ({ nameEn: '', nameTa: '', category: 'RAW_MATERIAL', baseUnitId: baseUnits.find((u) => u.code === 'PCS')?.id ?? baseUnits[0]?.id ?? '', purchaseUnitId: '', perishable: false, daily: false, pct: '', qty: '', active: true, mins: {} });
  const fromItem = (i: any): Draft => ({
    id: i.id, nameEn: i.nameEn, nameTa: i.nameTa ?? '', category: i.category, baseUnitId: i.baseUnitId, purchaseUnitId: i.purchaseUnitId ?? '', perishable: i.isPerishable, daily: i.dailyCountRequired,
    pct: i.varianceThresholdPct ? String(i.varianceThresholdPct) : '', qty: i.varianceThresholdQty ? toDisplay(String(i.varianceThresholdQty), i.displayFactor) : '', active: i.status === 'ACTIVE',
    mins: Object.fromEntries((i.settings as any[]).map((s) => [s.locationId, toDisplay(String(s.minStock), i.displayFactor)])),
  });

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const factor = draft.purchaseUnitId ? String(units.find((u) => u.id === draft.purchaseUnitId)?.factorToBase ?? 1) : '1';
      const body: Record<string, unknown> = {
        nameEn: draft.nameEn.trim(), nameTa: draft.nameTa.trim() || undefined, category: draft.category, purchaseUnitId: draft.purchaseUnitId || undefined,
        isPerishable: draft.perishable, dailyCountRequired: draft.daily,
        varianceThresholdPct: draft.pct ? draft.pct : draft.id ? null : undefined, varianceThresholdQty: draft.qty ? toBase(draft.qty, factor) : draft.id ? null : undefined,
      };
      if (draft.id) {
        await api.patch(`/items/${draft.id}`, { ...body, active: draft.active });
        for (const l of locations) {
          const v = draft.mins[l.id];
          if (v !== undefined && v !== '') await api.put(`/items/${draft.id}/locations/${l.id}`, { minStock: toBase(v, factor) });
        }
      } else {
        await api.post('/items', { ...body, baseUnitId: draft.baseUnitId });
      }
      setDraft(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save'); }
    finally { setBusy(false); }
  }

  const list = (items ?? []).filter((i) => !q.trim() || `${i.nameEn} ${i.nameTa ?? ''} ${i.code} ${i.category}`.toLowerCase().includes(q.trim().toLowerCase()));
  const purchaseOptions = draft ? units.filter((u) => u.id === draft.baseUnitId || u.baseUnitId === draft.baseUnitId) : [];
  const dispUnit = draft?.purchaseUnitId ? units.find((u) => u.id === draft.purchaseUnitId)?.code : units.find((u) => u.id === draft?.baseUnitId)?.code;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[220px]"><label htmlFor="iq" className="label">{t('search')}</label><input id="iq" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('itemName')} /></div>
        <button className="btn-primary" onClick={() => { setFormError(null); setDraft(blank()); }}>+ {t('addItem')}</button>
      </div>
      <p className="text-xs text-slate-500">{t('unitsHint')}</p>
      <ErrorBox error={error} />
      {!items ? <Skeleton className="h-48" /> : (
        <section className="card overflow-x-auto p-0" aria-label={t('itemsTitle')}>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('itemLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('category')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('baseUnitLabel')} / {t('purchaseUnitLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('dailyCountLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('allowedPct')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((i) => (
                <tr key={i.id} className={i.status !== 'ACTIVE' ? 'text-slate-500' : ''}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">{pick(i.nameEn, i.nameTa)}<p className="font-mono text-xs font-normal text-slate-500">{i.code}{i.isPerishable ? ` · ${t('perishable')}` : ''}</p></th>
                  <td className="px-3 py-2">{nice(i.category)}</td>
                  <td className="px-3 py-2">{i.baseUnit} / {i.purchaseUnit}</td>
                  <td className="px-3 py-2">{i.dailyCountRequired ? '✓' : '—'}</td>
                  <td className="px-3 py-2">{i.varianceThresholdPct ? `${dec(i.varianceThresholdPct).toString()}%` : '—'}</td>
                  <td className="px-3 py-2"><ActiveChip active={i.status === 'ACTIVE'} /></td>
                  <td className="px-3 py-2 text-right"><button className="btn-secondary min-h-[34px] px-3 text-xs" onClick={() => { setFormError(null); setDraft(fromItem(i)); }}>{t('edit')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft ? (draft.id ? t('editItem') : t('addItem')) : ''}>
        {draft && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField id="in" label={`${t('itemName')} *`} value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} maxLength={80} />
              <TextField id="int" label={t('catNameTa')} value={draft.nameTa} onChange={(e) => setDraft({ ...draft, nameTa: e.target.value })} maxLength={80} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label htmlFor="ic" className="label">{t('category')}</label>
                <Select id="ic" className="field" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{[...new Set([...CATEGORIES, draft.category])].map((c) => <option key={c} value={c}>{nice(c)}</option>)}</Select></div>
              <div><label htmlFor="ibu" className="label">{t('baseUnitLabel')}</label>
                <Select id="ibu" className="field" disabled={!!draft.id} value={draft.baseUnitId} onChange={(e) => setDraft({ ...draft, baseUnitId: e.target.value, purchaseUnitId: '' })}>{baseUnits.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</Select></div>
              <div><label htmlFor="ipu" className="label">{t('purchaseUnitLabel')}</label>
                <Select id="ipu" className="field" value={draft.purchaseUnitId} onChange={(e) => setDraft({ ...draft, purchaseUnitId: e.target.value })}><option value="">—</option>{purchaseOptions.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</Select></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-touch items-center gap-3 px-1"><input type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={draft.daily} onChange={(e) => setDraft({ ...draft, daily: e.target.checked })} />{t('dailyCountLabel')}</label>
              <label className="flex min-h-touch items-center gap-3 px-1"><input type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={draft.perishable} onChange={(e) => setDraft({ ...draft, perishable: e.target.checked })} />{t('perishable')}</label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="ip" className="label">{t('allowedPct')}</label><input id="ip" className="field" inputMode="decimal" placeholder="5" value={draft.pct} onChange={(e) => setDraft({ ...draft, pct: cleanAmount(e.target.value, 3) })} /></div>
              <div><label htmlFor="iqt" className="label">{t('allowedQty')} ({dispUnit})</label><input id="iqt" className="field" inputMode="decimal" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: cleanAmount(e.target.value, 3) })} /></div>
            </div>
            {draft.id && locations.length > 0 && (
              <div>
                <span className="label">{t('minStockLabel')} ({dispUnit})</span>
                <ul className="divide-y rounded-card border border-slate-200">
                  {locations.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <label htmlFor={`min${l.id}`} className="text-sm">{l.code} · {pick(l.name, l.nameTa)}</label>
                      <input id={`min${l.id}`} className="w-28 rounded-card border border-slate-300 bg-surface px-2 py-1.5 text-right tabular-nums" inputMode="decimal" placeholder="0" value={draft.mins[l.id] ?? ''} onChange={(e) => setDraft({ ...draft, mins: { ...draft.mins, [l.id]: cleanAmount(e.target.value, 3) } })} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {draft.id && <label className="flex min-h-touch items-center gap-3 px-1"><input type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />{t('active')}</label>}
            <ErrorBox error={formError} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDraft(null)}>{t('cancel')}</button>
              <button className="btn-primary" disabled={busy || !draft.nameEn.trim()} onClick={save}>{busy ? t('loading') : t('save')}</button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
