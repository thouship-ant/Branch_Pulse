'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chips, ErrorBox, MoneyInput, Skeleton, TextField, Warnings } from '@/components/ui';
import { api, type Warning } from '@/lib/api';
import { addDays, prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { compressImage } from '@/lib/image';
import { MODE_KEY, STATUS_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { cacheMaster, readMaster, submitOffline, useOutbox } from '@/lib/outbox';
import { useBranch } from '@/lib/useBranch';

interface Category { id: string; nameEn: string; nameTa?: string; requiresReceiptAbove?: string | null; parentId?: string | null }
interface Supplier { id: string; code: string; name: string }
interface Bootstrap { categories: Category[]; suppliers?: Supplier[]; rules: { receiptAbove: number; backdateDays?: number } }

const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'] as const;

export default function ExpensePage() {
  const { t, pick } = useT();
  const { locationId, date: today } = useBranch();
  const [date, setDate] = useState(today); // the day the expense belongs to (today, or back-dated within the allowed window)
  const { ops, waiting } = useOutbox(locationId, date);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [list, setList] = useState<any[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [subId, setSubId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<(typeof MODES)[number]>('CASH');
  const [payee, setPayee] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // masters: network first, fall back to the offline copy (stale-while-revalidate for the phone)
  useEffect(() => {
    if (!locationId) return;
    (async () => {
      try {
        const b = await api.get(`/sync/bootstrap?locationId=${locationId}`);
        setBoot(b);
        void cacheMaster(`bootstrap:${locationId}`, b);
      } catch {
        const cached = await readMaster<Bootstrap>(`bootstrap:${locationId}`);
        if (cached) setBoot(cached);
      }
    })();
  }, [locationId]);

  const loadList = useCallback(async () => {
    if (!locationId) return;
    try {
      const rows = await api.get(`/expenses?locationId=${locationId}&from=${date}&to=${date}&pageSize=100`);
      setList(rows);
    } catch { /* offline: show only queued entries */ }
  }, [locationId, date]);
  useEffect(() => { void loadList(); }, [loadList, waiting]);

  const category = boot?.categories.find((c) => c.id === categoryId);
  const receiptAbove = dec(category?.requiresReceiptAbove ?? boot?.rules.receiptAbove ?? 500);
  const needsReceipt = amount !== '' && dec(amount).greaterThan(receiptAbove);
  const missingReceipt = needsReceipt && !photo;

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    const blob = await compressImage(file); // <= 300 KB
    setPhoto({ blob, name: file.name || 'receipt.jpg', url: URL.createObjectURL(blob) });
  }

  async function save(another: boolean) {
    setBusy(true); setError(null); setInfo(null); setWarnings([]);
    try {
      const row = await submitOffline({
        entityType: 'EXPENSE', op: 'CREATE', locationId, businessDate: date,
        payload: {
          locationId, businessDate: date, categoryId, subCategoryId: subId || undefined, amount: dec(amount).toFixed(2), paymentMode: mode,
          supplierId: supplierId || undefined, payeeName: payee || undefined, description: note || undefined,
        },
        blobs: photo ? [{ blob: photo.blob, name: photo.name }] : undefined,
      });
      if (row.state === 'REJECTED' || row.state === 'CONFLICT') {
        setError(row.lastError ?? 'Rejected');
        return;
      }
      setInfo(row.state === 'DONE' ? t('synced') : t('offline'));
      setWarnings((row.warnings as Warning[]) ?? []);
      setAmount(''); setPayee(''); setNote(''); setPhoto(null); setSupplierId('');
      if (!another) { setCategoryId(''); setSubId(''); }
      void loadList();
    } finally {
      setBusy(false);
    }
  }

  if (!boot) return <Skeleton className="h-96" />;
  const name = (c: Category) => pick(c.nameEn, c.nameTa);
  const top = boot.categories.filter((c) => !c.parentId);
  const subs = boot.categories.filter((c) => c.parentId === categoryId);
  const backdate = boot.rules.backdateDays ?? 0;
  const queued = ops.filter((o) => o.entityType === 'EXPENSE' && o.state !== 'DONE' && o.businessDate === date);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">{prettyDate(date)}</p>
        <h2 className="text-xl font-bold">{t('expense')}</h2>
      </div>

      <section className="card space-y-4" aria-label={t('category')}>
        {backdate > 0 && (
          <div>
            <label htmlFor="edate" className="label">{t('dateLabel')}</label>
            <input id="edate" type="date" className="field" value={date} min={addDays(today, -backdate)} max={today} onChange={(e) => setDate(e.target.value || today)} />
          </div>
        )}
        <span className="label">{t('category')}</span>
        <div className="grid grid-cols-3 gap-2">
          {top.map((c) => (
            <button
              key={c.id} type="button" onClick={() => { setCategoryId(c.id); setSubId(''); }} aria-pressed={categoryId === c.id}
              className={`min-h-[56px] rounded-card border p-2 text-sm font-medium leading-tight ${categoryId === c.id ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-surface'}`}
            >
              {categoryId === c.id && <span aria-hidden>✓ </span>}{name(c)}
            </button>
          ))}
        </div>

        {subs.length > 0 && (
          <Chips label={t('subCategory')} value={subId} onChange={setSubId} options={subs.map((c) => ({ value: c.id, label: name(c) }))} />
        )}

        <MoneyInput id="amount" label={t('amount')} value={amount} onChange={setAmount} required />
        <Chips label={t('paymentMode')} value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: t(MODE_KEY[m]) }))} />
        {(boot.suppliers?.length ?? 0) > 0 && (
          <div>
            <label htmlFor="supplier" className="label">{t('supplier')}</label>
            <select id="supplier" className="field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('supplierNone')}</option>
              {boot.suppliers!.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </select>
          </div>
        )}
        <TextField id="payee" label={t('payee')} value={payee} onChange={(e) => setPayee(e.target.value)} />
        <TextField id="note" label={t('description')} value={note} onChange={(e) => setNote(e.target.value)} />

        <div>
          <span className="label">{t('photo')}{needsReceipt && <span className="text-red-600"> * {t('needReceipt')}</span>}</span>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
          <div className="flex items-center gap-3">
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>📷 {t('addPhoto')}</button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo && <img src={photo.url} alt="Receipt preview" className="h-14 w-14 rounded-card border object-cover" />}
          </div>
        </div>
      </section>

      <Warnings items={warnings} />
      <ErrorBox error={error} />
      {info && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ {info}</p>}
      <div className="grid grid-cols-2 gap-3">
        <button className="btn-secondary" disabled={busy || !categoryId || !amount || missingReceipt} onClick={() => save(true)}>{t('saveAndAdd')}</button>
        <button className="btn-primary" disabled={busy || !categoryId || !amount || missingReceipt} onClick={() => save(false)}>{busy ? t('loading') : t('save')}</button>
      </div>

      <section aria-label={t('expenses')}>
        <h3 className="mb-2 font-semibold">{t('expenses')}</h3>
        <ul className="space-y-2">
          {queued.map((o) => (
            <li key={o.clientUuid} className="card flex items-center justify-between opacity-80">
              <span>{(() => { const c = boot.categories.find((x) => x.id === o.payload.categoryId); return c ? name(c) : '…'; })()}</span>
              <span className="tabular-nums">⟳ {formatINR(o.payload.amount)}</span>
            </li>
          ))}
          {list.map((e) => (
            <li key={e.id} className="card space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{pick(e.categoryName, e.categoryNameTa)}{e.subCategoryName && <span className="text-slate-500"> › {pick(e.subCategoryName, e.subCategoryNameTa)}</span>}</p>
                  <p className="text-xs text-slate-500">{e.code}{e.receiptCount > 0 && ' · 🧾'}</p>
                </div>
                <div className="text-right">
                  <p className="tabular-nums">{formatINR(e.amount)}</p>
                  <p className="text-xs text-slate-500">{(() => { const st = e.status !== 'ACTIVE' ? e.status : e.approvalStatus; return STATUS_KEY[st] ? t(STATUS_KEY[st]) : st; })()}</p>
                </div>
              </div>
              {(e.supplierName || e.payeeName || e.description) && (
                <p className="truncate text-xs text-slate-600">{[e.supplierName, e.payeeName, e.description].filter(Boolean).join(' · ')}</p>
              )}
              <p className="text-xs text-slate-500">
                {t('enteredBy')}: {e.enteredByName ?? '—'}
                {e.approvedByName && <> · {t('approvedBy')}: {e.approvedByName}</>}
                {e.approvalStatus === 'REJECTED' && e.rejectionReason && <span className="text-red-700"> · {e.rejectionReason}</span>}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
