'use client';

import { useEffect, useState } from 'react';
import { ErrorBox, MoneyInput, Skeleton, Warnings } from '@/components/ui';
import { api, type Warning } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { amt, dec, formatINR, sumDec } from '@/lib/money';
import { submitOffline, useOutbox } from '@/lib/outbox';
import { useBranch } from '@/lib/useBranch';

interface Form {
  total: string; cash: string; upi: string; card: string; credit: string; comp: string; other: string; remarks: string;
}
const EMPTY: Form = { total: '', cash: '', upi: '', card: '', credit: '', comp: '', other: '', remarks: '' };

export default function SalesPage() {
  const { t } = useT();
  const { branch, locationId, date } = useBranch();
  const { waiting } = useOutbox(locationId, date);
  const [form, setForm] = useState<Form>(EMPTY);
  const [version, setVersion] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'queued'; text: string } | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) return;
    api.get(`/daily-sales?locationId=${locationId}&date=${date}`)
      .then((s) => {
        if (s) {
          setVersion(s.version);
          setForm({
            total: s.totalSales, cash: s.cashSales, upi: s.upiSales, card: s.cardSales, credit: s.creditSales,
            comp: s.complimentaryAmount, other: s.otherAdjustments, remarks: s.remarks ?? '',
          });
        }
      })
      .catch(() => undefined) // offline: start from an empty form, the outbox reconciles on sync
      .finally(() => setLoading(false));
  }, [locationId, date]);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const split = sumDec([form.cash, form.upi, form.card, form.credit, form.other]);
  const diff = dec(form.total).minus(split);
  const matches = diff.isZero();

  async function save() {
    setBusy(true); setError(null); setMessage(null); setWarnings([]);
    try {
      const row = await submitOffline({
        entityType: 'DAILY_SALES', op: version === undefined ? 'CREATE' : 'UPDATE', baseVersion: version,
        locationId, businessDate: date,
        payload: {
          locationId, businessDate: date, totalSales: amt(form.total) ?? '0.00', cashSales: amt(form.cash), upiSales: amt(form.upi),
          cardSales: amt(form.card), creditSales: amt(form.credit), complimentaryAmount: amt(form.comp),
          otherAdjustments: amt(form.other), remarks: form.remarks || undefined,
        },
      });
      if (row.state === 'DONE') {
        setMessage({ kind: 'ok', text: t('synced') });
        setWarnings((row.warnings as Warning[]) ?? []);
        const fresh = await api.get(`/daily-sales?locationId=${locationId}&date=${date}`).catch(() => null);
        if (fresh) setVersion(fresh.version);
      } else if (row.state === 'PENDING' || row.state === 'SENDING') {
        setMessage({ kind: 'queued', text: t('offline') });
      } else {
        setError(row.lastError ?? t('conflict'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">{prettyDate(date)}</p>
        <h2 className="text-xl font-bold">{t('sales')}</h2>
      </div>

      <div className="card space-y-4">
        <MoneyInput id="total" label={t('totalSales')} value={form.total} onChange={set('total')} required />
        <div className="grid grid-cols-2 gap-3">
          <MoneyInput id="cash" label={t('cash')} value={form.cash} onChange={set('cash')} />
          <MoneyInput id="upi" label={t('upi')} value={form.upi} onChange={set('upi')} />
          {branch?.cardEnabled !== false && <MoneyInput id="card" label={t('card')} value={form.card} onChange={set('card')} />}
          <MoneyInput id="credit" label={t('credit')} value={form.credit} onChange={set('credit')} />
          <MoneyInput id="comp" label={t('complimentary')} value={form.comp} onChange={set('comp')} />
          <MoneyInput id="other" label={t('otherAdjustment')} value={form.other} onChange={set('other')} />
        </div>

        <div role="status" className={`flex items-center justify-between rounded-card border px-3 py-3 font-semibold ${matches ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          <span>{t('difference')}</span>
          <span className="tabular-nums">{matches ? '✓' : '⚠'} {formatINR(diff)}</span>
        </div>

        <div>
          <label htmlFor="remarks" className="label">{t('remarks')}{!matches && ' *'}</label>
          <textarea id="remarks" className="field min-h-[80px] py-2" value={form.remarks} onChange={(e) => set('remarks')(e.target.value)} />
        </div>
      </div>

      <Warnings items={warnings} />
      <ErrorBox error={error} />
      {message && (
        <p role="status" className={`rounded-card border px-3 py-2 text-sm ${message.kind === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-100 text-slate-700'}`}>
          {message.kind === 'ok' ? '✓' : '⟳'} {message.text}
        </p>
      )}
      <button className="btn-primary w-full" disabled={busy || !form.total} onClick={save}>{busy ? t('loading') : t('save')}</button>
      {waiting > 0 && <p className="text-center text-xs text-slate-500">{waiting} {t('waiting')}</p>}
    </div>
  );
}
