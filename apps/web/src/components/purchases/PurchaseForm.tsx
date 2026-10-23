'use client';

import { Select } from '@/components/Select';
import { DateInput } from '@/components/DateNav';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Warning } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { compressImage } from '@/lib/image';
import { MODE_KEY } from '@/lib/labels';
import { cleanAmount, dec, formatINR } from '@/lib/money';
import { cacheMaster, readMaster, submitOffline } from '@/lib/outbox';
import { Chips, ErrorBox, MoneyInput, Skeleton, TextField, Warnings } from '../ui';

interface Unit { id: string; code: string; name: string; baseUnitId: string | null; factorToBase: string }
interface Item { id: string; code: string; nameEn: string; nameTa?: string | null; baseUnitId: string; purchaseUnitId?: string | null; lastPurchaseRate?: string | null; status: string }
interface Supplier { id: string; code: string; name: string; paymentTermsDays?: number }
interface Boot { units: Unit[]; items: Item[]; suppliers: Supplier[]; rules: { backdateDays?: number } }
export interface LocationOption { id: string; code: string; name: string; nameTa?: string | null; type: string }
interface Line { key: number; itemId: string; unitId: string; qty: string; rate: string }

const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT'] as const;
type Mode = (typeof MODES)[number];
const MAX_PHOTOS = 3;
let lineKey = 1;
const blankLine = (): Line => ({ key: lineKey++, itemId: '', unitId: '', qty: '', rate: '' });

/**
 * Purchase entry (no billing): supplier, one or more items with quantity / unit / rate, payment (cash, part payment or credit with a
 * due date), invoice photo and remarks. Works offline through the outbox. Stock changes when the purchase is approved.
 */
