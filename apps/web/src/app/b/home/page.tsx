'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { ErrorBox, Skeleton, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { prettyDate, prettyTime } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { discard, keepMine, useOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { useBranch } from '@/lib/useBranch';

export default function BranchHome() {
  const { t } = useT();
  const { can } = useSession();
  const { locationId, date } = useBranch();
  const [screen, setScreen] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { ops, needsAttention, waiting } = useOutbox(locationId, date);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [s, e] = await Promise.all([
        api.get(`/closings/${locationId}/${date}`),
        api.get(`/expenses?locationId=${locationId}&from=${date}&to=${date}&pageSize=100`),
      ]);
      setScreen(s);
      setExpenses(e);
      setError(null);
    } catch (err: any) {
      if (!err.isNetwork) setError(err.message);
    }
  }, [locationId, date]);

  useEffect(() => { void load(); }, [load, ops.length, waiting]);

  if (!screen && !error) return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;

  const closing = screen?.closing;
  const sales = screen?.sales;
  const cash = screen?.cash;
  const live = expenses.filter((e) => e.status === 'ACTIVE');
  const total = live.reduce((a, e) => a + Number(e.amount), 0);
  const queuedExpenses = ops.filter((o) => o.entityType === 'EXPENSE' && o.state !== 'DONE').length;
  const counted = cash?.actualClosing != null;

  const cards: Array<{ href: string; title: string; detail: string; done: boolean; icon: IconName }> = [
    { href: '/b/sales', title: t('sales'), detail: sales ? formatINR(sales.totalSales) : '—', done: !!sales, icon: 'trend' },
    {
      href: '/b/expense', icon: 'card', title: t('expenses'),
      detail: `${formatINR(String(total), { decimals: false })} (${live.length + queuedExpenses})`, done: live.length + queuedExpenses > 0,
    },
    { href: '/b/cash', title: t('cashRecon'), detail: counted ? formatINR(cash.actualClosing) : '—', done: counted, icon: 'wallet' },
  ];
  const submitted = ['SUBMITTED', 'APPROVED'].includes(closing?.status ?? 'PENDING');
  const stepsDone = cards.filter((c) => c.done).length + (submitted ? 1 : 0);
  const stepsTotal = cards.length + 1;

  return (
    <div className="space-y-4">
      <div className="card relative overflow-hidden border-0 bg-gradient-to-br from-[#eef1ff] to-[#f6f7ff] p-4 dark:from-[#1a2747] dark:to-[#24204a]">
        <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-brand/10 blur-2xl" aria-hidden />
        <p className="text-sm font-medium text-slate-600">{t('today')} · {prettyDate(date)}</p>
        <div className="mt-0.5 flex items-end justify-between gap-3">
          <h2 className="text-xl font-extrabold tracking-tight">{t('checklist')}</h2>
          <p className="text-sm font-semibold tabular-nums text-brand-dark">{stepsDone}/{stepsTotal} <span className="font-medium text-slate-600">{t('stepsDone')}</span></p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={stepsTotal} aria-valuenow={stepsDone}>
          <div className="h-full rounded-full bg-gradient-to-r from-brand to-[#4a5bd8] transition-all duration-500" style={{ width: `${(stepsDone / stepsTotal) * 100}%` }} />
        </div>
        <p className="mt-2 text-xs font-medium text-slate-600">{stepsDone === stepsTotal ? `✓ ${t('allDoneToday')}` : t('keepGoing')}</p>
      </div>
      <ErrorBox error={error} />

      {closing?.status === 'REJECTED' && (
        <div role="alert" className="rounded-card border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">✕ {t('rejected')}</p>
          <p>{t('reviewComment')}: {closing.reviewComment}</p>
        </div>
      )}
      {closing?.status === 'REOPENED' && (
        <div role="status" className="rounded-card border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900">
          ↺ {t('reopened')}: {closing.reviewComment}
        </div>
      )}

      {needsAttention.length > 0 && (
        <div className="card space-y-3 border-amber-300 bg-amber-50">
          <h3 className="font-semibold">⚠ {t('conflict')}</h3>
          {needsAttention.map((o) => (
            <div key={o.clientUuid} className="rounded-card border bg-surface p-3 text-sm">
              <p className="font-medium">{o.entityType} · {o.state}</p>
              {o.lastError && <p className="text-red-700">{o.lastError}</p>}
              {o.state === 'CONFLICT' && o.server && (
                <p className="text-slate-600">Server: {formatINR(o.server.totalSales ?? o.server.amount)}</p>
              )}
              <div className="mt-2 flex gap-2">
                {o.state === 'CONFLICT' && <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => keepMine(o)}>{t('keepMine')}</button>}
                <button className="btn-secondary min-h-[40px] px-3 text-sm" onClick={() => discard(o.clientUuid)}>{t('keepServer')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ul className="space-y-3">
        {cards.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="card flex min-h-[72px] items-center gap-3">
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${c.done ? 'bg-emerald-50 text-emerald-800' : 'bg-brand-light text-brand-dark'}`}><Icon name={c.icon} size={22} /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{c.title}</p>
                <p className="text-lg font-bold tabular-nums">{c.detail}</p>
              </div>
              <span className={`chip ${c.done ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-100 text-slate-600'}`}>
                <span aria-hidden>{c.done ? '✓' : '○'}</span>{c.done ? t('done') : t('notDone')}
              </span>
              <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
            </Link>
          </li>
        ))}
        <li>
          <Link href="/b/closing" className="card flex min-h-[72px] items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-800"><Icon name="check" size={22} /></span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t('closing')}</p>
              {closing?.submittedAt && <p className="text-sm text-slate-500">{prettyTime(closing.submittedAt)}</p>}
            </div>
            <StatusPill status={closing?.status ?? 'PENDING'} />
            <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
          </Link>
        </li>
        {can('staff:view') && (
          <li>
            <Link href="/b/staff" className="card flex min-h-[72px] items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Icon name="user" size={22} /></span>
              <div className="min-w-0 flex-1"><p className="font-semibold">{t('employeesTitle')}</p></div>
              <Icon name="chevron" size={18} className="shrink-0 text-slate-400" />
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
