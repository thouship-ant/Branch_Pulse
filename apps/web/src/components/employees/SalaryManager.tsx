'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { STATUS_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import type { LocationOption } from '../purchases/PurchaseForm';
import { ErrorBox, Sheet, Skeleton } from '../ui';

interface Employee { id: string; fullName: string; code: string }
const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'] as const;
const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Monthly payroll: basic + overtime - advance recovery - deductions = payable, then approve and pay. Owner / accountant only. */
export function SalaryManager({ locations }: { locations: LocationOption[] }) {
  const { t, pick } = useT();
  const { can } = useSession();
  const [locationId, setLocationId] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<any[] | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeEmployeeId, setComputeEmployeeId] = useState('');
  const [paying, setPaying] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState<(typeof MODES)[number]>('BANK_TRANSFER');

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ month });
      if (locationId) q.set('locationId', locationId);
      setRows(await api.get(`/salary?${q}`));
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [locationId, month]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!locationId) { setEmployees([]); return; }
    api.get(`/employees?locationId=${locationId}`).then(setEmployees).catch(() => setEmployees([]));
  }, [locationId]);

  async function computeOne() {
    setBusy('compute'); setError(null);
    try { await api.post('/salary/compute', { employeeId: computeEmployeeId, month }); setComputing(false); setComputeEmployeeId(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }
  async function computeBranch() {
    setBusy('computeBranch'); setError(null);
    try { await api.post('/salary/compute-location', { locationId, month }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }
  async function approve(id: string) {
    setBusy(id); setError(null);
    try { await api.post(`/salary/${id}/approve`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }
  async function pay() {
    if (!paying) return;
    setBusy(paying.id); setError(null);
    try { await api.post(`/salary/${paying.id}/pay`, { amount: payAmount, paymentMode: payMode }); setPaying(null); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <label htmlFor="sml" className="label">{t('branch')}</label>
            <select id="sml" className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </select>
          </div>
          <div><label htmlFor="smm" className="label">{t('monthLabel')}</label><input id="smm" type="month" className="field" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value || thisMonth())} /></div>
        </div>
        {locationId && (
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={busy === 'computeBranch'} onClick={computeBranch}>{t('computeForBranch')}</button>
            <button className="btn-primary" onClick={() => setComputing(true)}>+ {t('computeSalary')}</button>
          </div>
        )}
      </div>
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-48" /> : rows.length === 0 ? <p className="card text-slate-600">{t('noSalary')}</p> : (
        <section className="card overflow-x-auto p-0" aria-label={t('salaryManageTitle')}>
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('employeeNameLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('presentDaysLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('basicEarnedLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('overtimeAmountLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('advanceRecoveryLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('payableLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">{s.employeeName}<p className="font-mono text-xs font-normal text-slate-500">{s.employeeCode}</p></th>
                  <td className="px-3 py-2 text-right tabular-nums">{dec(s.presentDays).toString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(s.basicEarned)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(s.overtimeAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dec(s.advanceRecovery).greaterThan(0) ? `-${formatINR(s.advanceRecovery)}` : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(s.payable)}</td>
                  <td className="px-3 py-2">
                    <span className="chip border-slate-300 bg-slate-100 text-slate-700">{t(STATUS_KEY[s.approvalStatus] ?? 'pending')}</span>
                    {s.paymentStatus !== 'UNPAID' && <p className="mt-1 text-xs text-slate-500">{formatINR(s.paidAmount)} {t('paidAmountLabel').toLowerCase()}</p>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {s.approvalStatus === 'DRAFT' && can('salary:approve') && (
                      <button className="btn-primary min-h-[34px] px-3 text-xs" disabled={busy === s.id} onClick={() => approve(s.id)}>{t('approveSalaryAction')}</button>
                    )}
                    {s.approvalStatus === 'APPROVED' && s.paymentStatus !== 'PAID' && can('salary:pay') && (
                      <button className="btn-primary min-h-[34px] px-3 text-xs" onClick={() => { setPayAmount(String(dec(s.payable).minus(s.paidAmount))); setPayMode('BANK_TRANSFER'); setPaying(s); }}>{t('paySalaryAction')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Sheet open={computing} onClose={() => setComputing(false)} title={t('computeSalary')}>
        <div className="space-y-3">
          <div>
            <label htmlFor="smemp" className="label">{t('employeeNameLabel')} *</label>
            <select id="smemp" className="field" value={computeEmployeeId} onChange={(e) => setComputeEmployeeId(e.target.value)}>
              <option value="">{t('chooseItem')}</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.code})</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setComputing(false)}>{t('cancel')}</button>
            <button className="btn-primary" disabled={busy === 'compute' || !computeEmployeeId} onClick={computeOne}>{t('save')}</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!paying} onClose={() => setPaying(null)} title={t('paySalaryAction')}>
        <div className="space-y-3">
          <div>
            <label htmlFor="smpa" className="label">{t('payAmountLabel')}</label>
            <input id="smpa" className="field text-lg tabular-nums" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
          <div>
            <label htmlFor="smpm" className="label">{t('paymentMethodLabel')}</label>
            <select id="smpm" className="field" value={payMode} onChange={(e) => setPayMode(e.target.value as any)}>
              {MODES.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setPaying(null)}>{t('cancel')}</button>
            <button className="btn-primary" disabled={!dec(payAmount || '0').greaterThan(0)} onClick={pay}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
