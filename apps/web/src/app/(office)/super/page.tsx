'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { AutoTextarea, ErrorBox, Sheet, Skeleton, TextField } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

interface Company {
  id: string; code: string; name: string; address: string | null; gstin: string | null; fssai: string | null; email: string | null; status: string;
  branchCount: number; admin: { name: string; mobile: string; status: string } | null;
}

const EMPTY = { companyName: '', adminName: '', mobile: '', email: '', address: '', gstin: '', fssai: '', password: '' };
type Form = typeof EMPTY;

/** Server field errors ([{field,message}]) -> { field: message } so each shows under its own box. */
const fieldErrors = (e: unknown): Record<string, string> =>
  e instanceof ApiError && Array.isArray(e.details) ? Object.fromEntries(e.details.filter((d: any) => d?.field).map((d: any) => [d.field, d.message])) : {};

/** Super Admin: every company on the platform, and a form to add one with its first Admin. */
export default function CompaniesPage() {
  const { t } = useT();
  const { can } = useSession();
  const [rows, setRows] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api.get('/super/companies')); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function confirmToggle() {
    if (!toggling) return;
    setBusy(true);
    try {
      await api.patch(`/super/companies/${toggling.id}`, { status: toggling.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
      setToggling(null);
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not update'); setToggling(null); }
    finally { setBusy(false); }
  }

  if (!can('company:manage')) return <p className="card">{t('noAccess')}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t('companiesTitle')}</h2>
          <p className="text-sm text-slate-600">Each company has its own branches, staff and data. Only you can see all of them.</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> New company</button>
      </div>
      <ErrorBox error={error} />

      {!rows ? <Skeleton className="h-48" /> : rows.length === 0 ? (
        <div className="card text-center text-slate-600">No companies yet. Add the first one.</div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id} className="card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-slate-500">{c.code}</p>
                  <h3 className="truncate text-lg font-bold">{c.name}</h3>
                </div>
                <span className={`chip shrink-0 ${c.status === 'ACTIVE' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-100 text-slate-600'}`}>
                  {c.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                </span>
              </div>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Admin</dt><dd className="font-medium">{c.admin ? `${c.admin.name} · ${c.admin.mobile}` : '—'}</dd></div>
                <div><dt className="text-slate-500">Email</dt><dd className="truncate font-medium">{c.email ?? '—'}</dd></div>
                <div><dt className="text-slate-500">GSTIN</dt><dd className="font-medium tabular-nums">{c.gstin ?? '—'}</dd></div>
                <div><dt className="text-slate-500">FSSAI</dt><dd className="font-medium tabular-nums">{c.fssai ?? '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">Main shop / head office</dt><dd className="font-medium">{c.address ?? '—'}</dd></div>
              </dl>
              <div className="flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-slate-600">{c.branchCount} {c.branchCount === 1 ? 'branch' : 'branches'}</span>
                <button className="font-semibold text-brand hover:underline" onClick={() => setToggling(c)}>{c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="New company">
        <CompanyForm onSaved={() => { setAdding(false); void load(); }} />
      </Sheet>

      <Sheet open={!!toggling} onClose={() => setToggling(null)} title={toggling?.status === 'ACTIVE' ? 'Deactivate company?' : 'Activate company?'}>
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            {toggling?.status === 'ACTIVE'
              ? `Nobody in ${toggling?.name} will be able to sign in until you activate it again. Their data is kept.`
              : `People in ${toggling?.name} will be able to sign in again.`}
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setToggling(null)}>{t('cancel')}</button>
            <button className={toggling?.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={confirmToggle}>{busy ? t('loading') : t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function CompanyForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useT();
  const [f, setF] = useState<Form>(EMPTY);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof Form, v: string) => { setF((s) => ({ ...s, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };

  const mobileOk = /^\d{10}$/.test(f.mobile);
  const ready = f.companyName.trim() && f.adminName.trim() && mobileOk && /^\S+@\S+\.\S+$/.test(f.email) && f.address.trim().length >= 5 && f.password.length >= 8;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setErrors({});
    try {
      await api.post('/super/companies', {
        companyName: f.companyName.trim(), adminName: f.adminName.trim(), mobile: f.mobile, email: f.email.trim(), address: f.address.trim(),
        gstin: f.gstin.trim().toUpperCase() || undefined, fssai: f.fssai.trim() || undefined, password: f.password,
      });
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err instanceof ApiError ? err.message : 'Could not create the company');
      setBusy(false);
    }
  }

  const err = (k: string) => errors[k] && <p className="mt-1 text-sm text-red-700">{errors[k]}</p>;

  return (
    <form onSubmit={submit} className="space-y-4">
      <TextField id="cn" label="Company name *" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} maxLength={120} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><TextField id="an" label="Admin full name *" value={f.adminName} onChange={(e) => set('adminName', e.target.value)} maxLength={100} required />{err('adminName')}</div>
        <div>
          <TextField id="am" label="Admin mobile number *" inputMode="numeric" value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits" required />
          {err('mobile')}
        </div>
      </div>
      <div><TextField id="ae" label="Email *" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required />{err('email')}</div>
      <div>
        <AutoTextarea id="ad" label="Main shop / head office address *" value={f.address} onChange={(v) => set('address', v)} minRows={2} />
        {err('address')}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><TextField id="gs" label="GSTIN (optional)" value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))} placeholder="33ABCDE1234F1Z5" />{err('gstin')}</div>
        <div><TextField id="fs" label="FSSAI licence no. (optional)" inputMode="numeric" value={f.fssai} onChange={(e) => set('fssai', e.target.value.replace(/\D/g, '').slice(0, 14))} placeholder="14 digits" />{err('fssai')}</div>
      </div>
      <div>
        <label htmlFor="pw" className="label">Admin password * <span className="font-normal text-slate-500">(the Admin signs in with this and an OTP)</span></label>
        <div className="relative">
          <input id="pw" className="field pr-12" type={show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} minLength={8} required />
          <button
            type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('hidePassword') : t('showPassword')} aria-pressed={show}
            className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          >
            <Icon name={show ? 'eyeOff' : 'eye'} size={19} />
          </button>
        </div>
        {err('password') ?? <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>}
      </div>
      <ErrorBox error={error} />
      <button className="btn-primary w-full" disabled={busy || !ready}>{busy ? t('loading') : 'Create company'}</button>
    </form>
  );
}
