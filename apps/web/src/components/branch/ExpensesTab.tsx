'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, uploadAttachment, type Warning } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { compressImage } from '@/lib/image';
import { MODE_KEY, STATUS_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { Chips, ErrorBox, MoneyInput, Sheet, Skeleton, TextField, Warnings } from '../ui';
import { Icon } from '../Icon';

const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'] as const;

/**
 * The owner's view of one branch's expenses: the list for a period, and a form to record one (rent and
 * electricity can be spread over a period so the P&L shows them evenly). It uses the same expense flow as the
 * branch phone, so approvals, cash posting, receipts and the audit trail all still apply.
 */
export function ExpensesTab({ branch }: { branch: any }) {
  const { t, pick } = useT();
  const period = usePeriod('month');
  const { range, valid } = period;
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState<string>('0');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cats, setCats] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!valid) return;
    try {
      const r = await api.full.get<any[]>(`/expenses?locationId=${branch.id}&from=${range.from}&to=${range.to}&pageSize=100`);
      setRows(r.data);
      setTotal(r.meta?.totalAmount ?? '0');
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [branch.id, range.from, range.to, valid]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.get('/expense-categories').then((c) => setCats((c as any[]).filter((x) => !x.parentId))).catch(() => undefined); }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker period={period} label={t('expenses')} />
        <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />{t('addExpense')}</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card"><p className="text-sm text-slate-600">{t('expenses')} · {prettyDate(range.from)} – {prettyDate(range.to)}</p><p className="text-2xl font-bold tabular-nums">{formatINR(total, { decimals: false })}</p></div>
        <div className="card"><p className="text-sm text-slate-600">{t('monthlyRent')}</p><p className="text-2xl font-bold tabular-nums">{branch.monthlyRent ? formatINR(branch.monthlyRent, { decimals: false }) : '—'}</p></div>
      </div>
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-48" /> : rows.length === 0 ? <p className="card text-slate-600">{t('noExpenses')}</p> : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('dateLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('category')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('payee')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('paymentMode')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('amount')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((e) => {
                const s = e.status !== 'ACTIVE' ? e.status : e.approvalStatus;
                return (
                  <tr key={e.id} className={e.status !== 'ACTIVE' ? 'text-slate-500 line-through decoration-slate-400' : ''}>
                    <td className="whitespace-nowrap px-3 py-2">{prettyDate(e.businessDate)}</td>
                    <td className="px-3 py-2"><p className="font-medium">{pick(e.categoryName, e.categoryNameTa)}</p><p className="text-xs text-slate-500">{e.code}{e.periodFrom ? ` · ${prettyDate(e.periodFrom)} – ${prettyDate(e.periodTo ?? e.periodFrom)}` : ''}</p></td>
                    <td className="px-3 py-2">{e.payeeName ?? '—'}</td>
                    <td className="px-3 py-2">{MODE_KEY[e.paymentMode] ? t(MODE_KEY[e.paymentMode]) : e.paymentMode}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(e.amount)}</td>
                    <td className="px-3 py-2">{STATUS_KEY[s] ? t(STATUS_KEY[s]) : s}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={`${t('addExpense')} · ${pick(branch.name, branch.nameTa)}`}>
        <ExpenseForm branchId={branch.id} categories={cats} onSaved={() => { setAdding(false); void load(); }} />
      </Sheet>
    </div>
  );
}

function ExpenseForm({ branchId, categories, onSaved }: { branchId: string; categories: any[]; onSaved: () => void }) {
  const { t, pick } = useT();
  const today = todayIST();
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<(typeof MODES)[number]>('CASH');
  const [payee, setPayee] = useState('');
  const [note, setNote] = useState('');
  const [spread, setSpread] = useState(false);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [photo, setPhoto] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [receiptAbove, setReceiptAbove] = useState(500);
  const fileRef = useRef<HTMLInputElement>(null);

  // the receipt rule (V12) applies to the owner too: show it up front instead of failing on save
  useEffect(() => { api.get('/settings').then((s) => setReceiptAbove(Number(s['expense.receipt_above'] ?? 500))).catch(() => undefined); }, []);
  const category = categories.find((c) => c.id === categoryId);
  const threshold = category?.requiresReceiptAbove != null ? Number(category.requiresReceiptAbove) : receiptAbove;
  const needsReceipt = amount !== '' && dec(amount).greaterThan(threshold);
  const missingReceipt = needsReceipt && !photo;

  async function save() {
    setBusy(true); setError(null); setWarnings([]);
    try {
      const keys = photo ? [await uploadAttachment(photo.blob, photo.name, branchId)] : undefined;
      const env = await api.full.post<any>('/expenses', {
        locationId: branchId, businessDate: date, categoryId, amount: dec(amount).toFixed(2), paymentMode: mode,
        payeeName: payee || undefined, description: note || undefined,
        periodFrom: spread ? from : undefined, periodTo: spread ? to : undefined, attachmentKeys: keys,
      });
      if (env.warnings?.length) { setWarnings(env.warnings); await new Promise((r) => setTimeout(r, 1200)); }
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="ecat" className="label">{t('category')} *</label>
        <select id="ecat" className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">—</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{pick(c.nameEn, c.nameTa)}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyInput id="eamt" label={t('amount')} value={amount} onChange={setAmount} required />
        <div><label htmlFor="edate" className="label">{t('dateLabel')}</label><input id="edate" type="date" className="field" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /></div>
      </div>
      <Chips label={t('paymentMode')} value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: t(MODE_KEY[m]) }))} />
      <TextField id="epayee" label={t('payee')} value={payee} onChange={(e) => setPayee(e.target.value)} />
      <TextField id="enote" label={t('note')} value={note} onChange={(e) => setNote(e.target.value)} />

      <label className="flex min-h-touch items-center gap-3 rounded-card border border-slate-300 px-3">
        <input type="checkbox" className="h-5 w-5 accent-[#2563eb]" checked={spread} onChange={(e) => setSpread(e.target.checked)} />
        <span>{t('spreadPeriod')}</span>
      </label>
      {spread && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="ef" className="label">{t('rangeFrom')}</label><input id="ef" type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} /></div>
          <div><label htmlFor="et" className="label">{t('rangeTo')}</label><input id="et" type="date" className="field" value={to} min={from} onChange={(e) => setTo(e.target.value || to)} /></div>
        </div>
      )}

      <div>
        <span className="label">{t('photo')}{needsReceipt && <span className="text-red-600"> * {t('receiptRequired', { n: formatINR(threshold, { decimals: false }) })}</span>}</span>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const blob = await compressImage(f); setPhoto({ blob, name: f.name || 'receipt.jpg', url: URL.createObjectURL(blob) }); } }} />
        <div className="flex items-center gap-3">
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>📷 {t('addPhoto')}</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo && <img src={photo.url} alt="Receipt preview" className="h-14 w-14 rounded-card border object-cover" />}
        </div>
      </div>

      <Warnings items={warnings} />
      <ErrorBox error={error} />
      <button className="btn-primary w-full" disabled={busy || !categoryId || !amount || missingReceipt} onClick={save}>{busy ? t('loading') : t('save')}</button>
    </div>
  );
}
