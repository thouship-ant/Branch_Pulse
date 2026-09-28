'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { ADVANCE_STATUS_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import type { LocationOption } from '../purchases/PurchaseForm';
import { ErrorBox, Sheet, Skeleton, TextField } from '../ui';

interface Employee { id: string; fullName: string; code: string }
const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'] as const;

/** Employee -> advance request -> manager approval -> owner/accountant approval -> payment; recovered later from salary or cash. */
export function AdvanceManager({ locations, fixedLocationId }: { locations: LocationOption[]; fixedLocationId?: string }) {
  const { t, pick } = useT();
  const { can } = useSession();
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [rows, setRows] = useState<any[] | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [reqForm, setReqForm] = useState({ employeeId: '', amount: '', reason: '', monthlyRecovery: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [paying, setPaying] = useState<any | null>(null);
  const [payMode, setPayMode] = useState<(typeof MODES)[number]>('CASH');
  const [repaying, setRepaying] = useState<any | null>(null);
  const [repayAmount, setRepayAmount] = useState('');

  const load = useCallback(async () => {
    try {
      const q = locationId ? `?locationId=${locationId}` : '';
      setRows(await api.get(`/advances${q}`));
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [locationId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!locationId) { setEmployees([]); return; }
    api.get(`/employees?locationId=${locationId}`).then(setEmployees).catch(() => setEmployees([]));
  }, [locationId]);

  async function act(id: string, action: string, body?: unknown) {
    setBusy(id); setError(null);
    try { await api.post(`/advances/${id}/${action}`, body); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  async function request() {
    setFormError(null); setBusy('new');
    try {
      await api.post('/advances', {
        employeeId: reqForm.employeeId, amount: reqForm.amount, reason: reqForm.reason.trim(),
        monthlyRecovery: reqForm.monthlyRecovery || undefined,
      });
      setRequesting(false); setReqForm({ employeeId: '', amount: '', reason: '', monthlyRecovery: '' }); await load();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {!fixedLocationId && (
          <div className="min-w-[220px]">
            <label htmlFor="advl" className="label">{t('branch')}</label>
            <select id="advl" className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </select>
          </div>
        )}
        {can('advance:request') && locationId && <button className="btn-primary" onClick={() => { setFormError(null); setRequesting(true); }}>+ {t('requestAdvance')}</button>}
      </div>
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-48" /> : rows.length === 0 ? <p className="card text-slate-600">{t('noAdvances')}</p> : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id} className="card space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{a.employeeName}<span className="ml-2 font-mono text-xs text-slate-500">{a.code}</span></p>
                  <p className="text-xs text-slate-500">{prettyDate(a.requestDate.slice(0, 10))} · {a.reason}</p>
                </div>
                <span className="chip border-slate-300 bg-slate-100 text-slate-700">{t(ADVANCE_STATUS_KEY[a.status] ?? 'pending')}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><p className="text-xs text-slate-500">{t('advanceAmountLabel')}</p><p className="font-semibold tabular-nums">{formatINR(a.amount)}</p></div>
                <div><p className="text-xs text-slate-500">{t('paidAmountLabel')}</p><p className="font-semibold tabular-nums">{formatINR(a.paidAmount)}</p></div>
                <div><p className="text-xs text-slate-500">{t('remainingAmountLabel')}</p><p className="font-semibold tabular-nums">{formatINR(a.remainingAmount)}</p></div>
              </div>
              {a.rejectionReason && <p className="text-xs text-red-700">✕ {a.rejectionReason}</p>}
              <div className="flex flex-wrap gap-1.5">
                {a.status === 'REQUESTED' && can('advance:manager_approve') && (
                  <button className="btn-primary min-h-[34px] px-3 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'manager-approve')}>{t('managerApproveAction')}</button>
                )}
                {a.status === 'MANAGER_APPROVED' && can('advance:approve') && (
                  <button className="btn-primary min-h-[34px] px-3 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'approve')}>{t('finalApproveAction')}</button>
                )}
                {(a.status === 'REQUESTED' || a.status === 'MANAGER_APPROVED') && (can('advance:manager_approve') || can('advance:approve')) && (
                  <button className="btn-danger min-h-[34px] px-3 text-xs" disabled={busy === a.id} onClick={() => { setReason(''); setRejecting(a); }}>{t('reject')}</button>
                )}
                {a.status === 'REQUESTED' && can('advance:request') && (
                  <button className="btn-secondary min-h-[34px] px-3 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'cancel', {})}>{t('cancel')}</button>
                )}
                {a.status === 'APPROVED' && can('advance:pay') && (
                  <button className="btn-primary min-h-[34px] px-3 text-xs" disabled={busy === a.id} onClick={() => { setPayMode('CASH'); setPaying(a); }}>{t('payAdvanceAction')}</button>
                )}
                {a.status === 'PAID' && dec(a.remainingAmount).greaterThan(0) && can('advance:pay') && (
                  <button className="btn-secondary min-h-[34px] px-3 text-xs" onClick={() => { setRepayAmount(String(a.remainingAmount)); setRepaying(a); }}>{t('repayAdvanceAction')}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={requesting} onClose={() => setRequesting(false)} title={t('requestAdvance')}>
        <div className="space-y-3">
          <div>
            <label htmlFor="advemp" className="label">{t('employeeNameLabel')} *</label>
            <select id="advemp" className="field" value={reqForm.employeeId} onChange={(e) => setReqForm({ ...reqForm, employeeId: e.target.value })}>
              <option value="">{t('chooseItem')}</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.code})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="advamt" className="label">{t('advanceAmountLabel')} *</label><input id="advamt" className="field text-lg tabular-nums" inputMode="decimal" value={reqForm.amount} onChange={(e) => setReqForm({ ...reqForm, amount: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div><label htmlFor="advmr" className="label">{t('monthlyRecoveryLabel')}</label><input id="advmr" className="field text-lg tabular-nums" inputMode="decimal" placeholder="0" value={reqForm.monthlyRecovery} onChange={(e) => setReqForm({ ...reqForm, monthlyRecovery: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          </div>
          <TextField id="advreason" label={`${t('advanceReasonLabel')} *`} value={reqForm.reason} onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })} maxLength={500} />
          <ErrorBox error={formError} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRequesting(false)}>{t('cancel')}</button>
            <button className="btn-primary" disabled={busy === 'new' || !reqForm.employeeId || !dec(reqForm.amount || '0').greaterThan(0) || !reqForm.reason.trim()} onClick={request}>{t('save')}</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={t('reject')}>
        <div className="space-y-3">
          <label htmlFor="advrr" className="label">{t('reason')} *</label>
          <textarea id="advrr" className="field min-h-[96px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRejecting(null)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={!reason.trim()} onClick={async () => { await act(rejecting.id, 'reject', { reason }); setRejecting(null); }}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!paying} onClose={() => setPaying(null)} title={t('payAdvanceAction')}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{formatINR(paying?.amount)}</p>
          <div>
            <label htmlFor="advpm" className="label">{t('paymentMethodLabel')}</label>
            <select id="advpm" className="field" value={payMode} onChange={(e) => setPayMode(e.target.value as any)}>
              {MODES.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setPaying(null)}>{t('cancel')}</button>
            <button className="btn-primary" onClick={async () => { await act(paying.id, 'pay', { paymentMode: payMode }); setPaying(null); }}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!repaying} onClose={() => setRepaying(null)} title={t('repayAdvanceAction')}>
        <div className="space-y-3">
          <label htmlFor="advrp" className="label">{t('repayAmountLabel')} *</label>
          <input id="advrp" className="field text-lg tabular-nums" inputMode="decimal" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRepaying(null)}>{t('cancel')}</button>
            <button className="btn-primary" disabled={!dec(repayAmount || '0').greaterThan(0)} onClick={async () => { await act(repaying.id, 'repay', { amount: repayAmount }); setRepaying(null); }}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
