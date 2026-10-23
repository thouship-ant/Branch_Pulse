'use client';

import { Select } from '@/components/Select';
import { DateInput } from '@/components/DateNav';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Warning } from '@/lib/api';
import { addDays, monthLong, monthShort, prettyDate, shortDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { compressImage } from '@/lib/image';
import { STATUS_KEY, WASTAGE_REASON_KEY } from '@/lib/labels';
import { cleanAmount, dec, formatINR } from '@/lib/money';
import { cacheMaster, readMaster, submitOffline } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { BarList, ChartCard, Columns, compact } from '../charts';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import type { LocationOption } from '../purchases/PurchaseForm';
import { Chips, ErrorBox, Sheet, Skeleton, StatusPill, TextField, Warnings } from '../ui';

const PAGE = 20;
const money = (v: string | number) => formatINR(v, { decimals: false });
const day = (d: unknown) => String(d).slice(0, 10);
const REASONS = Object.keys(WASTAGE_REASON_KEY);
const WASTE = 'var(--series-6)'; // wastage has its own hue everywhere

interface Boot { units: Array<{ id: string; code: string; baseUnitId: string | null }>; items: Array<{ id: string; code: string; nameEn: string; nameTa?: string | null; baseUnitId: string; purchaseUnitId?: string | null; status: string }> }

/** Record what was thrown away and why. The stock drops at once; approval decides whether the loss is accepted. */
export function WastageForm({ locations, fixedLocationId, onSaved }: { locations: LocationOption[]; fixedLocationId?: string; onSaved: (r: { queued: boolean; warnings: Warning[] }) => void }) {
  const { t, pick } = useT();
  const today = todayIST();
  const [boot, setBoot] = useState<Boot | null>(null);
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [date, setDate] = useState(today);
  const [itemId, setItemId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('SPOILED');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; name: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = `bootstrap:${fixedLocationId ?? 'all'}`;
    (async () => {
      try { const b = await api.get(`/sync/bootstrap${fixedLocationId ? `?locationId=${fixedLocationId}` : ''}`); setBoot(b); void cacheMaster(key, b); }
      catch { const c = await readMaster<Boot>(key); if (c) setBoot(c); }
    })();
  }, [fixedLocationId]);

  const items = boot?.items.filter((i) => i.status === 'ACTIVE') ?? [];
  const item = items.find((i) => i.id === itemId);
  const units = item ? (boot?.units ?? []).filter((u) => u.id === item.baseUnitId || u.baseUnitId === item.baseUnitId) : [];

  async function save() {
    setBusy(true); setError(null);
    try {
      const row = await submitOffline({
        entityType: 'WASTAGE', op: 'CREATE', locationId, businessDate: date,
        payload: { locationId, businessDate: date, itemId, quantity: dec(qty).toString(), unitId, reason, reasonNote: note.trim() || undefined },
        blobs: photo ? [{ blob: photo.blob, name: photo.name }] : undefined,
      });
      if (row.state === 'REJECTED' || row.state === 'CONFLICT') { setError(row.lastError ?? 'Could not save'); return; }
      onSaved({ queued: row.state !== 'DONE', warnings: (row.warnings as Warning[]) ?? [] });
    } finally { setBusy(false); }
  }

  if (!boot) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      {!fixedLocationId && (
        <div>
          <label htmlFor="wl" className="label">{t('atLocation')} *</label>
          <Select id="wl" className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('chooseLocation')}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
          </Select>
        </div>
      )}
      <div>
        <label htmlFor="wd" className="label">{t('dateLabel')}</label>
        <DateInput id="wd" value={date} max={today} min={addDays(today, -3)} onChange={(v) => setDate(v || today)} />
      </div>
      <div>
        <label htmlFor="wi" className="label">{t('itemLabel')} *</label>
        <Select id="wi" className="field" value={itemId} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); setItemId(e.target.value); setUnitId(it?.purchaseUnitId ?? it?.baseUnitId ?? ''); }}>
          <option value="">{t('chooseItem')}</option>
          {items.map((i) => <option key={i.id} value={i.id}>{pick(i.nameEn, i.nameTa)}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="wq" className="label">{t('quantity')} *</label>
          <input id="wq" className="field text-lg tabular-nums" inputMode="decimal" placeholder="0" value={qty} onChange={(e) => setQty(cleanAmount(e.target.value, 3))} />
        </div>
        <div>
          <label htmlFor="wu" className="label">{t('unitLabel')}</label>
          <Select id="wu" className="field" value={unitId} disabled={!itemId} onChange={(e) => setUnitId(e.target.value)}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
          </Select>
        </div>
      </div>
      <Chips label={`${t('reason')} *`} value={reason} onChange={setReason} options={REASONS.map((k) => ({ value: k, label: t(WASTAGE_REASON_KEY[k]) }))} />
      <TextField id="wn" label={t('wastageNote')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      <div>
        <span className="label">{t('photo')}</span>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const blob = await compressImage(f); setPhoto({ blob, name: f.name || 'wastage.jpg', url: URL.createObjectURL(blob) }); } }} />
        <div className="flex items-center gap-3">
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>📷 {t('addPhotoShort2')}</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo && <img src={photo.url} alt="Wastage photo" className="h-14 w-14 rounded-card border object-cover" />}
        </div>
      </div>
      <div className="sticky bottom-0 -mx-5 -mb-5 space-y-2 border-t border-slate-200 bg-surface px-5 pb-5 pt-3">
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={busy || !locationId || !itemId || !unitId || dec(qty).lessThanOrEqualTo(0)} onClick={save}>{busy ? t('loading') : t('save')}</button>
      </div>
    </div>
  );
}