export function PurchaseForm({ locations, fixedLocationId, onSaved }: {
  locations: LocationOption[]; fixedLocationId?: string; onSaved: (r: { queued: boolean; warnings: Warning[] }) => void;
}) {
  const { t, pick } = useT();
  const today = todayIST();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [date, setDate] = useState(today);
  const [supplierId, setSupplierId] = useState('');
  const [refNo, setRefNo] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [other, setOther] = useState('');
  const [discount, setDiscount] = useState('');
  const [mode, setMode] = useState<Mode>('CASH');
  const [paid, setPaid] = useState('');
  const [paidTouched, setPaidTouched] = useState(false);
  const [due, setDue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<Array<{ blob: Blob; name: string; url: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // masters: network first, offline copy as the fallback (the same snapshot the expense screen uses)
  useEffect(() => {
    const key = `bootstrap:${fixedLocationId ?? 'all'}`;
    (async () => {
      try {
        const b = await api.get(`/sync/bootstrap${fixedLocationId ? `?locationId=${fixedLocationId}` : ''}`);
        setBoot(b); void cacheMaster(key, b);
      } catch {
        const cached = await readMaster<Boot>(key);
        if (cached) setBoot(cached);
      }
    })();
  }, [fixedLocationId]);

  const items = boot?.items.filter((i) => i.status === 'ACTIVE') ?? [];
  const units = boot?.units ?? [];
  const supplier = boot?.suppliers.find((s) => s.id === supplierId);
  const backdate = boot?.rules.backdateDays ?? 0;

  /** Units an item can be bought in: its own unit, or any unit that converts to it (L and ml for milk). */
  const unitsFor = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    return item ? units.filter((u) => u.id === item.baseUnitId || u.baseUnitId === item.baseUnitId) : [];
  };

  function setLine(key: number, patch: Partial<Line>) { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); }
  function chooseItem(key: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    setLine(key, { itemId, unitId: item?.purchaseUnitId ?? item?.baseUnitId ?? '' });
  }

  const calc = useMemo(() => {
    const rows = lines.map((l) => {
      const total = dec(l.qty).mul(dec(l.rate)).toDecimalPlaces(2);
      const unit = units.find((u) => u.id === l.unitId);
      const base = unit ? dec(l.qty).mul(dec(unit.factorToBase)) : dec(0);
      return { total, base, unit };
    });
    const subtotal = rows.reduce((a, r) => a.plus(r.total), dec(0));
    const total = subtotal.plus(dec(other)).minus(dec(discount));
    const effectivePaid = mode === 'CREDIT' ? dec(0) : paidTouched ? dec(paid) : total;
    return { rows, subtotal, total, effectivePaid, credit: total.minus(effectivePaid) };
  }, [lines, units, other, discount, mode, paid, paidTouched]);

  // credit needs a due date: suggest it from the supplier's credit days
  useEffect(() => {
    if (calc.credit.greaterThan(0) && !due && supplier?.paymentTermsDays) setDue(addDays(date, supplier.paymentTermsDays));
    if (calc.credit.lessThanOrEqualTo(0) && due) setDue('');
  }, [calc.credit, supplier, date]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickPhoto(file: File | undefined) {
    if (!file || photos.length >= MAX_PHOTOS) return;
    const blob = await compressImage(file);
    setPhotos((p) => [...p, { blob, name: file.name || 'invoice.jpg', url: URL.createObjectURL(blob) }]);
  }

  const validLines = lines.filter((l) => l.itemId && l.unitId && dec(l.qty).greaterThan(0) && l.rate !== '');
  const problem =
    !locationId ? t('chooseLocation')
    : !supplierId ? t('chooseSupplier')
    : validLines.length === 0 || validLines.length !== lines.filter((l) => l.itemId || l.qty || l.rate).length ? t('chooseItem')
    : calc.total.lessThanOrEqualTo(0) ? t('purchaseTotal')
    : mode !== 'CREDIT' && (calc.effectivePaid.lessThanOrEqualTo(0) || calc.effectivePaid.greaterThan(calc.total)) ? t('paidNow')
    : calc.credit.greaterThan(0) && !due ? t('dueDate')
    : null;

  async function save() {
    setBusy(true); setError(null);
    try {
      const payload: Record<string, unknown> = {
        locationId, businessDate: date, supplierId, supplierRefNo: refNo.trim() || undefined,
        items: validLines.map((l) => ({ itemId: l.itemId, unitId: l.unitId, quantity: dec(l.qty).toString(), rate: dec(l.rate).toString() })),
        otherCharges: other ? dec(other).toFixed(2) : undefined, discount: discount ? dec(discount).toFixed(2) : undefined,
        paymentMode: mode, paidAmount: mode === 'CREDIT' ? undefined : calc.effectivePaid.toFixed(2),
        dueDate: calc.credit.greaterThan(0) ? due : undefined, remarks: remarks.trim() || undefined,
      };
      const row = await submitOffline({
        entityType: 'PURCHASE', op: 'CREATE', locationId, businessDate: date, payload,
        blobs: photos.length ? photos.map((p) => ({ blob: p.blob, name: p.name })) : undefined,
      });
      if (row.state === 'REJECTED' || row.state === 'CONFLICT') { setError(row.lastError ?? 'Could not save'); return; }
      onSaved({ queued: row.state !== 'DONE', warnings: (row.warnings as Warning[]) ?? [] });
    } finally { setBusy(false); }
  }

  if (!boot) return <Skeleton className="h-96" />;
  const kind = calc.credit.lessThanOrEqualTo(0) ? t('payFull') : calc.effectivePaid.greaterThan(0) ? t('payPart') : t('payCredit');

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {!fixedLocationId && (
          <div>
            <label htmlFor="pl" className="label">{t('atLocation')} *</label>
            <Select id="pl" className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t('chooseLocation')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </Select>
          </div>
        )}
        <div>
          <label htmlFor="pd" className="label">{t('purchaseDate')}</label>
          <DateInput id="pd" value={date} max={today} min={backdate > 0 ? addDays(today, -backdate) : undefined} onChange={(v) => setDate(v || today)} />
        </div>
        <div>
          <label htmlFor="ps" className="label">{t('supplier')} *</label>
          <Select id="ps" className="field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t('chooseSupplier')}</option>
            {boot.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <TextField id="pr" label={t('invoiceNo')} value={refNo} onChange={(e) => setRefNo(e.target.value)} maxLength={40} />
      </div>

      <section className="space-y-3" aria-label={t('itemsLabel')}>
        <h3 className="font-semibold">{t('itemsLabel')}</h3>
        {lines.map((l, i) => {
          const item = items.find((x) => x.id === l.itemId);
          const c = calc.rows[i];
          const opts = unitsFor(l.itemId);
          const baseUnit = units.find((u) => u.id === item?.baseUnitId);
          const showBase = c.unit && baseUnit && c.unit.id !== baseUnit.id && dec(l.qty).greaterThan(0);
          return (
            <div key={l.key} className="space-y-2 rounded-card border border-slate-200 p-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`pi${l.key}`} className="label">{t('itemLabel')} *</label>
                  <Select id={`pi${l.key}`} className="field" value={l.itemId} onChange={(e) => chooseItem(l.key, e.target.value)}>
                    <option value="">{t('chooseItem')}</option>
                    {items.map((x) => <option key={x.id} value={x.id}>{pick(x.nameEn, x.nameTa)}</option>)}
                  </Select>
                </div>
                {lines.length > 1 && (
                  <button type="button" className="btn-secondary min-h-touch px-3" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`${t('removeItem')} ${i + 1}`}>✕</button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor={`pq${l.key}`} className="label">{t('quantity')}</label>
                  <input id={`pq${l.key}`} className="field text-lg tabular-nums" inputMode="decimal" placeholder="0" value={l.qty} onChange={(e) => setLine(l.key, { qty: cleanAmount(e.target.value, 3) })} />
                </div>
                <div>
                  <label htmlFor={`pu${l.key}`} className="label">{t('unitLabel')}</label>
                  <Select id={`pu${l.key}`} className="field" value={l.unitId} disabled={!l.itemId} onChange={(e) => setLine(l.key, { unitId: e.target.value })}>
                    {opts.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                  </Select>
                </div>
                <div>
                  <label htmlFor={`pt${l.key}`} className="label">{t('rate')}</label>
                  <input id={`pt${l.key}`} className="field text-lg tabular-nums" inputMode="decimal" placeholder="0" value={l.rate} onChange={(e) => setLine(l.key, { rate: cleanAmount(e.target.value, 4) })} />
                </div>
              </div>
              <p className="flex justify-between text-sm text-slate-600">
                <span>{showBase ? `= ${c.base.toDecimalPlaces(3).toString()} ${baseUnit!.code}` : ''}</span>
                <span className="font-semibold tabular-nums text-ink">{formatINR(c.total)}</span>
              </p>
            </div>
          );
        })}
        <button type="button" className="btn-secondary min-h-touch" onClick={() => setLines((ls) => [...ls, blankLine()])}>+ {t('addItem')}</button>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <MoneyInput id="po" label={t('otherCharges')} value={other} onChange={setOther} />
        <MoneyInput id="pdc" label={t('discount')} value={discount} onChange={setDiscount} />
      </div>

      <div className="flex items-center justify-between rounded-card bg-slate-100 px-3 py-3 font-semibold">
        <span>{t('purchaseTotal')}</span><span className="text-lg tabular-nums">{formatINR(calc.total)}</span>
      </div>

      <Chips label={t('paymentMode')} value={mode} onChange={(m) => { setMode(m); setPaidTouched(false); setPaid(''); }} options={MODES.map((m) => ({ value: m, label: t(MODE_KEY[m]) }))} />
      {mode !== 'CREDIT' && (
        <div>
          <label htmlFor="pp" className="label">{t('paidNow')}</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">₹</span>
            {/* pre-filled with the total (a full payment); selecting it on focus means typing a smaller amount replaces it */}
            <input
              id="pp" className="field pl-8 text-lg tabular-nums" inputMode="decimal" autoComplete="off" placeholder="0"
              value={paidTouched ? paid : calc.total.greaterThan(0) ? calc.total.toFixed(2).replace(/\.00$/, '') : ''}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => { setPaidTouched(true); setPaid(cleanAmount(e.target.value)); }}
            />
          </div>
        </div>
      )}
      {calc.total.greaterThan(0) && (
        <div className={`flex items-center justify-between rounded-card border px-3 py-2 text-sm ${calc.credit.greaterThan(0) ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`} role="status">
          <span>{calc.credit.greaterThan(0) ? '◔' : '✓'} {kind}</span>
          <span className="tabular-nums">{t('creditLeft')}: <b>{formatINR(calc.credit.greaterThan(0) ? calc.credit : 0)}</b></span>
        </div>
      )}
      {calc.credit.greaterThan(0) && (
        <div>
          <label htmlFor="pdue" className="label">{t('dueDate')} *</label>
          <DateInput id="pdue" value={due} min={date} onChange={(v) => setDue(v)} />
          {supplier?.paymentTermsDays ? <p className="mt-1 text-xs text-slate-500">{supplier.name}: {supplier.paymentTermsDays} {t('creditDays')}</p> : null}
        </div>
      )}

      <div>
        <span className="label">{t('invoicePhoto')}</span>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.url} src={p.url} alt="Invoice preview" className="h-14 w-14 rounded-card border object-cover" />
          ))}
          {photos.length < MAX_PHOTOS && <button type="button" className="btn-secondary min-h-touch" onClick={() => fileRef.current?.click()}>📷 {t('addPhotoShort2')}</button>}
        </div>
      </div>

      <TextField id="prm" label={t('remarks2')} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
      <p className="text-xs text-slate-500">{prettyDate(date)} · {t('stockAfterApproval')}</p>

      <ErrorBox error={error} />
      {problem && <p className="text-sm text-slate-500">{problem}</p>}
      <button className="btn-primary w-full" disabled={busy || !!problem} onClick={save}>{busy ? t('loading') : t('save')}</button>
    </div>
  );
}

export { Warnings };
