'use client';

import { Select } from '@/components/Select';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { monthLong, monthShort, prettyDate, shortDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { MODE_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { BarList, ChartCard, Columns, compact } from '../charts';
import { Icon, type IconName } from '../Icon';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { Chips, ErrorBox, Skeleton } from '../ui';
import type { LocationOption } from './PurchaseForm';

type Group = 'day' | 'week' | 'month';
const money = (n: number | string) => formatINR(n, { decimals: false });
const axis = (n: number) => compact(n, true);
const PURCHASES = 'var(--series-3)'; // purchases have their own hue; sales blue and expenses orange stay untouched

/** Owner overview: purchases over time, by supplier / branch / item, cash vs credit, and what is still owed to suppliers. */
export function PurchaseOverview({ locations, fixedLocationId, refreshKey = 0, onShowPending }: {
  locations: LocationOption[]; fixedLocationId?: string; refreshKey?: number; onShowPending?: () => void;
}) {
  const { t, pick } = useT();
  const period = usePeriod('30');
  const { range, valid } = period;
  const [group, setGroup] = useState<Group>('day');
  const [branchId, setBranchId] = useState(fixedLocationId ?? '');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ from: range.from, to: range.to, groupBy: group });
    if (branchId) qs.set('locationId', branchId);
    api.get(`/purchases/summary?${qs}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [range.from, range.to, group, branchId, valid, refreshKey]);

  const label = (s: string) => (group === 'month' ? monthShort(s.slice(0, 7)) : shortDate(s));
  const tip = (s: string) => (group === 'month' ? monthLong(s.slice(0, 7)) : group === 'week' ? t('weekOf', { d: prettyDate(s) }) : prettyDate(s));
  const groupName = group === 'month' ? t('gMonth') : group === 'week' ? t('gWeek') : t('gDay');
  const tot = data?.totals;
  const owe = data?.outstanding;

  const Tile = ({ icon, title, value, sub, tone, onClick }: { icon: IconName; title: string; value: string; sub?: string; tone?: 'warn' | 'bad'; onClick?: () => void }) => {
    const inner = (
      <>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tone === 'bad' ? 'bg-red-50 text-red-800' : 'bg-brand-light text-brand-dark'}`}><Icon name={icon} size={22} /></span>
        <div className="min-w-0 text-left"><p className="text-sm leading-tight text-slate-600">{title}</p><p className="text-xl font-bold tabular-nums">{value}</p>{sub && <p className="text-xs text-slate-600">{sub}</p>}</div>
      </>
    );
    const cls = `card flex items-center gap-3 ${tone === 'bad' ? 'border-red-300' : tone === 'warn' ? 'border-amber-300' : ''}`;
    return onClick ? <button className={`${cls} w-full hover:bg-slate-50`} onClick={onClick}>{inner}</button> : <div className={cls}>{inner}</div>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <PeriodPicker period={period} label={t('purchases')} />
        <Chips label={t('pTrend')} value={group} onChange={setGroup} options={[{ value: 'day', label: t('gDay') }, { value: 'week', label: t('gWeek') }, { value: 'month', label: t('gMonth') }]} />
        {!fixedLocationId && (
          <div className="min-w-[200px]">
            <label htmlFor="pob" className="label">{t('atLocation')}</label>
            <Select id="pob" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </Select>
          </div>
        )}
      </div>
      {!valid && <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠ {t('invalidRange')}</p>}
      <ErrorBox error={error} />

      {!data ? <Skeleton className="h-64" /> : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile icon="bag" title={t('pTotal')} value={money(tot.total)} sub={`${tot.count} ${t('entries')}`} />
            <Tile icon="wallet" title={t('pPaid')} value={money(tot.paid)} />
            <Tile icon="clock" title={t('pCredit')} value={money(tot.credit)} tone={dec(tot.credit).greaterThan(0) ? 'warn' : undefined} />
            <Tile icon="check" title={t('expPending')} value={String(tot.pendingApproval.count)} sub={money(tot.pendingApproval.amount)} tone={tot.pendingApproval.count > 0 ? 'warn' : undefined} onClick={tot.pendingApproval.count > 0 ? onShowPending : undefined} />
          </section>
          <section aria-label={t('outstanding')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile icon="store" title={t('totalOwed')} value={money(owe.total)} sub={`${owe.suppliers} ${t('suppliersTitle')}`} />
            <Tile icon="alert" title={t('overdueLabel')} value={`${dec(owe.overdue).greaterThan(0) ? '▼ ' : ''}${money(owe.overdue)}`} tone={dec(owe.overdue).greaterThan(0) ? 'bad' : undefined} />
            <Tile icon="clock" title={t('dueSoon')} value={money(owe.dueSoon)} />
          </section>

          <ChartCard
            title={`${groupName} · ${t('purchases')}`} subtitle={`${prettyDate(data.from)} – ${prettyDate(data.to)}`} loading={loading} empty={dec(tot.total).isZero()}
            table={{ head: [groupName, t('entries'), t('total')], rows: (data.buckets as any[]).map((b) => [tip(b.start), b.count, money(b.amount)]) }}
          >
            <Columns cols={(data.buckets as any[]).map((b) => ({ key: b.start, label: label(b.start), value: Number(b.amount), tipTitle: tip(b.start) }))} fmt={money} axisFmt={axis} color={PURCHASES} ariaLabel={`${groupName} ${t('purchases')}`} />
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title={t('pBySupplier')} loading={loading} empty={data.suppliers.length === 0}
              table={{ head: [t('supplier'), t('entries'), t('total'), t('paidLabel'), t('creditLeft')], rows: (data.suppliers as any[]).map((s) => [s.name, s.count, money(s.amount), money(s.paid), money(s.credit)]) }}
            >
              <BarList ariaLabel={t('pBySupplier')} color={PURCHASES} fmt={money} rows={(data.suppliers as any[]).map((s) => ({ key: s.supplierId, label: s.name, value: Number(s.amount), detail: `${s.count} ${t('entries')} · ${t('creditLeft')} ${money(s.credit)}` }))} />
            </ChartCard>
            <ChartCard
              title={t('pByLocation')} loading={loading} empty={data.locations.length === 0}
              table={{ head: [t('atLocation'), t('entries'), t('total'), '%'], rows: (data.locations as any[]).map((l) => [`${l.code} · ${pick(l.name, l.nameTa)}`, l.count, money(l.amount), l.sharePct === null ? '—' : `${l.sharePct}%`]) }}
            >
              <BarList ariaLabel={t('pByLocation')} color={PURCHASES} fmt={money} rows={(data.locations as any[]).map((l) => ({ key: l.locationId, label: pick(l.name, l.nameTa), value: Number(l.amount), detail: `${l.count} ${t('entries')}${l.sharePct === null ? '' : ` · ${l.sharePct}%`}` }))} />
            </ChartCard>
            <ChartCard
              title={t('pTopItems')} loading={loading} empty={data.items.length === 0}
              table={{ head: [t('itemLabel'), t('total')], rows: (data.items as any[]).map((i) => [pick(i.name, i.nameTa), money(i.amount)]) }}
            >
              <BarList ariaLabel={t('pTopItems')} color={PURCHASES} fmt={money} rows={(data.items as any[]).map((i) => ({ key: i.itemId, label: pick(i.name, i.nameTa), value: Number(i.amount) }))} />
            </ChartCard>
            <ChartCard
              title={t('chPayModes')} loading={loading} empty={data.paymentModes.length === 0}
              table={{ head: [t('paymentMode'), t('entries'), t('total'), '%'], rows: (data.paymentModes as any[]).map((m) => [MODE_KEY[m.mode] ? t(MODE_KEY[m.mode]) : m.mode, m.count, money(m.amount), m.sharePct === null ? '—' : `${m.sharePct}%`]) }}
            >
              <BarList ariaLabel={t('chPayModes')} color={PURCHASES} fmt={money} rows={(data.paymentModes as any[]).map((m) => ({ key: m.mode, label: MODE_KEY[m.mode] ? t(MODE_KEY[m.mode]) : m.mode, value: Number(m.amount), detail: `${m.count} ${t('entries')}` }))} />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
