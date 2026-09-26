'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { monthLong, monthShort, prettyDate, shortDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { dec, formatINR } from '@/lib/money';
import { BarList, ChartCard, Columns, compact, LineChart, seriesColor } from '../charts';
import { Icon, type IconName } from '../Icon';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { Chips, ErrorBox, Skeleton } from '../ui';
import { MODE_KEY } from '@/lib/labels';

type Group = 'day' | 'week' | 'month';
const money = (n: number | string) => formatINR(n, { decimals: false });
const axis = (n: number) => compact(n, true);
const EXPENSES = 'var(--series-2)'; // expenses are orange everywhere in the app

/** Owner overview: daily / weekly / monthly expenses, branch-wise, category-wise and the trend over time. */
export function ExpenseOverview({ fixedLocationId }: { fixedLocationId?: string }) {
  const { t, pick } = useT();
  const period = usePeriod('30');
  const { range, valid } = period;
  const [group, setGroup] = useState<Group>('day');
  const [branchId, setBranchId] = useState(fixedLocationId ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [branches, setBranches] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fixedLocationId) api.get('/locations?type=BRANCH').then((b) => setBranches(b as any[])).catch(() => undefined);
    api.get('/expense-categories').then((c) => setCategories((c as any[]).filter((x) => !x.parentId))).catch(() => undefined);
  }, [fixedLocationId]);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ from: range.from, to: range.to, groupBy: group });
    if (branchId) qs.set('locationId', branchId);
    if (categoryId) qs.set('categoryId', categoryId);
    api.get(`/expenses/summary?${qs}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [range.from, range.to, group, branchId, categoryId, valid]);

  const label = (start: string) => (group === 'month' ? monthShort(start.slice(0, 7)) : shortDate(start));
  const tip = (start: string) => (group === 'month' ? monthLong(start.slice(0, 7)) : group === 'week' ? t('weekOf', { d: prettyDate(start) }) : prettyDate(start));
  const groupName = group === 'month' ? t('gMonth') : group === 'week' ? t('gWeek') : t('gDay');

  const tot = data?.totals;
  const change: number | null = tot?.changePct ?? null;

  const Tile = ({ icon, title, value, sub, warn }: { icon: IconName; title: string; value: string; sub?: string; warn?: boolean }) => (
    <div className={`card flex items-center gap-3 ${warn ? 'border-amber-300' : ''}`}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-light text-brand-dark"><Icon name={icon} size={22} /></span>
      <div className="min-w-0"><p className="truncate text-sm text-slate-600">{title}</p><p className="text-xl font-bold tabular-nums">{value}</p>{sub && <p className="text-xs text-slate-600">{sub}</p>}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <PeriodPicker period={period} label={t('expenses')} />
        <Chips
          label={t('chTrend')} value={group} onChange={setGroup}
          options={[{ value: 'day', label: t('gDay') }, { value: 'week', label: t('gWeek') }, { value: 'month', label: t('gMonth') }]}
        />
        {!fixedLocationId && (
          <div className="min-w-[180px]">
            <label htmlFor="eb" className="label">{t('branch')}</label>
            <select id="eb" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {pick(b.name, b.nameTa)}</option>)}
            </select>
          </div>
        )}
        <div className="min-w-[180px]">
          <label htmlFor="ec" className="label">{t('category')}</label>
          <select id="ec" className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('allCategories')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{pick(c.nameEn, c.nameTa)}</option>)}
          </select>
        </div>
      </div>
      {!valid && <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {t('invalidRange')}</p>}
      <ErrorBox error={error} />

      {!data ? <Skeleton className="h-64" /> : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile icon="card" title={t('expTotal')} value={money(tot.total)} sub={`${tot.count} ${t('entries')}`} />
            <Tile icon="trend" title={t('expAvgDay')} value={money(tot.averagePerDay)} sub={`${data.days} ${t('daysLabel')}`} />
            <Tile
              icon="grid" title={t('expVsPrev')} value={change === null ? '—' : `${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${Math.abs(change)}%`}
              sub={`${t('total')}: ${money(tot.previousTotal)}`}
            />
            <Tile icon="clock" warn={tot.pendingApproval.count > 0} title={t('expPending')} value={String(tot.pendingApproval.count)} sub={money(tot.pendingApproval.amount)} />
          </section>

          {/* daily / weekly / monthly totals */}
          <ChartCard
            title={`${groupName} · ${t('expenses')}`} subtitle={`${prettyDate(data.from)} – ${prettyDate(data.to)}`} loading={loading}
            empty={dec(tot.total).isZero()}
            table={{ head: [groupName, t('entries'), t('total')], rows: (data.buckets as any[]).map((b) => [tip(b.start), b.count, money(b.amount)]) }}
          >
            <Columns
              cols={(data.buckets as any[]).map((b) => ({ key: b.start, label: label(b.start), value: Number(b.amount), tipTitle: tip(b.start) }))}
              fmt={money} axisFmt={axis} color={EXPENSES} ariaLabel={`${groupName} ${t('expenses')}`}
            />
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title={t('chBranchWise')} loading={loading} empty={data.branches.length === 0}
              table={{ head: [t('branch'), t('entries'), t('total'), '%'], rows: (data.branches as any[]).map((b) => [`${b.code} · ${pick(b.name, b.nameTa)}`, b.count, money(b.amount), b.sharePct === null ? '—' : `${b.sharePct}%`]) }}
            >
              <BarList
                ariaLabel={t('chBranchWise')} color={EXPENSES} fmt={money}
                rows={(data.branches as any[]).map((b) => ({ key: b.locationId, label: pick(b.name, b.nameTa), value: Number(b.amount), detail: `${b.count} ${t('entries')}${b.sharePct === null ? '' : ` · ${b.sharePct}%`}` }))}
              />
            </ChartCard>

            <ChartCard
              title={t('chCategoryWise')} loading={loading} empty={data.categories.length === 0}
              table={{
                head: [t('category'), t('subCategory'), t('entries'), t('total'), '%'],
                rows: (data.categories as any[]).flatMap((c) => [
                  [pick(c.name, c.nameTa), '', c.count, money(c.amount), c.sharePct === null ? '—' : `${c.sharePct}%`],
                  ...((c.subs as any[]).filter((s) => s.name)).map((s) => [`  ${pick(c.name, c.nameTa)}`, pick(s.name, s.nameTa), s.count, money(s.amount), '']),
                ]),
              }}
            >
              <BarList
                ariaLabel={t('chCategoryWise')} color={EXPENSES} fmt={money}
                rows={(data.categories as any[]).map((c) => ({
                  key: c.categoryId, label: pick(c.name, c.nameTa), value: Number(c.amount),
                  detail: [`${c.count} ${t('entries')}`, c.sharePct === null ? null : `${c.sharePct}%`, ...(c.subs as any[]).filter((s) => s.name).slice(0, 3).map((s) => `${pick(s.name, s.nameTa)} ${money(s.amount)}`)].filter(Boolean).join(' · '),
                }))}
              />
            </ChartCard>
          </div>

          {/* trend: the biggest categories over time, one axis, at most five lines */}
          <ChartCard
            title={t('chCategoryTrend')} loading={loading}
            empty={data.categoryTrend.series.length === 0}
            legend={(data.categoryTrend.series as any[]).map((s, i) => ({ name: pick(s.name, s.nameTa), color: seriesColor(i) }))}
            table={{
              head: [groupName, ...(data.categoryTrend.series as any[]).map((s) => pick(s.name, s.nameTa))],
              rows: (data.categoryTrend.keys as string[]).map((k, i) => [tip(k), ...(data.categoryTrend.series as any[]).map((s) => money(s.values[i]))]),
            }}
          >
            <LineChart
              labels={data.categoryTrend.keys} fmt={money} axisFmt={axis} xText={label} tipTitle={tip} ariaLabel={t('chCategoryTrend')}
              series={(data.categoryTrend.series as any[]).map((s, i) => ({ key: s.categoryId, name: pick(s.name, s.nameTa), color: seriesColor(i), values: (s.values as string[]).map(Number) }))}
            />
          </ChartCard>

          <ChartCard
            title={t('chPayModes')} loading={loading} empty={data.paymentModes.length === 0}
            table={{ head: [t('paymentMode'), t('entries'), t('total'), '%'], rows: (data.paymentModes as any[]).map((m) => [MODE_KEY[m.mode] ? t(MODE_KEY[m.mode]) : m.mode, m.count, money(m.amount), m.sharePct === null ? '—' : `${m.sharePct}%`]) }}
          >
            <BarList
              ariaLabel={t('chPayModes')} color={EXPENSES} fmt={money}
              rows={(data.paymentModes as any[]).map((m) => ({ key: m.mode, label: MODE_KEY[m.mode] ? t(MODE_KEY[m.mode]) : m.mode, value: Number(m.amount), detail: `${m.count} ${t('entries')}` }))}
            />
          </ChartCard>
        </div>
      )}
    </div>
  );
}
