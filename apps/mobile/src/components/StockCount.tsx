import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { api, ApiError } from '@/lib/api';
import { dec, formatINR } from '@/lib/money';
import { cleanQty, COUNT_REASONS, fmtQty, toBase, toDisplay } from '@/lib/qty';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useDay } from '@/lib/useDate';
import { useBranches } from '@/lib/useLookups';
import { Banner, Button, Card, Chip, Chips, DateStepper, ErrorBox, Field, Loading, Muted, SelectField, Sheet, StatCard } from './ui';

const SIGNIFICANT_PCT = 5; // the shop-wide default; the server decides per item

/**
 * Daily stock reconciliation for one location: per item, opening + purchases + transfers in - transfers out - used - wastage
 * = expected closing, then the physical count and the difference. A significant difference needs a reason and an explanation
 * and is approved by the Admin.
 */
export function StockCount({ fixedLocationId }: { fixedLocationId?: string }) {
  const th = useTheme();
  const { can } = useSession();
  const branches = useBranches();
  const day = useDay();
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState<Record<string, string>>({});
  const [phys, setPhys] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [expl, setExpl] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState<any[]>([]);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!locationId) { setData(null); return; }
    try {
      const d = await api.get(`/stock/reconciliation?locationId=${locationId}&date=${day.date}`);
      setData(d); setError(null);
      const u: Record<string, string> = {}, p: Record<string, string> = {}, rs: Record<string, string> = {}, ex: Record<string, string> = {};
      for (const r of d.rows as any[]) {
        if (dec(r.consumption).greaterThan(0)) u[r.itemId] = toDisplay(r.consumption, r.displayFactor);
        if (r.physical !== null) p[r.itemId] = toDisplay(r.physical, r.displayFactor);
        if (r.reason) rs[r.itemId] = r.reason;
        if (r.explanation) ex[r.itemId] = r.explanation;
      }
      setUsed(u); setPhys(p); setReason(rs); setExpl(ex);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId, day.date]);
  useEffect(() => { setData(null); setNotice(null); setProblems([]); void load(); }, [load]);

  const loadWaiting = useCallback(async () => {
    if (!can('count:approve')) return;
    try { setWaiting(await api.get('/stock/counts?status=SUBMITTED')); } catch { /* ignore */ }
  }, [can]);
  useEffect(() => { void loadWaiting(); }, [loadWaiting, data]);

  const count = data?.count as { id: string; status: string; reviewComment?: string | null; countedBy?: string | null } | null | undefined;
  const status = count?.status ?? 'NONE';
  const locked = status === 'SUBMITTED' || status === 'APPROVED';
  const editable = !locked && can('count:enter');

  /** What a row looks like with the numbers typed so far (the server recomputes on save). */
  const calc = useCallback((r: any) => {
    const savedUse = dec(r.consumption);
    const typedUse = used[r.itemId] ? dec(toBase(used[r.itemId], r.displayFactor)) : savedUse;
    const expected = locked ? dec(r.expected) : dec(r.expected).plus(savedUse).minus(typedUse);
    const counted = phys[r.itemId] ? dec(toBase(phys[r.itemId], r.displayFactor)) : null;
    const variance = locked ? (r.variance === null ? null : dec(r.variance)) : counted === null ? null : counted.minus(expected);
    const pct = variance && expected.greaterThan(0) ? variance.abs().div(expected).mul(100) : null;
    const significant = locked ? !!r.isSignificant : (!!variance && !variance.isZero() && (expected.lessThanOrEqualTo(0) || (pct !== null && pct.greaterThan(SIGNIFICANT_PCT)))) || !!r.isSignificant;
    return { expected, counted, variance, value: variance ? variance.mul(dec(r.avgCost)) : null, significant };
  }, [used, phys, locked]);

  const rows: any[] = data?.rows ?? [];
  const calcs = useMemo(() => new Map(rows.map((r) => [r.itemId, calc(r)])), [rows, calc]);
  const anyCounted = rows.some((r) => phys[r.itemId]);

  async function save(): Promise<boolean> {
    setBusy(true); setError(null); setProblems([]); setNotice(null);
    try {
      const useLines = rows.filter((r) => used[r.itemId] && !dec(toBase(used[r.itemId], r.displayFactor)).equals(dec(r.consumption))).map((r) => ({ itemId: r.itemId, quantity: toBase(used[r.itemId], r.displayFactor) }));
      if (useLines.length) await api.put('/stock/consumption', { locationId, businessDate: day.date, items: useLines });
      const countLines = rows.filter((r) => phys[r.itemId]).map((r) => ({ itemId: r.itemId, physicalQty: toBase(phys[r.itemId], r.displayFactor), reason: reason[r.itemId] || undefined, explanation: expl[r.itemId]?.trim() || undefined }));
      if (countLines.length) await api.put(`/stock/counts/${locationId}/${day.date}`, { items: countLines });
      await load(); setNotice('Saved');
      return true;
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); return false; }
    finally { setBusy(false); }
  }

  async function send() {
    if (!(await save())) return;
    setBusy(true); setError(null);
    try { await api.post(`/stock/counts/${locationId}/${day.date}/submit`); await load(); setNotice(null); }
    catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) { setError(e.message); setProblems((e.details as any[]).map((d) => d.message)); }
      else setError(e instanceof ApiError ? e.message : 'Could not send');
    } finally { setBusy(false); }
  }

  async function decide(kind: 'approve' | 'reject', id: string, why?: string) {
    setBusy(true); setError(null);
    try { await api.post(`/stock/counts/${id}/${kind}`, kind === 'reject' ? { comment: why } : undefined); setRejecting(null); setComment(''); await load(); await loadWaiting(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  const totals = data?.totals;
  const shown = rows.filter((r) => !search || `${r.name} ${r.code}`.toLowerCase().includes(search.toLowerCase()));
  const statusChip = status === 'APPROVED' ? <Chip text="Approved" tone="ok" icon="✓" /> : status === 'SUBMITTED' ? <Chip text="Sent for approval" tone="warn" icon="◔" /> : status === 'REJECTED' ? <Chip text="Rejected" tone="bad" icon="✕" /> : status === 'DRAFT' ? <Chip text="Draft" /> : null;

  return (
    <>
      {!fixedLocationId ? <SelectField label="Branch" value={locationId} onChange={setLocationId} placeholder="Choose a branch…" options={branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} /> : null}
      <DateStepper label={day.label} onPrev={day.prev} onNext={day.next} nextDisabled={day.isToday} />
      {waiting.length > 0 ? (
        <Card tone="warn">
          <Text style={{ color: th.warn.text, fontWeight: '700' }}>{waiting.length} count{waiting.length === 1 ? '' : 's'} waiting for your approval</Text>
          {waiting.slice(0, 5).map((w) => (
            <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: th.ink, flex: 1 }}>{w.locationName ?? ''} · {String(w.businessDate).slice(0, 10)}</Text>
              <Button small title="Approve" onPress={() => decide('approve', w.id)} />
              <Button small variant="danger" title="Reject" onPress={() => { setComment(''); setRejecting(w.id); }} />
            </View>
          ))}
        </Card>
      ) : null}
      <ErrorBox error={error} />
      {problems.length > 0 ? <Banner tone="bad">{problems.map((p) => `• ${p}`).join('\n')}</Banner> : null}
      {!locationId ? <Muted>Choose a branch first.</Muted> : !data ? (error ? null : <Loading />) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: th.ink, fontSize: 18, fontWeight: '800' }}>{data.locationName}</Text>
            {statusChip}
          </View>
          {status === 'REJECTED' && count?.reviewComment ? <Banner tone="bad">✕ {count.reviewComment}</Banner> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            <StatCard icon="check-circle" tone="ok" value={`${totals.itemsCounted}/${totals.itemsTotal}`} label="Items counted" />
            <StatCard icon="alert-triangle" tone={totals.shortages ? 'bad' : 'neutral'} value={String(totals.shortages)} label="Shortages" sub={`${formatINR(totals.shortageValue, { decimals: false })}`} />
          </View>
          <Field label="Search items" value={search} onChangeText={setSearch} autoCapitalize="none" />
          {shown.map((r) => {
            const c = calcs.get(r.itemId)!;
            const need = c.significant && editable;
            return (
              <Card key={r.itemId} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: th.ink, fontWeight: '700' }}>{r.name} <Text style={{ color: th.faint, fontWeight: '400', fontSize: 12 }}>{r.displayUnit}</Text></Text>
                    <Text style={{ color: th.muted, fontSize: 12 }}>Opening {toDisplay(r.opening, r.displayFactor)} · +{toDisplay(dec(r.purchases).plus(r.transfersIn).toString(), r.displayFactor)} in · −{toDisplay(dec(r.transfersOut).plus(r.wastage).toString(), r.displayFactor)} out</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: th.muted, fontSize: 12 }}>Expected</Text>
                    <Text style={{ color: th.ink, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{toDisplay(c.expected.toString(), r.displayFactor)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><Field label="Used today" value={used[r.itemId] ?? ''} editable={editable} keyboardType="decimal-pad" placeholder="0" onChangeText={(v) => setUsed((u) => ({ ...u, [r.itemId]: cleanQty(v) }))} /></View>
                  <View style={{ flex: 1 }}><Field label="Counted" value={phys[r.itemId] ?? ''} editable={editable} keyboardType="decimal-pad" placeholder="—" onChangeText={(v) => setPhys((p) => ({ ...p, [r.itemId]: cleanQty(v) }))} /></View>
                </View>
                {c.variance ? (
                  <Chip
                    tone={c.variance.isZero() ? 'ok' : c.variance.isNegative() ? 'bad' : 'warn'} icon={c.variance.isZero() ? '✓' : c.variance.isNegative() ? '▼' : '▲'}
                    text={c.variance.isZero() ? 'Tallied' : `${c.variance.isNegative() ? 'Shortage' : 'Excess'} ${fmtQty(c.variance.abs().toString(), r.displayFactor, r.displayUnit)}${c.value ? ` · ${formatINR(c.value.abs(), { decimals: false })}` : ''}`}
                  />
                ) : null}
                {(c.significant || reason[r.itemId] || expl[r.itemId]) ? (
                  <View style={{ gap: 6 }}>
                    {need ? <Text style={{ color: th.bad.text, fontWeight: '700', fontSize: 12 }}>A reason and explanation are needed *</Text> : null}
                    {editable ? <Chips value={reason[r.itemId] ?? ''} onChange={(v) => setReason((x) => ({ ...x, [r.itemId]: v }))} options={COUNT_REASONS.map(([v, l]) => ({ value: v, label: l }))} /> : reason[r.itemId] ? <Muted>{COUNT_REASONS.find(([v]) => v === reason[r.itemId])?.[1]}</Muted> : null}
                    {editable ? <Field label="Explanation" value={expl[r.itemId] ?? ''} multiline onChangeText={(v) => setExpl((x) => ({ ...x, [r.itemId]: v }))} /> : expl[r.itemId] ? <Muted>“{expl[r.itemId]}”</Muted> : null}
                  </View>
                ) : null}
              </Card>
            );
          })}
          {notice ? <Banner tone="ok">✓ {notice}</Banner> : null}
          {editable ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button title="Save" variant="secondary" style={{ flex: 1 }} loading={busy} onPress={save} />
              <Button title="Send for approval" style={{ flex: 1 }} disabled={busy || !anyCounted} onPress={send} />
            </View>
          ) : null}
          {count && status === 'SUBMITTED' && can('count:approve') ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button title="✓ Approve" style={{ flex: 1 }} loading={busy} onPress={() => decide('approve', count.id)} />
              <Button title="✕ Reject" variant="danger" style={{ flex: 1 }} onPress={() => { setComment(''); setRejecting(count.id); }} />
            </View>
          ) : null}
        </>
      )}
      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title="Reject count">
        <Field label="Comment" required value={comment} onChangeText={setComment} multiline />
        <Button title="Confirm reject" variant="danger" loading={busy} disabled={!comment.trim()} onPress={() => decide('reject', rejecting!, comment)} />
      </Sheet>
    </>
  );
}
