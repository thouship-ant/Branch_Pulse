'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ErrorBox, Skeleton } from './ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const DAYS = 14;

/**
 * Every branch and day on one grid (UX-04): closed, waiting for you (with its age) or not submitted. Waiting days open in one click.
 * Days before a branch opened are not marked as missing, because the pending list only runs from each branch's opening.
 */
export function ClosingBacklog() {
  const { t, pick } = useT();
  const { me } = useSession();
  const [pending, setPending] = useState<any[] | null>(null);
  const [awaiting, setAwaiting] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = todayIST();

  useEffect(() => {
    let alive = true;
    Promise.all([api.get<any[]>('/pending-closings'), api.get<any[]>('/closings/awaiting').catch(() => [] as any[])])
      .then(([p, a]) => { if (alive) { setPending(p); setAwaiting(a); } })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(today, i - (DAYS - 1))), [today]);
  const branches = useMemo(() => (me?.locations ?? []).filter((l) => l.type === 'BRANCH'), [me]);
  const open = useMemo(() => new Set((pending ?? []).map((p) => `${p.locationId}|${String(p.businessDate).slice(0, 10)}`)), [pending]);
  const waiting = useMemo(() => new Map(awaiting.map((a) => [`${a.locationId}|${String(a.businessDate).slice(0, 10)}`, a])), [awaiting]);
  const ageOf = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

  if (error) return <ErrorBox error={error} />;
  if (!pending) return <Skeleton className="h-64" />;
  const notSubmitted = open.size;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-700">
        <span><b className="text-red-700">{notSubmitted}</b> {t('attNotClosed').toLowerCase()}</span>
        <span><b className="text-amber-800">{awaiting.length}</b> {t('attWaitingYou').toLowerCase()}</span>
      </div>
      <div className="card overflow-x-auto !p-3">
        <table className="w-full min-w-[640px] text-sm" data-keep>
          <thead>
            <tr><th className="py-1 pr-3 text-left">{t('branch')}</th>{days.map((d) => <th key={d} className="px-0.5 py-1 text-center" title={prettyDate(d)}>{d.slice(8)}</th>)}</tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <th scope="row" className="whitespace-nowrap py-1 pr-3 text-left font-semibold">{pick(b.name, b.nameTa)}</th>
                {days.map((d) => {
                  const k = `${b.id}|${d}`;
                  const w = waiting.get(k);
                  const cell = open.has(k)
                    ? <span className="grid h-8 place-items-center rounded-md bg-red-100 text-xs font-bold text-red-700" title={`${prettyDate(d)} · ${t('attNotClosed')}`}>!</span>
                    : w
                      ? <span className="grid h-8 place-items-center rounded-md bg-amber-100 text-[11px] font-bold text-amber-900" title={`${prettyDate(d)} · ${t('attWaitingYou')}`}>{ageOf(w.submittedAt ?? w.businessDate)}d</span>
                      : <span className="grid h-8 place-items-center rounded-md bg-emerald-50 text-xs font-bold text-emerald-800" title={`${prettyDate(d)} · ${t('attClosed')}`}>✓</span>;
                  return (
                    <td key={d} className="px-0.5 py-1 text-center">
                      <Link href={`/closings/${b.id}/${d}`} aria-label={`${pick(b.name, b.nameTa)} ${prettyDate(d)}`} className="block transition hover:scale-105">{cell}</Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600"><span><b className="text-red-700">!</b> {t('attNotClosed')}</span><span><b className="text-amber-800">3d</b> {t('attWaitingYou')}</span><span><b className="text-emerald-800">✓</b> {t('attClosed')}</span></p>
    </div>
  );
}
