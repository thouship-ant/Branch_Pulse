'use client';

import { Select } from '@/components/Select';
import { DateInput } from '@/components/DateNav';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import type { LocationOption } from '../purchases/PurchaseForm';
import { ActiveChip, ErrorBox, Sheet, Skeleton, TextField } from '../ui';

const PAY_METHODS = ['CASH', 'BANK', 'UPI'] as const;

interface BankDetails { accountHolder?: string; accountNumber?: string; ifsc?: string; upiId?: string }
interface Draft {
  id?: string; fullName: string; locationId: string; jobRole: string; phone: string; joiningDate: string; exitDate: string;
  salaryType: 'MONTHLY' | 'DAILY'; baseSalary: string; overtimeRatePerHour: string; paymentMethod: (typeof PAY_METHODS)[number];
  bankDetails: BankDetails; active: boolean;
}

/** The owner's employee roster: name, branch, role, pay terms and (encrypted) bank details. No recruitment workflow. */
export function EmployeeManager({ locations, fixedLocationId }: { locations: LocationOption[]; fixedLocationId?: string }) {
  const { t, pick } = useT();
  const { can } = useSession();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bankView, setBankView] = useState<BankDetails | null | 'loading'>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get(`/employees?includeInactive=true${fixedLocationId ? `&locationId=${fixedLocationId}` : ''}`)); setError(null); }
    catch (e: any) { setError(e.message); }
  }, [fixedLocationId]);
  useEffect(() => { void load(); }, [load]);

  const blank = (): Draft => ({
    fullName: '', locationId: fixedLocationId ?? '', jobRole: '', phone: '', joiningDate: '', exitDate: '',
    salaryType: 'MONTHLY', baseSalary: '', overtimeRatePerHour: '', paymentMethod: 'CASH', bankDetails: {}, active: true,
  });
  const fromRow = (r: any): Draft => ({
    id: r.id, fullName: r.fullName, locationId: r.locationId, jobRole: r.jobRole, phone: r.phone ?? '', joiningDate: r.joiningDate.slice(0, 10),
    exitDate: r.exitDate ? r.exitDate.slice(0, 10) : '', salaryType: r.salaryType, baseSalary: String(r.baseSalary), overtimeRatePerHour: String(r.overtimeRatePerHour),
    paymentMethod: r.paymentMethod ?? 'CASH', bankDetails: {}, active: r.status === 'ACTIVE',
  });

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const body: Record<string, unknown> = {
        fullName: draft.fullName.trim(), locationId: draft.locationId, jobRole: draft.jobRole.trim(), phone: draft.phone.trim() || undefined,
        salaryType: draft.salaryType, baseSalary: draft.baseSalary, overtimeRatePerHour: draft.overtimeRatePerHour || undefined,
        paymentMethod: draft.paymentMethod, bankDetails: Object.values(draft.bankDetails).some((v) => v?.trim()) ? draft.bankDetails : undefined,
      };
      if (draft.id) {
        await api.patch(`/employees/${draft.id}`, { ...body, exitDate: draft.exitDate || null, active: draft.active });
      } else {
        await api.post('/employees', { ...body, joiningDate: draft.joiningDate });
      }
      setDraft(null); await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save');
    } finally { setBusy(false); }
  }

  async function viewBank(id: string) {
    setBankView('loading');
    try { setBankView(await api.get(`/employees/${id}/bank-details`)); } catch { setBankView(null); }
  }

  const canManage = can('staff:manage');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{t('employeesTitle')}</h3>
        {canManage && <button className="btn-primary" onClick={() => { setFormError(null); setDraft(blank()); }}>+ {t('addEmployee')}</button>}
      </div>
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-48" /> : rows.length === 0 ? <p className="card text-slate-600">{t('noEmployees')}</p> : (
        <section className="card overflow-x-auto p-0" aria-label={t('employeesTitle')}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('employeeNameLabel')}</th>
                {!fixedLocationId && <th scope="col" className="px-3 py-2 text-left">{t('branch')}</th>}
                <th scope="col" className="px-3 py-2 text-left">{t('jobRoleLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('baseSalaryLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('status')}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className={r.status !== 'ACTIVE' ? 'text-slate-500' : ''}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {r.fullName}
                    <p className="font-mono text-xs font-normal text-slate-500">{r.code}{r.hasBankDetails ? ` · ${t('hasBank')}` : ''}</p>
                  </th>
                  {!fixedLocationId && <td className="px-3 py-2">{r.locationCode}</td>}
                  <td className="px-3 py-2">{r.jobRole}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.baseSalary)}{r.salaryType === 'DAILY' ? ` / ${t('salaryTypeDaily').toLowerCase()}` : ''}</td>
                  <td className="px-3 py-2"><ActiveChip active={r.status === 'ACTIVE'} /></td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      {canManage && r.hasBankDetails && <button className="btn-secondary min-h-[34px] px-3 text-xs" onClick={() => viewBank(r.id)}>{t('viewBankDetails')}</button>}
                      {canManage && <button className="btn-secondary min-h-[34px] px-3 text-xs" onClick={() => { setFormError(null); setDraft(fromRow(r)); }}>{t('edit')}</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft ? (draft.id ? t('editEmployee') : t('addEmployee')) : ''}>
        {draft && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField id="en" label={`${t('employeeNameLabel')} *`} value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} maxLength={100} />
              <TextField id="ejr" label={`${t('jobRoleLabel')} *`} value={draft.jobRole} onChange={(e) => setDraft({ ...draft, jobRole: e.target.value })} maxLength={40} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {!fixedLocationId && (
                <div>
                  <label htmlFor="eloc" className="label">{t('branch')} *</label>
                  <Select id="eloc" className="field" value={draft.locationId} onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}>
                    <option value="">{t('chooseLocation')}</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
                  </Select>
                </div>
              )}
              <TextField id="ephone" label={t('phone')} inputMode="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value.replace(/[^\d+\s-]/g, '') })} maxLength={15} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {!draft.id && <div><label htmlFor="ejd" className="label">{t('joiningDateLabel')} *</label><DateInput id="ejd" value={draft.joiningDate} onChange={(v) => setDraft({ ...draft, joiningDate: v })} /></div>}
              {draft.id && <div><label htmlFor="exd" className="label">{t('exitDateLabel')}</label><DateInput id="exd" value={draft.exitDate} onChange={(v) => setDraft({ ...draft, exitDate: v })} /></div>}
              <div>
                <label htmlFor="est" className="label">{t('salaryTypeLabel')}</label>
                <Select id="est" className="field" value={draft.salaryType} onChange={(e) => setDraft({ ...draft, salaryType: e.target.value as any })}>
                  <option value="MONTHLY">{t('salaryTypeMonthly')}</option>
                  <option value="DAILY">{t('salaryTypeDaily')}</option>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ebs" className="label">{t('baseSalaryLabel')} *</label>
                <input id="ebs" className="field text-lg tabular-nums" inputMode="decimal" value={draft.baseSalary} onChange={(e) => setDraft({ ...draft, baseSalary: e.target.value.replace(/[^\d.]/g, '') })} />
              </div>
              <div>
                <label htmlFor="eot" className="label">{t('overtimeRateLabel')}</label>
                <input id="eot" className="field text-lg tabular-nums" inputMode="decimal" placeholder="0" value={draft.overtimeRatePerHour} onChange={(e) => setDraft({ ...draft, overtimeRatePerHour: e.target.value.replace(/[^\d.]/g, '') })} />
              </div>
            </div>
            <div>
              <label htmlFor="epm" className="label">{t('paymentMethodLabel')}</label>
              <Select id="epm" className="field" value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value as any })}>
                <option value="CASH">{t('payCash')}</option>
                <option value="BANK">{t('payBank')}</option>
                <option value="UPI">{t('payUpi')}</option>
              </Select>
            </div>
            {(draft.paymentMethod === 'BANK' || draft.paymentMethod === 'UPI') && (
              <div className="space-y-2 rounded-card border border-slate-200 p-3">
                <p className="label">{t('bankDetailsLabel')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <TextField id="ebh" label={t('accountHolderLabel')} value={draft.bankDetails.accountHolder ?? ''} onChange={(e) => setDraft({ ...draft, bankDetails: { ...draft.bankDetails, accountHolder: e.target.value } })} />
                  {draft.paymentMethod === 'BANK' ? (
                    <>
                      <TextField id="eban" label={t('accountNumberLabel')} value={draft.bankDetails.accountNumber ?? ''} onChange={(e) => setDraft({ ...draft, bankDetails: { ...draft.bankDetails, accountNumber: e.target.value } })} />
                      <TextField id="eifsc" label={t('ifscLabel')} value={draft.bankDetails.ifsc ?? ''} onChange={(e) => setDraft({ ...draft, bankDetails: { ...draft.bankDetails, ifsc: e.target.value.toUpperCase() } })} />
                    </>
                  ) : (
                    <TextField id="eupi" label={t('upiIdLabel')} value={draft.bankDetails.upiId ?? ''} onChange={(e) => setDraft({ ...draft, bankDetails: { ...draft.bankDetails, upiId: e.target.value } })} />
                  )}
                </div>
              </div>
            )}
            {draft.id && (
              <label className="flex min-h-touch items-center gap-3 px-1">
                <input type="checkbox" className="h-5 w-5 accent-[#1e2a8a]" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />{t('active')}
              </label>
            )}
            <ErrorBox error={formError} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDraft(null)}>{t('cancel')}</button>
              <button className="btn-primary" disabled={busy || !draft.fullName.trim() || !draft.jobRole.trim() || !draft.locationId || !dec(draft.baseSalary || '0').greaterThan(0) || (!draft.id && !draft.joiningDate)} onClick={save}>
                {busy ? t('loading') : t('save')}
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={bankView !== null} onClose={() => setBankView(null)} title={t('bankDetailsLabel')}>
        {bankView === 'loading' ? <Skeleton className="h-24" /> : bankView && (
          <div className="space-y-2 text-sm">
            {bankView.accountHolder && <p><span className="text-slate-500">{t('accountHolderLabel')}:</span> <b>{bankView.accountHolder}</b></p>}
            {bankView.accountNumber && <p><span className="text-slate-500">{t('accountNumberLabel')}:</span> <b className="tabular-nums">{bankView.accountNumber}</b></p>}
            {bankView.ifsc && <p><span className="text-slate-500">{t('ifscLabel')}:</span> <b>{bankView.ifsc}</b></p>}
            {bankView.upiId && <p><span className="text-slate-500">{t('upiIdLabel')}:</span> <b>{bankView.upiId}</b></p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}
