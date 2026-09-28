'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { amt, formatINR } from '@/lib/money';
import { ErrorBox, MoneyInput, Skeleton } from '../ui';

interface Limit { id: string; roleId: string; roleCode?: string; roleName?: string; entityType: string; maxAmount: string }
interface RoleRow { id: string; code: string; name: string; status: string }
const ENTITY_TYPES = ['EXPENSE', 'PURCHASE', 'ADVANCE', 'WASTAGE', 'CASH_VARIANCE'] as const;
const ET_KEY: Record<string, string> = { EXPENSE: 'etExpense', PURCHASE: 'etPurchase', ADVANCE: 'etAdvance', WASTAGE: 'etWastage', CASH_VARIANCE: 'etCashVariance' };

/** Owner: the most a role can approve alone for each transaction type; anything above needs the next approver. */
export function ApprovalLimits() {
  const { t } = useT();
  const [limits, setLimits] = useState<Limit[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [l, r] = await Promise.all([api.get('/approval-limits'), api.get('/roles')]); setLimits(l); setRoles(r); setError(null); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(roleCode: string, entityType: string) {
    const key = `${roleCode}:${entityType}`;
    const value = edits[key];
    if (!value) return;
    setBusyKey(key); setError(null);
    try { await api.put('/approval-limits', { roleCode, entityType, maxAmount: amt(value) }); setNotice(t('limitSaved')); setTimeout(() => setNotice(null), 2500); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusyKey(null); }
  }

  if (!limits) return error ? <ErrorBox error={error} /> : <Skeleton className="h-64" />;
  const activeRoles = roles.filter((r) => r.status === 'ACTIVE');

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-slate-600">{t('approvalLimitsHint')}</p>
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      <div className="space-y-4">
        {activeRoles.map((role) => (
          <div key={role.id} className="card space-y-2">
            <p className="font-semibold">{role.name}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ENTITY_TYPES.map((et) => {
                const existing = limits.find((l) => l.roleCode === role.code && l.entityType === et);
                const key = `${role.code}:${et}`;
                const value = edits[key] ?? existing?.maxAmount ?? '';
                return (
                  <div key={et} className="flex items-end gap-2">
                    <div className="flex-1">
                      <MoneyInput id={key} label={t(ET_KEY[et] as any)} value={value} onChange={(v) => setEdits((e) => ({ ...e, [key]: v }))} />
                    </div>
                    <button className="btn-secondary mb-0.5 min-h-[44px] px-3 text-sm" disabled={busyKey === key || !edits[key] || edits[key] === existing?.maxAmount} onClick={() => save(role.code, et)}>
                      {busyKey === key ? '…' : t('save')}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-400">
              {ENTITY_TYPES.filter((et) => limits.some((l) => l.roleCode === role.code && l.entityType === et)).map((et) => `${t(ET_KEY[et] as any)}: ${formatINR(limits.find((l) => l.roleCode === role.code && l.entityType === et)!.maxAmount)}`).join(' · ')}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
