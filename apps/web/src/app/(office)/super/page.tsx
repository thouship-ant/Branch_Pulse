'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { PasswordChecklist } from '@/components/PasswordChecklist';
import { AutoTextarea, ErrorBox, Sheet, Skeleton, TextField } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { passwordOk } from '@/lib/password';
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
  const [editing, setEditing] = useState<Company | null>(null);
  const [usersOf, setUsersOf] = useState<Company | null>(null);
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
                <span className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                  <button className="font-semibold text-brand hover:underline" onClick={() => setUsersOf(c)}>Users</button>
                  <button className="font-semibold text-brand hover:underline" onClick={() => setEditing(c)}>Edit</button>
                  <button className="font-semibold text-brand hover:underline" onClick={() => setToggling(c)}>{c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="New company">
        <CompanyForm onSaved={() => { setAdding(false); void load(); }} />
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? 'company'}`}>
        {editing && <EditCompanyForm company={editing} onSaved={() => { setEditing(null); void load(); }} />}
      </Sheet>

      <Sheet open={!!usersOf} onClose={() => setUsersOf(null)} title={`Users · ${usersOf?.name ?? ''}`}>
        {usersOf && <CompanyUsers company={usersOf} onChanged={() => void load()} />}
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
  const ready = f.companyName.trim() && f.adminName.trim() && mobileOk && /^\S+@\S+\.\S+$/.test(f.email) && f.address.trim().length >= 5 && (!f.password || passwordOk(f.password));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setErrors({});
    try {
      await api.post('/super/companies', {
        companyName: f.companyName.trim(), adminName: f.adminName.trim(), mobile: f.mobile, email: f.email.trim(), address: f.address.trim(),
        gstin: f.gstin.trim().toUpperCase() || undefined, fssai: f.fssai.trim() || undefined, password: f.password || undefined,
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
        <label htmlFor="pw" className="label">Admin password <span className="font-normal text-slate-500">(optional: leave blank to use the default Admin@1234)</span></label>
        <div className="relative">
          <input id="pw" className="field pr-12" type={show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} />
          <button
            type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('hidePassword') : t('showPassword')} aria-pressed={show}
            className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          >
            <Icon name={show ? 'eyeOff' : 'eye'} size={19} />
          </button>
        </div>
        {err('password')}
        {f.password && <div className="mt-2"><PasswordChecklist value={f.password} /></div>}
        <p className="mt-1 text-xs text-slate-500">The Admin signs in with this and an OTP, and is asked to change it at the first sign-in.</p>
      </div>
      <ErrorBox error={error} />
      <button className="btn-primary w-full" disabled={busy || !ready}>{busy ? t('loading') : 'Create company'}</button>
    </form>
  );
}

/** Super Admin: change a company's details (name, address, email, GSTIN, FSSAI). */
function EditCompanyForm({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const [f, setF] = useState({ companyName: company.name, email: company.email ?? '', address: company.address ?? '', gstin: company.gstin ?? '', fssai: company.fssai ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };
  const err = (k: string) => errors[k] && <p className="mt-1 text-sm text-red-700">{errors[k]}</p>;
  const ready = f.companyName.trim().length >= 2 && f.address.trim().length >= 5 && /^\S+@\S+\.\S+$/.test(f.email);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setErrors({});
    try {
      await api.patch(`/super/companies/${company.id}`, {
        companyName: f.companyName.trim(), email: f.email.trim(), address: f.address.trim(), gstin: f.gstin.trim().toUpperCase(), fssai: f.fssai.trim(),
      });
      onSaved();
    } catch (e2) {
      setErrors(fieldErrors(e2));
      setError(e2 instanceof ApiError ? e2.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">Company code <span className="font-mono">{company.code}</span>. To change the Admin&apos;s mobile number or reset a password open <b>Users</b>.</p>
      <div><TextField id="ec-n" label="Company name *" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} maxLength={120} required />{err('companyName')}</div>
      <div><TextField id="ec-e" label="Email *" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required />{err('email')}</div>
      <div><AutoTextarea id="ec-a" label="Main shop / head office address *" value={f.address} onChange={(v) => set('address', v)} minRows={2} />{err('address')}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><TextField id="ec-g" label="GSTIN (optional)" value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))} />{err('gstin')}</div>
        <div><TextField id="ec-f" label="FSSAI licence no. (optional)" inputMode="numeric" value={f.fssai} onChange={(e) => set('fssai', e.target.value.replace(/\D/g, '').slice(0, 14))} />{err('fssai')}</div>
      </div>
      <ErrorBox error={error} />
      <button className="btn-primary w-full" disabled={busy || !ready}>{busy ? 'Saving…' : 'Save changes'}</button>
    </form>
  );
}

interface CUser { id: string; fullName: string; username: string; mobile: string | null; email: string | null; status: string; roles: string[]; lastLoginAt: string | null; mustChangePassword: boolean; locations: string[] }
const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', ACCOUNTANT: 'Accountant', STOCK_MANAGER: 'Stock Manager', BRANCH_MANAGER: 'Branch Manager', STAFF: 'Staff' };
const roleText = (roles: string[]) => roles.map((r) => ROLE_LABEL[r] ?? r).join(', ');

/** Every user of one company: change name / mobile / email, reset the password (a temporary one is sent by SMS). */
function CompanyUsers({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const [users, setUsers] = useState<CUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<CUser | null>(null);
  const [reset, setReset] = useState<CUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setUsers(await api.get(`/super/companies/${company.id}/users`)); setError(null); } catch (e: any) { setError(e.message); }
  }, [company.id]);
  useEffect(() => { void load(); }, [load]);

  if (edit) return <EditUser user={edit} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); setNotice('User updated'); void load(); onChanged(); }} />;
  if (reset) return <ResetPassword user={reset} onDone={(msg) => { setReset(null); setNotice(msg); void load(); }} onCancel={() => setReset(null)} />;

  return (
    <div className="space-y-3">
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ {notice}</p>}
      {!users ? <Skeleton className="h-40" /> : users.length === 0 ? <p className="text-sm text-slate-600">No users yet.</p> : (
        <ul className="divide-y">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{u.fullName} {u.status !== 'ACTIVE' && <span className="chip ml-1 border-slate-300 bg-slate-100 text-slate-600">Inactive</span>}</p>
                <p className="text-sm text-slate-600">{roleText(u.roles)} · <span className="tabular-nums">{u.mobile ?? 'no mobile'}</span></p>
                {u.locations.length > 0 && <p className="text-xs text-slate-500">{u.locations.join(', ')}</p>}
                {u.mustChangePassword && <p className="text-xs text-amber-800">⚠ still on the default / temporary password</p>}
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => { setNotice(null); setEdit(u); }}>Edit</button>
                <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => { setNotice(null); setReset(u); }}>Reset password</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditUser({ user, onCancel, onSaved }: { user: CUser; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ fullName: user.fullName, mobile: user.mobile ?? '', email: user.email ?? '', active: user.status === 'ACTIVE' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const err = (k: string) => errors[k] && <p className="mt-1 text-sm text-red-700">{errors[k]}</p>;
  const mobileChanged = f.mobile !== (user.mobile ?? '');

  async function save() {
    setBusy(true); setError(null); setErrors({});
    try {
      await api.patch(`/super/users/${user.id}`, {
        fullName: f.fullName.trim(), mobile: f.mobile || undefined, email: f.email.trim() || undefined, status: f.active ? 'ACTIVE' : 'INACTIVE',
      });
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(e instanceof ApiError ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{roleText(user.roles)}</p>
      <div><TextField id="eu-n" label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} maxLength={100} />{err('fullName')}</div>
      <div>
        <TextField id="eu-m" label="Mobile number" inputMode="numeric" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10 digits" />
        {err('mobile') ?? (mobileChanged && <p className="mt-1 text-xs text-amber-800">This is the sign-in name. The user will be signed out and must use the new number from now on.</p>)}
      </div>
      <div><TextField id="eu-e" label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />{err('email')}</div>
      <label className="flex min-h-touch items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (can sign in)</label>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Back</button>
        <button className="btn-primary" onClick={save} disabled={busy || f.fullName.trim().length < 2 || (f.mobile !== '' && !/^\d{10}$/.test(f.mobile))}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function ResetPassword({ user, onDone, onCancel }: { user: CUser; onDone: (msg: string) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devPassword, setDevPassword] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/super/users/${user.id}/reset-password`);
      if (r.tempPassword) { setDevPassword(r.tempPassword); setSentTo(r.mobile); } // SMS gateway not configured (development)
      else onDone(`A temporary password was sent by SMS to ${r.mobile} (${user.fullName}).`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reset the password'); }
    finally { setBusy(false); }
  }

  if (devPassword) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The SMS gateway is not configured on this server, so no SMS was sent to {sentTo}. Temporary password (development only):
          <b className="ml-1 select-all font-mono">{devPassword}</b>
        </p>
        <button className="btn-primary w-full" onClick={() => onDone(`Password reset for ${user.fullName} (SMS not configured).`)}>Done</button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        Reset the password of <b>{user.fullName}</b> ({roleText(user.roles)})? A temporary password is sent by SMS to <b className="tabular-nums">{user.mobile ?? '—'}</b>
        {' '}and they must change it at the next sign-in. They are signed out everywhere now.
      </p>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn-danger" onClick={run} disabled={busy || !user.mobile}>{busy ? 'Sending…' : 'Reset and send SMS'}</button>
      </div>
    </div>
  );
}
