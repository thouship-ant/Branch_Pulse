'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DateNav } from '@/components/DateNav';
import { ErrorBox, Skeleton, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, prettyTime } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { useDateParam } from '@/lib/useDateParam';
import { dec, formatINR } from '@/lib/money';

export default function ClosingBoard() {
  const { t, pick } = useT();
  const [date, setDate, ready] = useDateParam();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get(`/closings?date=${date}`)); setError(null); } catch (e: any) { setError(e.message); }
  }, [date]);
  useEffect(() => { if (!ready) return; setRows(null); void load(); }, [load, ready]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-bold">{t('closings')}</h2>
        <DateNav id="d" date={date} onChange={setDate} />
      </div>
      <ErrorBox error={error} />
      {!rows ? <Skeleton className="h-64" /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => {
            const v = r.cashVariance;
            return (
              <li key={r.locationId}>
                <Link href={`/closings/${r.locationId}/${date}`} className="card flex min-h-[72px] items-center justify-between hover:border-brand">
                  <div>
                    <p className="font-semibold">{pick(r.locationName, r.locationNameTa)}</p>
                    <p className="text-sm tabular-nums text-slate-600">{t('sales')}: {formatINR(r.totalSales, { decimals: false })}</p>
                    <p className={`text-sm tabular-nums ${v && dec(v).isNegative() ? 'font-semibold text-red-700' : 'text-slate-600'}`}>
                      {t('cashVariance')}: {v == null ? '—' : `${dec(v).isNegative() ? '▼ ' : ''}${formatINR(v, { decimals: false })}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusPill status={r.status} />
                    {r.submittedAt && <p className="mt-1 text-xs text-slate-500">{prettyTime(r.submittedAt)}</p>}
                    {r.reopenCount > 0 && <p className="text-xs text-violet-700">↺ ×{r.reopenCount}</p>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