/** The wastage list with approve / reject, and (for the owner) the analytics: by reason, item, branch and over time. */
export function WastagePanel({ locations, fixedLocationId, analytics = true }: { locations: LocationOption[]; fixedLocationId?: string; analytics?: boolean }) {
  const { t, pick } = useT();
  const { can } = useSession();
  const period = usePeriod('30');
  const { range, valid } = period;
  const [branchId, setBranchId] = useState(fixedLocationId ?? '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; totalValue: string } | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [group, setGroup] = useState<'day' | 'week' | 'month'>('day');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ queued: boolean; warnings: Warning[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => { setPage(1); }, [range.from, range.to, branchId, status]);
  const qs = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ from: range.from, to: range.to, ...extra });
    if (branchId) p.set('locationId', branchId);
    if (status) p.set('status', status);
    return p;
  }, [range.from, range.to, branchId, status]);

  useEffect(() => {
    if (!valid) return;
    api.full.get(`/wastage?${qs({ page: String(page), pageSize: String(PAGE) })}`)
      .then(({ data, meta: m }) => { setRows(data); setMeta({ total: Number(m?.total ?? 0), totalValue: String(m?.totalValue ?? '0') }); setError(null); })
      .catch((e) => setError(e.message));
  }, [qs, page, valid, refresh]);
  useEffect(() => {
    if (!valid || !analytics) return;
    const p = new URLSearchParams({ from: range.from, to: range.to, groupBy: group });
    if (branchId) p.set('locationId', branchId);
    api.get(`/wastage/summary?${p}`).then(setSum).catch(() => undefined);
  }, [range.from, range.to, branchId, group, valid, analytics, refresh]);

  async function decide(id: string, kind: 'approve' | 'reject', why?: string) {
    setBusy(id);
    try { await api.post(`/wastage/${id}/${kind}`, kind === 'reject' ? { reason: why } : undefined); setRejecting(null); setReason(''); setRefresh((n) => n + 1); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }
  async function viewPhoto(id: string) {
    try {
      const { data } = await api.full.get(`/attachments?entityType=WASTAGE&entityId=${id}`).catch(() => ({ data: null }));
      const first = (data as any[] | null)?.[0];
      if (!first) { setError(t('noReceipt')); return; }
      const { url } = await api.get(`/attachments/${first.id}/url`); window.open(url, '_blank', 'noopener');
    } catch (e: any) { setError(e.message); }
  }

  const label = (s: string) => (sum?.groupBy === 'month' ? monthShort(s.slice(0, 7)) : shortDate(s));
  const tip = (s: string) => (sum?.groupBy === 'month' ? monthLong(s.slice(0, 7)) : sum?.groupBy === 'week' ? t('weekOf', { d: prettyDate(s) }) : prettyDate(s));
  const pages = meta ? Math.max(1, Math.ceil(meta.total / PAGE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker period={period} label={t('colWastage')} />
        {can('wastage:create') && <button className="btn-primary" onClick={() => { setNotice(null); setAdding(true); }}>+ {t('addWastage')}</button>}
      </div>
      {notice && <div role="status" className="space-y-2 rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><p>✓ {notice.queued ? t('offline') : t('wastageSaved')}</p><Warnings items={notice.warnings} /></div>}
      <div className="flex flex-wrap gap-3">
        {!fixedLocationId && (
          <div className="min-w-[200px]">
            <label htmlFor="wfl" className="label">{t('atLocation')}</label>
            <Select id="wfl" className="field" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('allBranches')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {pick(l.name, l.nameTa)}</option>)}
            </Select>
          </div>
        )}
        <div className="min-w-[180px]">
          <label htmlFor="wfs" className="label">{t('approvalStatus')}</label>
          <Select id="wfs" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            {['SUBMITTED', 'APPROVED', 'REJECTED'].map((s) => <option key={s} value={s}>{t(STATUS_KEY[s])}</option>)}
          </Select>
        </div>
      </div>
      <ErrorBox error={error} />

      {analytics && sum && (
        <div className="space-y-4">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Summary">
            <div className="card"><p className="text-sm text-slate-600">{t('wastageValue')}</p><p className="text-xl font-bold tabular-nums">{money(sum.totals.value)}</p><p className="text-xs text-slate-500">{sum.totals.count} {t('entries')}</p></div>
            <div className={`card ${dec(sum.totals.pendingValue).greaterThan(0) ? 'border-amber-300' : ''}`}><p className="text-sm text-slate-600">{t('expPending')}</p><p className="text-xl font-bold tabular-nums">{money(sum.totals.pendingValue)}</p></div>
            <div className="card col-span-2 lg:col-span-1"><Chips label={t('pTrend')} value={group} onChange={setGroup} options={[{ value: 'day', label: t('gDay') }, { value: 'week', label: t('gWeek') }, { value: 'month', label: t('gMonth') }]} /></div>
          </section>
          <ChartCard title={t('chTrend')} empty={dec(sum.totals.value).isZero()} emptyText={t('noWastage')}
            table={{ head: [t('dateLabel'), t('entries'), t('total')], rows: (sum.buckets as any[]).map((b) => [tip(b.start), b.count, money(b.value)]) }}>
            <Columns cols={(sum.buckets as any[]).map((b) => ({ key: b.start, label: label(b.start), value: Number(b.value), tipTitle: tip(b.start) }))} fmt={money} axisFmt={(n) => compact(n, true)} color={WASTE} ariaLabel={t('chTrend')} />
          </ChartCard>
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title={t('reason')} empty={sum.byReason.length === 0} table={{ head: [t('reason'), t('total'), '%'], rows: (sum.byReason as any[]).map((r) => [WASTAGE_REASON_KEY[r.reason] ? t(WASTAGE_REASON_KEY[r.reason]) : r.reason, money(r.value), r.sharePct === null ? '—' : `${r.sharePct}%`]) }}>
              <BarList ariaLabel={t('reason')} color={WASTE} fmt={money} rows={(sum.byReason as any[]).map((r) => ({ key: r.reason, label: WASTAGE_REASON_KEY[r.reason] ? t(WASTAGE_REASON_KEY[r.reason]) : r.reason, value: Number(r.value), detail: r.sharePct === null ? undefined : `${r.sharePct}%` }))} />
            </ChartCard>
            <ChartCard title={t('byItemLabel')} empty={sum.byItem.length === 0} table={{ head: [t('itemLabel'), t('total'), '%'], rows: (sum.byItem as any[]).map((r) => [pick(r.name, r.nameTa), money(r.value), r.sharePct === null ? '—' : `${r.sharePct}%`]) }}>
              <BarList ariaLabel={t('byItemLabel')} color={WASTE} fmt={money} rows={(sum.byItem as any[]).map((r) => ({ key: r.itemId, label: pick(r.name, r.nameTa), value: Number(r.value), detail: r.sharePct === null ? undefined : `${r.sharePct}%` }))} />
            </ChartCard>
            {!fixedLocationId && (
              <ChartCard title={t('byBranchLabel')} empty={sum.byLocation.length === 0} table={{ head: [t('branch'), t('total'), '%'], rows: (sum.byLocation as any[]).map((r) => [pick(r.name, r.nameTa), money(r.value), r.sharePct === null ? '—' : `${r.sharePct}%`]) }}>
                <BarList ariaLabel={t('byBranchLabel')} color={WASTE} fmt={money} rows={(sum.byLocation as any[]).map((r) => ({ key: r.locationId, label: pick(r.name, r.nameTa), value: Number(r.value), detail: r.sharePct === null ? undefined : `${r.sharePct}%` }))} />
              </ChartCard>
            )}
          </div>
        </div>
      )}

      {!rows ? <Skeleton className="h-48" /> : rows.length === 0 ? <p className="card text-slate-600">{t('noWastage')}</p> : (
        <>
        {/* desktop: every column as a table */}
        <section className="card hidden overflow-x-auto p-0 lg:block" aria-label={t('colWastage')}>
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('dateLabel')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('atLocation')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('itemLabel')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('quantity')}</th>
                <th scope="col" className="px-3 py-2 text-right">{t('wastageValue')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('reason')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('enteredBy')} / {t('approvedBy')}</th>
                <th scope="col" className="px-3 py-2 text-left">{t('approvalStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              {rows.map((w) => {
                const st = w.status !== 'ACTIVE' ? w.status : w.approvalStatus;
                return (
                  <tr key={w.id} className={w.status !== 'ACTIVE' ? 'text-slate-500' : ''}>
                    <td className="px-3 py-2">{prettyDate(day(w.businessDate))}<p className="font-mono text-xs text-slate-500">{w.code}</p></td>
                    <td className="px-3 py-2">{pick(w.locationName, w.locationNameTa)}</td>
                    <td className="px-3 py-2">{pick(w.itemName, w.itemNameTa)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{dec(w.quantity).toString()} {w.unitCode}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{formatINR(w.estimatedValue)}</td>
                    <td className="px-3 py-2">{WASTAGE_REASON_KEY[w.reason] ? t(WASTAGE_REASON_KEY[w.reason]) : w.reason}{w.reasonNote && <p className="max-w-[200px] whitespace-pre-wrap text-xs text-slate-500">{w.reasonNote}</p>}{w.receiptCount > 0 && <button className="text-xs text-brand underline" onClick={() => viewPhoto(w.id)}>🖼 {w.receiptCount}</button>}</td>
                    <td className="px-3 py-2"><p><span className="text-xs text-slate-500">{t('enteredBy')}:</span> {w.enteredByName ?? '—'}</p><p><span className="text-xs text-slate-500">{t('approvedBy')}:</span> {w.approvedByName ?? '—'}</p></td>
                    <td className="px-3 py-2">
                      <StatusPill status={st} />
                      {w.approvalStatus === 'REJECTED' && w.rejectionReason && <p className="mt-1 max-w-[160px] text-xs text-red-700">{w.rejectionReason}</p>}
                      {w.approvalStatus === 'SUBMITTED' && w.status === 'ACTIVE' && can('wastage:approve') && (
                        <div className="flex gap-1.5 pt-1">
                          <button className="btn-primary min-h-[34px] px-2.5 text-xs" disabled={busy === w.id} onClick={() => decide(w.id, 'approve')}>✓ {t('approve')}</button>
                          <button className="btn-danger min-h-[34px] px-2.5 text-xs" disabled={busy === w.id} onClick={() => setRejecting(w)}>✕ {t('reject')}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* phone: one card per entry */}
        <ul className="space-y-3 lg:hidden" aria-label={t('colWastage')}>
          {rows.map((w) => {
            const st = w.status !== 'ACTIVE' ? w.status : w.approvalStatus;
            return (
              <li key={w.id} className={`card space-y-2 text-sm ${w.status !== 'ACTIVE' ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{pick(w.itemName, w.itemNameTa)}</p>
                    <p className="text-xs text-slate-500">{prettyDate(day(w.businessDate))} · {w.code}</p>
                  </div>
                  <StatusPill status={st} />
                </div>
                <div className="space-y-0.5">
                  <div className="flex justify-between"><span className="text-slate-600">{t('atLocation')}</span><span>{pick(w.locationName, w.locationNameTa)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">{t('quantity')}</span><span className="tabular-nums">{dec(w.quantity).toString()} {w.unitCode}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">{t('wastageValue')}</span><span className="font-semibold tabular-nums">{formatINR(w.estimatedValue)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">{t('reason')}</span><span>{WASTAGE_REASON_KEY[w.reason] ? t(WASTAGE_REASON_KEY[w.reason]) : w.reason}</span></div>
                </div>
                {w.reasonNote && <p className="text-xs text-slate-500">{w.reasonNote}</p>}
                {w.receiptCount > 0 && <button className="text-xs text-brand underline" onClick={() => viewPhoto(w.id)}>🖼 {w.receiptCount}</button>}
                <p className="text-xs text-slate-500">{t('enteredBy')}: {w.enteredByName ?? '—'}{w.approvedByName && ` · ${t('approvedBy')}: ${w.approvedByName}`}</p>
                {w.approvalStatus === 'REJECTED' && w.rejectionReason && <p className="text-xs text-red-700">{w.rejectionReason}</p>}
                {w.approvalStatus === 'SUBMITTED' && w.status === 'ACTIVE' && can('wastage:approve') && (
                  <div className="flex gap-2 pt-1">
                    <button className="btn-primary min-h-[36px] flex-1 px-3 text-sm" disabled={busy === w.id} onClick={() => decide(w.id, 'approve')}>✓ {t('approve')}</button>
                    <button className="btn-danger min-h-[36px] flex-1 px-3 text-sm" disabled={busy === w.id} onClick={() => setRejecting(w)}>✕ {t('reject')}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        </>
      )}
      {meta && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p>{t('showing')} {rows?.length ?? 0} {t('of')} {meta.total} · <b className="tabular-nums text-ink">{t('total')}: {formatINR(meta.totalValue)}</b></p>
          <div className="flex items-center gap-2">
            <button className="btn-secondary min-h-[36px] px-3" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← {t('prevPage')}</button>
            <span className="tabular-nums">{page} / {pages}</span>
            <button className="btn-secondary min-h-[36px] px-3" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('nextPage')} →</button>
          </div>
        </div>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('addWastage')}>
        <WastageForm locations={locations} fixedLocationId={fixedLocationId} onSaved={(r) => { setAdding(false); setNotice(r); setRefresh((n) => n + 1); }} />
      </Sheet>
      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`${t('reject')} · ${rejecting?.code ?? ''}`}>
        <div className="space-y-3">
          <label htmlFor="wrr" className="label">{t('reason')} *</label>
          <textarea id="wrr" className="field min-h-[96px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRejecting(null)}>{t('cancel')}</button>
            <button className="btn-danger" disabled={!reason.trim() || busy !== null} onClick={() => rejecting && decide(rejecting.id, 'reject', reason)}>{t('confirm')}</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
