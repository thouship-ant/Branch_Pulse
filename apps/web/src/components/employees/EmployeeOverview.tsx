'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Select';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import type { LocationOption } from '../purchases/PurchaseForm';
import { ActiveChip, ErrorBox, Skeleton } from '../ui';

const PAGE = 10;
const money = (v: unknown) => formatINR(String(v ?? 0), { decimals: false });
const monthlyCost = (r: any) => (r.salaryType === 'MONTHLY' ? Number(r.baseSalary) : Number(r.baseSalary) * 26); // a daily wage is costed at 26 days

/** Who works for the company: headline numbers, how they split by branch and role, and the employee list 10 to a page. */
export function EmployeeOverview({ locations }: { locations: LocationOption[] }) {
  const { t, pick } = useT();
  const [branch, setBranch] = useState(''); // '' = all branches
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    setRows(null);
    const p = new URLSearchParams({ includeInactive: 'true' });
    if (branch) p.set('locationId', branch);
    api.get(`/employees?${p}`).then((r) => { if (alive) { setRows(r as any[]); setError(null); } }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [branch]);
  useEffect(() => setPage(1), [branch, q]);

  const active = useMemo(() => (rows ?? []).filter((r) => r.status === 'ACTIVE'), [rows]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !s || `${r.fullName} ${r.code} ${r.jobRole} ${r.phone ?? ''}`.toLowerCase().includes(s));
  }, [rows, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const slice = filtered.slice((page - 1) * PAGE, page * PAGE);

  const byRole = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of active) m.set(r.jobRole, (m.get(r.jobRole) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);
  const byBranch = useMemo(() => {
    const m = new Map<string, { name: string; n: number; payroll: number }>();
    for (const r of active) {
      const cur = m.get(r.locationId) ?? { name: pick(r.locationName, r.locationNameTa), n: 0, payroll: 0 };
      cur.n++; cur.payroll += monthlyCost(r);
      m.set(r.locationId, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [active, pick]);
  const payroll = active.reduce((a, r) => a + monthlyCost(r), 0);
  const monthly = active.filter((r) => r.salaryType === 'MONTHLY').length;
  const joined = active.filter((r) => String(r.joiningDate).slice(0, 7) === new Date().toISOString().slice(0, 7)).length;

  const tile = (label: string, value: string, sub?: string) => (
    <div className="card">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-0.5 whitespace-nowrap text-[clamp(1.1rem,5.6vw,1.375rem)] font-bold tabular-nums sm:text-xl">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label htmlFor="eob" className="label">{t('branch')}</label>
          <Select id="eob" className="field" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">{t('allBranches')}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
          </Select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="eoq" className="label">{t('search')}</label>
          <input id="eoq" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} />
        </div>
      </div>
      <ErrorBox error={error} />
      {!rows ? <Skeleton className="h-64" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tile(t('eoTotal'), String(rows.length), `${active.length} ${t('active').toLowerCase()}`)}
            {tile(t('eoMonthlyDaily'), `${monthly} / ${active.length - monthly}`, `${t('eoMonthly')} / ${t('eoDaily')}`)}
            {tile(t('eoPayroll'), money(payroll), t('eoPayrollNote'))}
            {tile(t('eoJoined'), String(joined))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card space-y-2" aria-label={t('eoByRole')}>
              <h3 className="font-bold">{t('eoByRole')}</h3>
              {byRole.length === 0 ? <p className="text-sm text-slate-500">{t('noData')}</p> : byRole.map(([role, n]) => (
                <div key={role}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{role}</span><span className="tabular-nums text-slate-600">{n}</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-brand-light"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(4, (n / byRole[0][1]) * 100)}%` }} /></div>
                </div>
              ))}
            </section>
            <section className="card space-y-2" aria-label={t('eoByBranch')}>
              <h3 className="font-bold">{t('eoByBranch')}</h3>
              {byBranch.length === 0 ? <p className="text-sm text-slate-500">{t('noData')}</p> : byBranch.map((b) => (
                <div key={b.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{b.name}</span>
                  <span className="shrink-0 tabular-nums text-slate-600">{b.n} · {money(b.payroll)}</span>
                </div>
              ))}
            </section>
          </div>

          <section aria-label={t('tabEmployees')} className="space-y-2">
            <h3 className="font-bold">{t('tabEmployees')} <span className="font-normal text-slate-500">({filtered.length})</span></h3>
            {filtered.length === 0 ? <p className="card text-sm text-slate-500">{t('noData')}</p> : (
              <ul className="grid gap-3 md:grid-cols-2">
                {slice.map((r) => (
                  <li key={r.id} className={`card flex gap-3 ${r.status !== 'ACTIVE' ? 'opacity-70' : ''}`}>
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-[#3a4bd0] text-base font-bold text-white" aria-hidden>
                      {String(r.fullName).split(/\s+/).map((p: string) => p[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-start justify-between gap-2"><p className="truncate text-base font-bold">{r.fullName}</p><ActiveChip active={r.status === 'ACTIVE'} /></div>
                      <p className="text-sm text-slate-600">{r.jobRole} · <span className="font-mono text-xs">{r.code}</span></p>
                      <p className="text-sm text-slate-600">{pick(r.locationName, r.locationNameTa)}{r.phone ? ` · ${r.phone}` : ''}</p>
                      <p className="text-sm text-slate-500">{t('eoJoinedOn')} {prettyDate(String(r.joiningDate).slice(0, 10))} · {r.salaryType === 'MONTHLY' ? t('eoMonthly') : t('eoDaily')} <b className="tabular-nums text-ink">{money(r.baseSalary)}</b></p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {pages > 1 && (
              <nav className="flex items-center justify-between gap-2 pt-1" aria-label="Pages">
                <button className="btn-secondary min-h-[40px] gap-1 px-3" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><Icon name="chevronLeft" size={16} />{t('prevPage')}</button>
                <span className="text-sm tabular-nums text-slate-600">{page} / {pages}</span>
                <button className="btn-secondary min-h-[40px] gap-1 px-3" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('nextPage')}<Icon name="chevronRight" size={16} /></button>
              </nav>
            )}
          </section>
        </>
      )}
    </div>
  );
}
