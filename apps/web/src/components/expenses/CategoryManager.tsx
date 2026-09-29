'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { amt, formatINR } from '@/lib/money';
import { ActiveChip, ErrorBox, MoneyInput, Sheet, Skeleton, TextField } from '../ui';

const BUCKETS = ['RAW_MATERIAL', 'SALARY', 'RENT', 'ELECTRICITY', 'TRANSPORT', 'MAINTENANCE', 'OTHER', 'NON_PL'];
const bucketName = (b: string) => b.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

interface Cat {
  id: string; parentId: string | null; nameEn: string; nameTa: string | null; plBucket: string;
  requiresReceiptAbove: string | null; unusualThreshold: string | null; requiresSupplier: boolean; sortOrder: number; status: string;
}
interface Draft { id?: string; parentId: string; nameEn: string; nameTa: string; plBucket: string; receipt: string; unusual: string; requiresSupplier: boolean; sortOrder: string; active: boolean }

/** Owner: add, rename, reorder and switch off expense categories and sub-categories. Nothing is hard-coded. */
export function CategoryManager() {
  const { t, pick } = useT();
  const [cats, setCats] = useState<Cat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setCats(await api.get('/expense-categories?includeInactive=true')); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const blank = (parentId = '', bucket = 'OTHER', order = 100): Draft => ({ parentId, nameEn: '', nameTa: '', plBucket: bucket, receipt: '', unusual: '', requiresSupplier: false, sortOrder: String(order), active: true });
  const fromCat = (c: Cat): Draft => ({
    id: c.id, parentId: c.parentId ?? '', nameEn: c.nameEn, nameTa: c.nameTa ?? '', plBucket: c.plBucket,
    receipt: c.requiresReceiptAbove ?? '', unusual: c.unusualThreshold ?? '', requiresSupplier: c.requiresSupplier, sortOrder: String(c.sortOrder), active: c.status === 'ACTIVE',
  });

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const common = {
        nameEn: draft.nameEn.trim(), nameTa: draft.nameTa.trim() || undefined, plBucket: draft.plBucket,
        requiresSupplier: draft.parentId ? undefined : draft.requiresSupplier, // only a top-level category carries this
        sortOrder: Number(draft.sortOrder) || 0,
      };
      if (draft.id) {
        await api.patch(`/expense-categories/${draft.id}`, {
          ...common, active: draft.active,
          requiresReceiptAbove: draft.receipt ? amt(draft.receipt) : null, // empty = the shop-wide default again
          unusualThreshold: draft.unusual ? amt(draft.unusual) : null,
        });
      } else {
        await api.post('/expense-categories', {
          ...common, parentId: draft.parentId || undefined,
          requiresReceiptAbove: draft.receipt ? amt(draft.receipt) : undefined,
          unusualThreshold: draft.unusual ? amt(draft.unusual) : undefined,
        });
      }
      setDraft(null);
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save');
    } finally { setBusy(false); }
  }

  if (!cats) return error ? <ErrorBox error={error} /> : <Skeleton className="h-64" />;
  const top = cats.filter((c) => !c.parentId);
  const parent = draft?.parentId ? cats.find((c) => c.id === draft.parentId) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">{t('catHint')}</p>
        <button className="btn-primary" onClick={() => { setFormError(null); setDraft(blank('', 'OTHER', (top.at(-1)?.sortOrder ?? 0) + 1)); }}>+ {t('addCategory')}</button>
      </div>
      <ErrorBox error={error} />

      <ul className="space-y-3">
        {top.map((c) => {
          const kids = cats.filter((k) => k.parentId === c.id);
          return (
            <li key={c.id} className={`card space-y-2 ${c.status !== 'ACTIVE' ? 'opacity-70' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{pick(c.nameEn, c.nameTa)} {c.nameTa && <span className="font-normal text-slate-500">· {pick(c.nameTa, c.nameEn)}</span>}</p>
                  <p className="text-xs text-slate-500">
                    {bucketName(c.plBucket)} · {t('receiptAboveLabel')}: {c.requiresReceiptAbove ? formatINR(c.requiresReceiptAbove, { decimals: false }) : t('useDefault')}
                    {c.requiresSupplier && <> · {t('requiresSupplierLabel')}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ActiveChip active={c.status === 'ACTIVE'} />
                  <button className="btn-secondary min-h-[36px] px-3 text-sm" onClick={() => { setFormError(null); setDraft(fromCat(c)); }}>{t('edit')}</button>
                  <button className="btn-secondary min-h-[36px] px-3 text-sm" onClick={() => { setFormError(null); setDraft(blank(c.id, c.plBucket, (kids.at(-1)?.sortOrder ?? 0) + 1)); }}>+ {t('addSubCategory')}</button>
                </div>
              </div>
              {kids.length > 0 && (
                <ul className="divide-y rounded-card border border-slate-200 text-sm">
                  {kids.map((k) => (
                    <li key={k.id} className={`flex items-center justify-between gap-2 px-3 py-2 ${k.status !== 'ACTIVE' ? 'opacity-70' : ''}`}>
                      <span>› {pick(k.nameEn, k.nameTa)}</span>
                      <span className="flex items-center gap-2">
                        <ActiveChip active={k.status === 'ACTIVE'} />
                        <button className="min-h-[32px] rounded-card border border-slate-300 px-2 text-xs hover:bg-slate-100" onClick={() => { setFormError(null); setDraft(fromCat(k)); }}>{t('edit')}</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft ? (draft.id ? t('edit') : draft.parentId ? t('addSubCategory') : t('addCategory')) : ''}>
        {draft && (
          <div className="space-y-4">
            {(parent || (draft.id && draft.parentId)) && <p className="text-sm text-slate-600">{t('subOf')}: <b>{pick((parent ?? cats.find((c) => c.id === draft.parentId))?.nameEn, (parent ?? cats.find((c) => c.id === draft.parentId))?.nameTa)}</b></p>}
            <TextField id="cn" label={`${t('catNameEn')} *`} value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} maxLength={60} />
            <TextField id="cnt" label={t('catNameTa')} value={draft.nameTa} onChange={(e) => setDraft({ ...draft, nameTa: e.target.value })} maxLength={60} />
            <div>
              <label htmlFor="cb" className="label">{t('plBucket')}</label>
              <select id="cb" className="field" value={draft.plBucket} onChange={(e) => setDraft({ ...draft, plBucket: e.target.value })}>
                {BUCKETS.map((b) => <option key={b} value={b}>{bucketName(b)}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyInput id="cr" label={t('receiptAboveLabel')} value={draft.receipt} onChange={(v) => setDraft({ ...draft, receipt: v })} hint={t('useDefault')} />
              <MoneyInput id="cu" label={t('unusualAbove')} value={draft.unusual} onChange={(v) => setDraft({ ...draft, unusual: v })} hint={t('useDefault')} />
            </div>
            <TextField id="co" label="#" value={draft.sortOrder} inputMode="numeric" onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            {!draft.parentId && (
              <label className="flex min-h-touch items-center gap-3 rounded-card border border-slate-300 px-3">
                <input type="checkbox" className="h-5 w-5 accent-[#2563eb]" checked={draft.requiresSupplier} onChange={(e) => setDraft({ ...draft, requiresSupplier: e.target.checked })} />
                <span>{t('requiresSupplierLabel')}</span>
              </label>
            )}
            {draft.id && (
              <label className="flex min-h-touch items-center gap-3 rounded-card border border-slate-300 px-3">
                <input type="checkbox" className="h-5 w-5 accent-[#2563eb]" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                <span>{t('active')}</span>
              </label>
            )}
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
