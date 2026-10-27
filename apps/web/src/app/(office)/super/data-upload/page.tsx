'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Select';
import { ErrorBox, Skeleton, TextField } from '@/components/ui';
import { api, ApiError, downloadFile } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

interface Company { id: string; code: string; name: string; status: string }
interface Branch { id: string; code: string; name: string }
interface Issue { sheet: string; row: number; message: string }
interface Result {
  dryRun: boolean;
  company: { name: string };
  branch: { id: string | null; code: string | null; name: string; isNew: boolean };
  ledgerDate: string | null;
  expenses: { count: number; total: string; skipped: number; rows: Array<{ row: number; date: string; category: string; subCategory: string; amount: string; mode: string; description: string; note?: string }> };
  staff: { count: number; total: string; skipped: number; newEmployees: string[]; rows: Array<{ row: number; date: string; name: string; amount: string; isNewEmployee: boolean }> };
  opening: { cash: string | null; applied: boolean };
  sales: { date: string; total: string } | null;
  errors: Issue[];
  warnings: Issue[];
}

const NEW = 'NEW';

/** Super Admin: load a ledger workbook into one company's branch (preview first, then import). */
export default function DataUploadPage() {
  const { t } = useT();
  const { can } = useSession();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(NEW);
  const [nb, setNb] = useState({ name: '', address: '', manager: '', mobile: '' });
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Company[]>('/super/companies').then((r) => { setCompanies(r); }).catch((e) => setError(e.message));
  }, []);

  // the branch list follows the company; "New Branch" is always the first choice
  useEffect(() => {
    setBranchId(NEW); setBranches([]); setResult(null); setDone(null);
    if (!companyId) return;
    api.get<Branch[]>(`/super/companies/${companyId}/branches`).then(setBranches).catch((e) => setError(e.message));
  }, [companyId]);

  const isNew = branchId === NEW;
  const mobileOk = /^\d{10}$/.test(nb.mobile);
  const branchReady = !isNew || (nb.name.trim() && nb.address.trim() && nb.manager.trim() && mobileOk);
  const ready = !!companyId && !!file && branchReady;
  const touch = () => { setResult(null); setDone(null); };

  function form(dryRun: boolean) {
    const f = new FormData();
    f.append('file', file!);
    f.append('companyId', companyId);
    f.append('branchId', branchId);
    f.append('dryRun', String(dryRun));
    if (isNew) {
      f.append('newBranchName', nb.name.trim());
      f.append('newBranchAddress', nb.address.trim());
      f.append('managerName', nb.manager.trim());
      f.append('managerMobile', nb.mobile);
    }
    return f;
  }

  async function run(dryRun: boolean) {
    if (!ready || busy) return;
    setBusy(dryRun ? 'preview' : 'import'); setError(null); setDone(null);
    try {
      const r = await api.postForm<Result>('/super/data-upload', form(dryRun));
      if (dryRun) setResult(r);
      else {
        setResult(null);
        setFile(null);
        if (fileRef.current) fileRef.current.value = '';
        setDone(`Imported ${r.expenses.count} expense${r.expenses.count === 1 ? '' : 's'} and ${r.staff.count} staff payment${r.staff.count === 1 ? '' : 's'} into ${r.branch.name} (${r.branch.code ?? 'new branch'}). They are waiting for approval in ${r.company.name}.`);
        if (isNew) api.get<Branch[]>(`/super/companies/${companyId}/branches`).then((b) => { setBranches(b); setBranchId(r.branch.id ?? NEW); });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IMPORT_HAS_ERRORS' && Array.isArray(e.details)) setError(`${e.message}\n${(e.details as Issue[]).map((i) => `${i.sheet} row ${i.row}: ${i.message}`).join('\n')}`);
      else setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally { setBusy(null); }
  }

  if (!can('company:manage')) return <p className="card">{t('noAccess')}</p>;
  const blocked = !!result && result.errors.length > 0;
  const empty = !!result && result.expenses.count === 0 && result.staff.count === 0 && !result.sales;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t('dataUploadTitle')}</h2>
          <p className="text-sm text-slate-600">Load a ledger workbook into a company&apos;s branch. Rows arrive as pending records for the company to approve.</p>
        </div>
        <button className="btn-secondary" onClick={() => void downloadFile('/super/sample-ledger', 'tea_shop_ledger_sample.xlsx').catch((e) => setError(e.message))}>
          <Icon name="box" size={18} /> Download sample Excel
        </button>
      </div>

      <ErrorBox error={error} />
      {done && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">✓ {done}</p>}

      <section className="card space-y-4">
        {!companies ? <Skeleton className="h-24" /> : (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="company" className="label">Company *</label>
              <Select id="company" className="field" value={companyId} onChange={(e) => { setCompanyId(e.target.value); }}>
                <option value="">Select company…</option>
                {companies.filter((c) => c.status === 'ACTIVE').map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </Select>
            </div>
            <div>
              <label htmlFor="branch" className="label">Branch *</label>
              <Select id="branch" className="field" value={branchId} disabled={!companyId} onChange={(e) => { setBranchId(e.target.value); touch(); }}>
                <option value={NEW}>New Branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            </div>
          </div>
        )}

        {companyId && isNew && (
          <div className="grid gap-3 rounded-card border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
            <p className="text-sm font-semibold md:col-span-2">New branch details</p>
            <TextField id="nbn" label="Branch name *" value={nb.name} onChange={(e) => { setNb({ ...nb, name: e.target.value }); touch(); }} maxLength={100} />
            <TextField id="nbm" label="Manager's name *" value={nb.manager} onChange={(e) => { setNb({ ...nb, manager: e.target.value }); touch(); }} maxLength={100} />
            <div className="md:col-span-2"><TextField id="nba" label="Branch address *" value={nb.address} onChange={(e) => { setNb({ ...nb, address: e.target.value }); touch(); }} maxLength={500} /></div>
            <div>
              <TextField id="nbp" label="Manager's mobile number *" inputMode="numeric" value={nb.mobile} placeholder="10 digits" onChange={(e) => { setNb({ ...nb, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }); touch(); }} />
              <p className="mt-1 text-xs text-slate-500">The manager signs in with this number and an OTP.</p>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="file" className="label">Excel file (.xlsx) *</label>
          <input
            ref={fileRef} id="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="field file:mr-3 file:rounded-lg file:border-0 file:bg-brand-light file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); touch(); }}
          />
          <p className="mt-1 text-xs text-slate-500">Uses the sheets Expenses, Staff_Payments and Daily_Closing, and the ledger date on README. The sample shows the layout.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className="btn-secondary" disabled={!ready || !!busy} onClick={() => void run(true)}>{busy === 'preview' ? t('loading') : 'Check file'}</button>
          <button className="btn-primary" disabled={!ready || !!busy || !result || blocked || empty} onClick={() => void run(false)}>{busy === 'import' ? t('loading') : 'Import'}</button>
        </div>
      </section>

      {result && (
        <section className="card space-y-4" aria-label="Preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Preview · {result.company.name} · {result.branch.isNew ? `New branch: ${result.branch.name}` : `${result.branch.code} · ${result.branch.name}`}</h3>
            <span className="text-sm text-slate-600">{result.ledgerDate ? `Ledger date ${prettyDate(result.ledgerDate)}` : 'No ledger date'}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Expenses" value={`${result.expenses.count}`} sub={formatINR(result.expenses.total)} note={result.expenses.skipped ? `${result.expenses.skipped} already imported` : undefined} />
            <Stat label="Staff payments" value={`${result.staff.count}`} sub={formatINR(result.staff.total)} note={result.staff.newEmployees.length ? `${result.staff.newEmployees.length} new staff record(s)` : undefined} />
            <Stat label="Opening cash" value={result.opening.cash ? formatINR(result.opening.cash) : '—'} sub={result.opening.applied ? 'will be set for the branch' : 'unchanged'} note={result.sales ? `Sales ${formatINR(result.sales.total)} on ${prettyDate(result.sales.date)}` : undefined} />
          </div>

          {result.errors.length > 0 && (
            <div role="alert" className="rounded-card border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              <p className="mb-1 font-semibold">Fix these before importing</p>
              <ul className="list-disc space-y-0.5 pl-5">{result.errors.map((i, n) => <li key={n}>{i.sheet}{i.row ? ` row ${i.row}` : ''}: {i.message}</li>)}</ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-1 font-semibold">Check these (they will still import)</p>
              <ul className="list-disc space-y-0.5 pl-5">{result.warnings.map((i, n) => <li key={n}>{i.sheet}{i.row ? ` row ${i.row}` : ''}: {i.message}</li>)}</ul>
            </div>
          )}
          {empty && result.errors.length === 0 && <p className="text-sm text-slate-600">Nothing new to import from this file.</p>}

          {result.expenses.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-left">Sub-category</th><th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-left">Mode</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                <tbody className="divide-y">
                  {result.expenses.rows.map((r) => (
                    <tr key={r.row}>
                      <td className="whitespace-nowrap px-3 py-2">{prettyDate(r.date)}</td>
                      <td className="px-3 py-2">{r.category}{r.note && <span className="ml-1 text-amber-700" title={r.note}>⚠</span>}</td>
                      <td className="px-3 py-2">{r.subCategory || '—'}</td>
                      <td className="px-3 py-2">{r.description || '—'}</td>
                      <td className="px-3 py-2">{r.mode}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, sub, note }: { label: string; value: string; sub: string; note?: string }) {
  return (
    <div className="rounded-card border border-slate-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-sm text-slate-600">{sub}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  );
}
