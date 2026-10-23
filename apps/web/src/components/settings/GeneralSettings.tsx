'use client';

import { Select } from '@/components/Select';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT, type MessageKey } from '@/lib/i18n';
import { ErrorBox, Skeleton, TextField } from '../ui';

type Kind = 'string' | 'number' | 'boolean' | 'business_type' | 'time';
interface Field { key: string; labelKey: MessageKey; kind: Kind }

const GROUPS: Array<{ titleKey: MessageKey; fields: Field[] }> = [
  {
    titleKey: 'businessNameLabel',
    fields: [
      { key: 'business.name', labelKey: 'businessNameLabel', kind: 'string' },
      { key: 'business.type', labelKey: 'businessTypeLabel', kind: 'business_type' },
      { key: 'fy.start_month', labelKey: 'fyStartMonthLabel', kind: 'number' },
      { key: 'branch.code_prefix', labelKey: 'codePrefixLabel', kind: 'string' },
      { key: 'entry.backdate_days', labelKey: 'backdateDaysLabel', kind: 'number' },
      { key: 'transliteration.external', labelKey: 'transliterationExternalLabel', kind: 'boolean' },
    ],
  },
  {
    titleKey: 'stockVarianceLabel',
    fields: [
      { key: 'cash.variance_threshold', labelKey: 'cashVarianceThresholdLabel', kind: 'number' },
      { key: 'stock.variance_pct_default', labelKey: 'stockVariancePctLabel', kind: 'number' },
      { key: 'wastage.high_pct_of_sales', labelKey: 'wastageHighPctLabel', kind: 'number' },
      { key: 'wastage.high_single_entry', labelKey: 'wastageHighEntryLabel', kind: 'number' },
      { key: 'wastage.photo_above', labelKey: 'wastagePhotoAboveLabel', kind: 'number' },
    ],
  },
  {
    titleKey: 'closingCutoffLabel',
    fields: [
      { key: 'closing.cutoff_time', labelKey: 'closingCutoffLabel', kind: 'time' },
      { key: 'sales.mismatch_tolerance', labelKey: 'salesMismatchToleranceLabel', kind: 'number' },
      { key: 'sales.unusual_pct', labelKey: 'salesUnusualPctLabel', kind: 'number' },
      { key: 'expense.receipt_above', labelKey: 'expenseReceiptAboveLabel', kind: 'number' },
      { key: 'expense.unusual_multiple', labelKey: 'expenseUnusualMultipleLabel', kind: 'number' },
      { key: 'purchase.rate_deviation_pct', labelKey: 'purchaseRateDeviationLabel', kind: 'number' },
      { key: 'advance.max_multiple', labelKey: 'advanceMaxMultipleLabel', kind: 'number' },
    ],
  },
  {
    titleKey: 'alertSupplierDueDaysLabel',
    fields: [
      { key: 'alerts.supplier_due_days_before', labelKey: 'alertSupplierDueDaysLabel', kind: 'number' },
      { key: 'alerts.approval_pending_hours', labelKey: 'alertApprovalPendingHoursLabel', kind: 'number' },
      { key: 'alerts.advance_pending_hours', labelKey: 'alertAdvancePendingHoursLabel', kind: 'number' },
    ],
  },
];

const BIZ_TYPES: Array<[string, MessageKey]> = [['TEA_SHOP', 'bizTeaShop'], ['HOTEL', 'bizHotel'], ['BAKERY', 'bizBakery'], ['OTHER', 'bizOther']];

// GET responses camelCase every key server-side (fy.start_month -> fy.startMonth); PUT still takes the raw key.
const responseKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Owner: the shop-wide rules and thresholds (LLD s2 settings, s31). Backed by a generic key/value store,
 * so every field here already has a working API - this just gives it a screen. */
export function GeneralSettings() {
  const { t } = useT();
  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setValues(await api.get('/settings')); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setEdit = (key: string, v: string) => {
    setEdits((s) => ({ ...s, [key]: v }));
    setErrors((e) => { if (!(key in e)) return e; const n = { ...e }; delete n[key]; return n; });
  };

  /** Saves one field as soon as the user leaves it (or ticks / picks it). A bad value stays in the field with its error beneath. */
  async function save(f: Field, raw: string | undefined = edits[f.key]) {
    if (!values || raw === undefined || busyKey === f.key) return;
    const current = values[responseKey(f.key)];
    if (raw === String(typeof current === 'boolean' ? current : current ?? '')) { // nothing changed
      setEdits((e) => { const n = { ...e }; delete n[f.key]; return n; });
      return;
    }
    if (f.kind !== 'boolean' && raw.trim() === '') { setErrors((e) => ({ ...e, [f.key]: t('settingRequired') })); return; }
    if (f.kind === 'number' && Number.isNaN(Number(raw))) { setErrors((e) => ({ ...e, [f.key]: t('settingInvalidNumber') })); return; }
    let value: unknown = f.kind === 'string' ? raw.trim() : raw;
    if (f.kind === 'number') value = Number(raw);
    if (f.kind === 'boolean') value = raw === 'true';
    setBusyKey(f.key);
    try {
      await api.put(`/settings/${f.key}`, { value });
      setEdits((e) => { const n = { ...e }; delete n[f.key]; return n; });
      setErrors((e) => { const n = { ...e }; delete n[f.key]; return n; });
      setNotice(t('settingSaved'));
      setTimeout(() => setNotice(null), 2500);
      await load();
    } catch (e) {
      setErrors((x) => ({ ...x, [f.key]: e instanceof ApiError ? e.message : 'Could not save' }));
    } finally { setBusyKey(null); }
  }

  if (!values) return error ? <ErrorBox error={error} /> : <Skeleton className="h-64" />;

  return (
    <div className="space-y-5">
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {GROUPS.map((g, gi) => (
        <div key={gi} className="card space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map((f) => {
              const current = values[responseKey(f.key)];
              const edited = edits[f.key];
              const display = edited ?? (typeof current === 'boolean' ? String(current) : String(current ?? ''));
              const err = errors[f.key];
              const errId = `${f.key}-err`;
              return (
                <div key={f.key} className={f.kind === 'boolean' ? 'flex flex-col justify-end' : undefined}>
                  {f.kind === 'boolean' ? (
                    <label className="flex min-h-touch items-center gap-3 px-1">
                      <input
                        type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={display === 'true'} disabled={busyKey === f.key}
                        onChange={(e) => { setEdit(f.key, String(e.target.checked)); void save(f, String(e.target.checked)); }}
                      />
                      <span className="text-sm">{t(f.labelKey)}</span>
                    </label>
                  ) : f.kind === 'business_type' ? (
                    <div>
                      <label htmlFor={f.key} className="label">{t(f.labelKey)}</label>
                      <Select id={f.key} className="field" value={display} onChange={(e) => { setEdit(f.key, e.target.value); void save(f, e.target.value); }}>
                        {BIZ_TYPES.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
                      </Select>
                    </div>
                  ) : (
                    <TextField
                      id={f.key} label={t(f.labelKey)} value={display}
                      type={f.kind === 'time' ? 'time' : 'text'}
                      inputMode={f.kind === 'number' ? 'decimal' : undefined}
                      aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined}
                      className={err ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}
                      onChange={(e) => setEdit(f.key, f.kind === 'number' ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value)}
                      onBlur={() => void save(f)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    />
                  )}
                  {err && <p id={errId} role="alert" className="mt-1 text-sm text-red-700">{err}</p>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
