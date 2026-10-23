'use client';

import { Select } from '@/components/Select';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { prettyDate, prettyTime, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { ErrorBox, Skeleton } from '../ui';

const TYPES = ['LOCATION', 'DAILY_SALES', 'CASH_RECONCILIATION', 'CASH_TRANSACTION', 'DAILY_CLOSING', 'EXPENSE'];

const ACTION_CLS: Record<string, string> = {
  CREATE: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  UPDATE: 'border-sky-300 bg-sky-50 text-sky-900',
  APPROVE: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  REJECT: 'border-red-300 bg-red-50 text-red-800',
  REOPEN: 'border-violet-300 bg-violet-50 text-violet-800',
  PERMISSION_CHANGE: 'border-violet-300 bg-violet-50 text-violet-800',
  STATUS_CHANGE: 'border-amber-300 bg-amber-50 text-amber-800',
  REVERSE: 'border-amber-300 bg-amber-50 text-amber-800',
  CANCEL: 'border-slate-300 bg-slate-100 text-slate-700',
};

const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/;
const show = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && MIDNIGHT.test(v)) return prettyDate(v.slice(0, 10));
  return String(v);
};

/** Columns that mean nothing to a reader (ids, versions, sync bookkeeping). */
const TECHNICAL = /(^id$|_id$|_uuid$|^version$|^source$|^client_|^status$|^is_locked$|^reversal_of)/;
/** What a created record is summarised by, in reading order. */
const CREATE_KEYS = ['name', 'name_ta', 'amount', 'payment_mode', 'total_sales', 'description', 'payee_name', 'business_date', 'default_opening_cash', 'monthly_rent', 'card_enabled', 'address'];

/** Fields worth showing: for a create a short summary, for an update every real change. */
function visibleFields(r: any): string[] {
  const changed: string[] = r.changedFields ?? [];
  if (r.action === 'CREATE') {
    const nv = r.newValues ?? {};
    return CREATE_KEYS.filter((k) => nv[k] !== null && nv[k] !== undefined && nv[k] !== '').slice(0, 6);
  }
  return changed.filter((f) => !TECHNICAL.test(f) || f === 'status');
}

/** Everything recorded against the branch, newest first: who, when, what changed (old to new) and why. */
export function HistoryTab({ branchId }: { branchId: string }) {
  const { t } = useT();
  const [entityType, setEntityType] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (before?: string) => {
    setBusy(true);
    try {
      const qs = `limit=30${entityType ? `&entityType=${entityType}` : ''}${before ? `&before=${before}` : ''}`;
      const r = await api.full.get<any[]>(`/locations/${branchId}/history?${qs}`);
      setRows((prev) => (before && prev ? [...prev, ...r.data] : r.data));
      setNext(r.meta?.next ?? null);
      setMore(!!r.meta?.hasMore);
      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }, [branchId, entityType]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <label htmlFor="ht" className="label">{t('typeLabel')}</label>
        <Select id="ht" className="field" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">{t('allTypes')}</option>
          {TYPES.map((x) => <option key={x} value={x}>{label(x)}</option>)}
        </Select>
      </div>
      <ErrorBox error={error} />
      {!rows ? <Skeleton className="h-64" /> : rows.length === 0 ? <p className="card text-slate-600">{t('noHistory')}</p> : (
        <ol className="space-y-3">
          {rows.map((r) => {
            const fields = visibleFields(r);
            return (
              <li key={r.id} className="card space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className={`chip ${ACTION_CLS[r.action] ?? 'border-slate-300 bg-slate-100 text-slate-700'}`}>{label(r.action)}</span>
                  <b>{label(r.entityType)}</b>
                  {r.entityCode && <span className="text-slate-500">{r.entityCode}</span>}
                  <span className="ml-auto text-xs text-slate-500">{prettyDate(todayIST(new Date(r.occurredAt)))} · {prettyTime(r.occurredAt)}</span>
                </div>
                <p className="text-xs text-slate-500">{t('actor')}: {r.actorName ?? '—'}{r.actorRole ? ` (${label(r.actorRole)})` : ''}{r.source === 'PWA_OFFLINE' ? ' · offline' : ''}</p>
                {fields.length > 0 && (
                  <ul className="space-y-0.5 rounded-card bg-slate-50 px-3 py-2 text-sm">
                    {fields.slice(0, 8).map((f) => (
                      <li key={f}><span className="text-slate-500">{label(f)}:</span>{' '}
                        {r.action === 'CREATE' ? <b>{show(r.newValues?.[f])}</b> : <><span className="text-slate-500 line-through">{show(r.oldValues?.[f])}</span> → <b>{show(r.newValues?.[f])}</b></>}
                      </li>
                    ))}
                    {fields.length > 8 && <li className="text-slate-500">+{fields.length - 8}</li>}
                  </ul>
                )}
                {r.reason && <p className="text-sm">“{r.reason}”</p>}
              </li>
            );
          })}
        </ol>
      )}
      {more && <button className="btn-secondary w-full" disabled={busy} onClick={() => load(next ?? undefined)}>{busy ? t('loading') : t('loadMore')}</button>}
    </div>
  );
}
