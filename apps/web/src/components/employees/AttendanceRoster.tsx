'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { ATTENDANCE_STATUS_KEY } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { LocationOption } from '../purchases/PurchaseForm';
import { ErrorBox, Skeleton } from '../ui';

const STATUSES = Object.keys(ATTENDANCE_STATUS_KEY);
interface Row { employeeId: string; code: string; fullName: string; jobRole: string; status: string | null; overtimeHours: string | null }

/** The day's roster for one branch: present / absent / leave / half-day / week-off / holiday, plus overtime hours on any of them. */
export function AttendanceRoster({ locations, fixedLocationId }: { locations: LocationOption[]; fixedLocationId?: string }) {
  const { t, pick } = useT();
  const { can } = useSession();
  const today = todayIST();
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [date, setDate] = useState(today);
  const [roster, setRoster] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Record<string, { status: string | null; overtimeHours: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const canMark = can('attendance:mark');

  const load = useCallback(async () => {
    if (!locationId) { setRoster(null); return; }
    setSaved(false);
    try {
      const data = (await api.get(`/attendance/roster?locationId=${locationId}&date=${date}`)) as Row[];
      setRoster(data);
      setDraft(Object.fromEntries(data.map((r) => [r.employeeId, { status: r.status, overtimeHours: r.overtimeHours ?? '' }])));
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [locationId, date]);
  useEffect(() => { void load(); }, [load]);

  function setStatus(employeeId: string, status: string) {
    setDraft((d) => ({ ...d, [employeeId]: { ...d[employeeId], status } }));
  }
  function setOvertime(employeeId: string, overtimeHours: string) {
    setDraft((d) => ({ ...d, [employeeId]: { ...d[employeeId], overtimeHours } }));
  }
  function markAllPresent() {
    setDraft((d) => Object.fromEntries(Object.keys(d).map((id) => [id, { ...d[id], status: 'PRESENT' }])));
  }

  async function save() {
    if (!roster) return;
    const items = roster
      .filter((r) => draft[r.employeeId]?.status)
      .map((r) => ({ employeeId: r.employeeId, status: draft[r.employeeId].status, overtimeHours: draft[r.employeeId].overtimeHours || '0' }));
    if (!items.length) return;
    setBusy(true); setError(null);
    try {
      await api.put('/attendance', { locationId, businessDate: date, items });
      setSaved(true);
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {!fixedLocationId && (
          <div className="min-w-[220px]">
            <label htmlFor="arl" className="label">{t('branch')}</label>
            <select id="arl" className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t('chooseLocation')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="ard" className="label">{t('rosterFor')}</label>
          <input id="ard" type="date" className="field" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </div>
      </div>
      <ErrorBox error={error} />

      {!locationId ? <p className="card text-slate-600">{t('chooseBranchFirst')}</p> : !roster ? <Skeleton className="h-48" /> : roster.length === 0 ? (
        <p className="card text-slate-600">{t('noEmployees')}</p>
      ) : (
        <div className="space-y-3">
          {canMark && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">{prettyDate(date)}</p>
              <button className="btn-secondary min-h-[36px] px-3 text-sm" onClick={markAllPresent}>✓ {t('stPresent')} ({roster.length})</button>
            </div>
          )}
          <ul className="space-y-2">
            {roster.map((r) => {
              const d = draft[r.employeeId] ?? { status: null, overtimeHours: '' };
              return (
                <li key={r.employeeId} className="card space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0"><p className="font-medium">{r.fullName}</p><p className="text-xs text-slate-500">{r.code} · {r.jobRole}</p></div>
                    {!d.status && <span className="chip border-slate-300 bg-slate-100 text-slate-600">{t('notMarkedYet')}</span>}
                  </div>
                  {canMark ? (
                    <>
                      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={r.fullName}>
                        {STATUSES.map((s) => (
                          <button
                            key={s} type="button" role="radio" aria-checked={d.status === s} onClick={() => setStatus(r.employeeId, s)}
                            className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold transition ${d.status === s ? 'border-transparent bg-brand text-white' : 'border-slate-300 bg-surface text-ink hover:bg-slate-50'}`}
                          >{t(ATTENDANCE_STATUS_KEY[s])}</button>
                        ))}
                      </div>
                      {(d.status === 'PRESENT' || d.status === 'HALF_DAY') && (
                        <div className="max-w-[160px]">
                          <label htmlFor={`ot${r.employeeId}`} className="label">{t('overtimeHoursLabel')}</label>
                          <input id={`ot${r.employeeId}`} className="field tabular-nums" inputMode="decimal" placeholder="0" value={d.overtimeHours} onChange={(e) => setOvertime(r.employeeId, e.target.value.replace(/[^\d.]/g, ''))} />
                        </div>
                      )}
                    </>
                  ) : d.status && <span className="chip border-slate-300 bg-slate-100 text-slate-700">{t(ATTENDANCE_STATUS_KEY[d.status])}</span>}
                </li>
              );
            })}
          </ul>
          {canMark && (
            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={busy} onClick={save}>{busy ? t('loading') : t('saveAttendance')}</button>
              {saved && <span role="status" className="text-sm text-emerald-700">✓ {t('attendanceSaved')}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
