import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, View } from 'react-native';
import { Text } from './Text';
import { api, ApiError, API_ORIGIN, uploadAttachment } from '@/lib/api';
import { prettyDate, todayIST, uuid } from '@/lib/dates';
import { approvalTone, STATUS_LABEL } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { pickPhoto, type Photo } from '@/lib/photo';
import { cleanQty, fmtQty, toBase, toDisplay, TRANSFER_STATUS, WASTAGE_REASONS, wastageReason } from '@/lib/qty';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { addDays } from '@/lib/dates';
import { useBranches } from '@/lib/useLookups';
import { BarList, Banner, Button, Card, Chip, Chips, ErrorBox, Field, Heading, ListRow, Loading, Muted, SectionTitle, SelectField, Sheet, StatCard } from './ui';

const money = (n: number | string) => formatINR(n, { decimals: false });

/** Items and units for stock entry (the same master snapshot the expense screen uses). */
function useMasters(locationId?: string) {
  const [boot, setBoot] = useState<any>(null);
  useEffect(() => { api.get(`/sync/bootstrap${locationId ? `?locationId=${locationId}` : ''}`).then(setBoot).catch(() => undefined); }, [locationId]);
  const items: any[] = (boot?.items ?? []).filter((i: any) => i.status === 'ACTIVE');
  const units: any[] = boot?.units ?? [];
  /** The units an item can be entered in: its stock unit and its purchase unit. */
  const unitsFor = (itemId: string) => {
    const it = items.find((i) => i.id === itemId);
    if (!it) return [];
    return [it.baseUnitId, it.purchaseUnitId].filter(Boolean).map((id: string) => units.find((u) => u.id === id)).filter(Boolean);
  };
  return { boot, items, units, unitsFor };
}

// ------------------------------------------------------------------ wastage
/** Wastage entries: record spoiled / expired / burnt stock, with a photo for big ones; the Admin approves. */
export function WastagePanel({ fixedLocationId }: { fixedLocationId?: string }) {
  const th = useTheme();
  const { can } = useSession();
  const branches = useBranches();
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ itemId: '', unitId: '', qty: '', reason: 'SPOILED', note: '' });
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [warn, setWarn] = useState<any[]>([]);
  const masters = useMasters(locationId || undefined);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ from: addDays(todayIST(), -29), to: todayIST(), pageSize: '60' });
      if (locationId) p.set('locationId', locationId);
      setRows(await api.get(`/wastage?${p}`)); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  async function save() {
    if (!locationId) return;
    setBusy('new'); setFormError(null);
    try {
      const attachmentKeys = photo ? [await uploadAttachment(photo.uri, photo.name, locationId)] : undefined;
      const res = await api.full.post('/wastage', { locationId, businessDate: todayIST(), itemId: form.itemId, unitId: form.unitId, quantity: dec(form.qty).toString(), reason: form.reason, reasonNote: form.note.trim() || undefined, attachmentKeys, clientUuid: uuid() });
      setWarn(res.warnings ?? []); setAdding(false); setForm({ itemId: '', unitId: '', qty: '', reason: 'SPOILED', note: '' }); setPhoto(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(null); }
  }
  async function act(id: string, kind: 'approve' | 'reject' | 'cancel', body?: unknown) {
    setBusy(id); setError(null);
    try { await api.post(`/wastage/${id}/${kind}`, body); setRejecting(null); setWhy(''); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(null); }
  }
  async function receipt(id: string) {
    try {
      const list = await api.get(`/attachments?entityType=WASTAGE&entityId=${id}`);
      const first = (list as any[])[0];
      if (!first) { setError('No photo attached'); return; }
      const { url } = await api.get(`/attachments/${first.id}/url`);
      await Linking.openURL(url.startsWith('/') ? `${API_ORIGIN}${url}` : url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the photo'); }
  }

  const total = (rows ?? []).filter((r) => r.status === 'ACTIVE').reduce((a, r) => a.plus(dec(r.estimatedValue)), dec(0));
  return (
    <>
      {!fixedLocationId ? <SelectField label="Branch" value={locationId} onChange={setLocationId} placeholder="All branches" options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} /> : null}
      {can('wastage:create') && locationId ? <Button small icon="plus" title="Record wastage" onPress={() => { setFormError(null); setAdding(true); }} /> : null}
      {warn.length > 0 ? <Banner tone="warn">{warn.map((w) => `⚠ ${w.message}`).join('\n')}</Banner> : null}
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No wastage in the last 30 days.</Muted> : (
        <>
          <Muted small>Last 30 days · {money(total)}</Muted>
          {rows.map((w) => {
            const st = w.status !== 'ACTIVE' ? w.status : w.approvalStatus;
            return (
              <Card key={w.id} style={{ gap: 6, opacity: w.status !== 'ACTIVE' ? 0.6 : 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: th.ink, fontWeight: '700' }}>{w.itemName}</Text>
                    <Text style={{ color: th.muted, fontSize: 12 }}>{prettyDate(String(w.businessDate).slice(0, 10))} · {w.locationName} · {w.code}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ color: th.ink, fontWeight: '800' }}>{dec(w.quantity).toDecimalPlaces(3).toString()} {w.unitCode}</Text>
                    <Text style={{ color: th.muted, fontSize: 12 }}>{money(w.estimatedValue)}</Text>
                    <Chip text={STATUS_LABEL[st] ?? st} tone={approvalTone(st)} />
                  </View>
                </View>
                <Text style={{ color: th.muted, fontSize: 12 }}>{wastageReason(w.reason)}{w.reasonNote ? ` · ${w.reasonNote}` : ''} · by {w.enteredByName ?? '—'}</Text>
                {w.rejectionReason ? <Text style={{ color: th.bad.text, fontSize: 12 }}>{w.rejectionReason}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {w.receiptCount > 0 ? <Button small variant="secondary" icon="image" title="Photo" onPress={() => receipt(w.id)} /> : null}
                  {w.approvalStatus === 'SUBMITTED' && w.status === 'ACTIVE' && can('wastage:approve') ? (
                    <>
                      <Button small title="✓ Approve" loading={busy === w.id} onPress={() => act(w.id, 'approve')} />
                      <Button small variant="danger" title="✕ Reject" onPress={() => { setWhy(''); setRejecting(w); }} />
                    </>
                  ) : null}
                  {w.approvalStatus === 'SUBMITTED' && w.status === 'ACTIVE' && can('wastage:create') ? <Button small variant="secondary" title="Cancel" onPress={() => act(w.id, 'cancel', {})} /> : null}
                </View>
              </Card>
            );
          })}
        </>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Record wastage">
        <SelectField label="Item" required value={form.itemId} onChange={(v) => { const u = masters.unitsFor(v); setForm({ ...form, itemId: v, unitId: u[0]?.id ?? '' }); }} options={masters.items.map((i) => ({ value: i.id, label: `${i.nameEn} (${i.code})` }))} />
        {form.itemId ? <Chips label="Unit" value={form.unitId} onChange={(v) => setForm({ ...form, unitId: v })} options={masters.unitsFor(form.itemId).map((u: any) => ({ value: u.id, label: u.code }))} /> : null}
        <Field label="Quantity" required value={form.qty} keyboardType="decimal-pad" onChangeText={(v) => setForm({ ...form, qty: cleanQty(v) })} />
        <Chips label="Reason" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} options={WASTAGE_REASONS.map(([v, l]) => ({ value: v, label: l }))} />
        <Field label="Note" value={form.note} onChangeText={(v) => setForm({ ...form, note: v })} maxLength={300} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Button small variant="secondary" icon="camera" title="Photo" onPress={async () => { try { const p = await pickPhoto('camera'); if (p) setPhoto(p); } catch (e) { setFormError(e instanceof Error ? e.message : 'Photo failed'); } }} />
          {photo ? <Image source={{ uri: photo.uri }} style={{ width: 48, height: 48, borderRadius: 10 }} /> : null}
        </View>
        <ErrorBox error={formError} />
        <Button title="Save" loading={busy === 'new'} disabled={!form.itemId || !form.unitId || !dec(form.qty || '0').greaterThan(0)} onPress={save} />
      </Sheet>
      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title="Reject wastage">
        <Field label="Reason" required value={why} onChangeText={setWhy} multiline />
        <Button title="Confirm reject" variant="danger" disabled={!why.trim()} onPress={() => act(rejecting.id, 'reject', { reason: why })} />
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ transfers
/** Stock moving between branches and the godown: request, approve, dispatch, receive. */
export function TransfersPanel({ fixedLocationId }: { fixedLocationId?: string }) {
  const th = useTheme();
  const { can, me } = useSession();
  const branches = useBranches();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [got, setGot] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ from: '', to: '', vehicle: '', remarks: '', lines: [{ itemId: '', unitId: '', qty: '' }] });
  const [formError, setFormError] = useState<string | null>(null);
  const masters = useMasters();
  const [places, setPlaces] = useState<any[]>([]);
  useEffect(() => { api.get('/locations').then((l) => setPlaces(l as any[])).catch(() => undefined); }, []);

  const mine = (id: string) => me?.allLocations || me?.locations.some((l) => l.id === id);
  const load = useCallback(async () => {
    try { setRows(await api.get(`/transfers${fixedLocationId ? `?locationId=${fixedLocationId}` : ''}`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [fixedLocationId]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  async function open(id: string) {
    try {
      const d = await api.get(`/transfers/${id}`);
      const g: Record<string, string> = {};
      for (const i of d.items) g[i.itemId] = toDisplay(i.sentQty, i.displayFactor);
      setGot(g); setWhy({}); setDetail(d);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }
  async function act(kind: 'approve' | 'dispatch' | 'cancel') {
    setBusy(true); setError(null);
    try { await api.post(`/transfers/${detail.id}/${kind}`, kind === 'cancel' ? {} : undefined); setDetail(null); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); setDetail(null); } finally { setBusy(false); }
  }
  async function receive() {
    setBusy(true); setError(null);
    try {
      await api.post(`/transfers/${detail.id}/receive`, { items: detail.items.map((i: any) => ({ itemId: i.itemId, receivedQty: toBase(got[i.itemId] ?? '0', i.displayFactor), reason: why[i.itemId]?.trim() || undefined })) });
      setDetail(null); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  async function create() {
    setBusy(true); setFormError(null);
    try {
      await api.post('/transfers', {
        fromLocationId: form.from, toLocationId: form.to, businessDate: todayIST(), vehicleRef: form.vehicle.trim() || undefined, remarks: form.remarks.trim() || undefined,
        items: form.lines.filter((l) => l.itemId && l.unitId && dec(l.qty || '0').greaterThan(0)).map((l) => ({ itemId: l.itemId, unitId: l.unitId, quantity: dec(l.qty).toString() })),
      });
      setAdding(false); setForm({ from: '', to: '', vehicle: '', remarks: '', lines: [{ itemId: '', unitId: '', qty: '' }] }); await load();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }

  const placeOpts = places.filter((p) => p.status === 'ACTIVE').map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));
  const canReceiveNow = detail && detail.status === 'DISPATCHED' && can('transfer:receive') && mine(detail.toLocationId);
  const short = detail && canReceiveNow ? detail.items.some((i: any) => dec(toBase(got[i.itemId] ?? '0', i.displayFactor)).lessThan(dec(i.sentQty))) : false;

  return (
    <>
      {can('transfer:create') ? <Button small icon="plus" title="New transfer" onPress={() => { setFormError(null); setAdding(true); }} /> : null}
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No transfers yet.</Muted> : rows.map((r) => {
        const incoming = r.status === 'DISPATCHED' && mine(r.toLocationId);
        return (
          <ListRow
            key={r.id} title={`${r.fromLocationName} → ${r.toLocationName}`} tone={incoming ? 'warn' : undefined}
            lines={[`${r.code} · ${prettyDate(String(r.businessDate).slice(0, 10))}`, (r.items as any[]).map((i) => `${i.itemName} ${toDisplay(i.sentQty, i.displayFactor)} ${i.displayUnit}`).join(', ')]}
            right={<Chip text={incoming ? 'To receive' : TRANSFER_STATUS[r.status] ?? r.status} tone={r.status === 'RECEIVED' ? 'ok' : r.status === 'CANCELLED' ? 'bad' : 'warn'} />}
            onPress={() => open(r.id)}
          />
        );
      })}

      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.fromLocationName} → ${detail.toLocationName}` : ''}>
        {detail ? (
          <>
            <Muted>{detail.code} · {TRANSFER_STATUS[detail.status] ?? detail.status}{detail.vehicleRef ? ` · vehicle ${detail.vehicleRef}` : ''}</Muted>
            {detail.items.map((i: any) => (
              <Card key={i.itemId} style={{ gap: 6, padding: 12 }}>
                <Text style={{ color: th.ink, fontWeight: '700' }}>{i.itemName}</Text>
                <Muted small>Sent {fmtQty(i.sentQty, i.displayFactor, i.displayUnit)}{i.receivedQty != null ? ` · received ${fmtQty(i.receivedQty, i.displayFactor, i.displayUnit)}` : ''}</Muted>
                {canReceiveNow ? (
                  <>
                    <Field label={`Received (${i.displayUnit})`} value={got[i.itemId] ?? ''} keyboardType="decimal-pad" onChangeText={(v) => setGot((g) => ({ ...g, [i.itemId]: cleanQty(v) }))} />
                    {dec(toBase(got[i.itemId] ?? '0', i.displayFactor)).lessThan(dec(i.sentQty)) ? <Field label="Why short?" required value={why[i.itemId] ?? ''} onChangeText={(v) => setWhy((w) => ({ ...w, [i.itemId]: v }))} /> : null}
                  </>
                ) : null}
              </Card>
            ))}
            {detail.remarks ? <Muted>{detail.remarks}</Muted> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {detail.status === 'PENDING_APPROVAL' && can('transfer:approve') ? <Button title="✓ Approve" loading={busy} onPress={() => act('approve')} /> : null}
              {detail.status === 'APPROVED' && can('transfer:dispatch') && mine(detail.fromLocationId) ? <Button title="➜ Dispatch" loading={busy} onPress={() => act('dispatch')} /> : null}
              {canReceiveNow ? <Button title="Receive" loading={busy} disabled={detail.items.some((i: any) => dec(toBase(got[i.itemId] ?? '0', i.displayFactor)).lessThan(dec(i.sentQty)) && !why[i.itemId]?.trim())} onPress={receive} /> : null}
              {['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(detail.status) && can('transfer:create') ? <Button variant="danger" title="Cancel transfer" disabled={busy} onPress={() => act('cancel')} /> : null}
            </View>
            {short ? <Muted small>Anything short is recorded as lost stock.</Muted> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="New transfer">
        <SelectField label="From" required value={form.from} onChange={(v) => setForm({ ...form, from: v })} options={placeOpts} />
        <SelectField label="To" required value={form.to} onChange={(v) => setForm({ ...form, to: v })} options={placeOpts.filter((o) => o.value !== form.from)} />
        {form.lines.map((l, idx) => (
          <Card key={idx} style={{ gap: 8, padding: 12 }}>
            <SelectField label={`Item ${idx + 1}`} value={l.itemId} onChange={(v) => setForm({ ...form, lines: form.lines.map((x, i) => (i === idx ? { ...x, itemId: v, unitId: masters.unitsFor(v)[0]?.id ?? '' } : x)) })} options={masters.items.map((i) => ({ value: i.id, label: i.nameEn }))} />
            {l.itemId ? <Chips value={l.unitId} onChange={(v) => setForm({ ...form, lines: form.lines.map((x, i) => (i === idx ? { ...x, unitId: v } : x)) })} options={masters.unitsFor(l.itemId).map((u: any) => ({ value: u.id, label: u.code }))} /> : null}
            <Field label="Quantity" value={l.qty} keyboardType="decimal-pad" onChangeText={(v) => setForm({ ...form, lines: form.lines.map((x, i) => (i === idx ? { ...x, qty: cleanQty(v) } : x)) })} />
          </Card>
        ))}
        <Button small variant="secondary" title="+ Add item" onPress={() => setForm({ ...form, lines: [...form.lines, { itemId: '', unitId: '', qty: '' }] })} />
        <Field label="Vehicle" value={form.vehicle} onChangeText={(v) => setForm({ ...form, vehicle: v })} maxLength={40} />
        <Field label="Remarks" value={form.remarks} onChangeText={(v) => setForm({ ...form, remarks: v })} multiline />
        <ErrorBox error={formError} />
        <Button title="Create transfer" loading={busy} disabled={!form.from || !form.to || !form.lines.some((l) => l.itemId && dec(l.qty || '0').greaterThan(0))} onPress={create} />
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ variance report
/** History of stock count differences: shortages, excesses and wastage, by item and by branch. */
export function StockVariancePanel({ fixedLocationId }: { fixedLocationId?: string }) {
  const th = useTheme();
  const branches = useBranches();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    const p = new URLSearchParams({ from: addDays(todayIST(), -(Number(days) - 1)), to: todayIST() });
    if (locationId) p.set('locationId', locationId);
    api.get(`/stock/variance-report?${p}`).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [days, locationId]);

  const s = data?.summary;
  return (
    <>
      <Chips value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
      {!fixedLocationId ? <SelectField label="Branch" value={locationId} onChange={setLocationId} placeholder="All branches" options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} /> : null}
      <ErrorBox error={error} />
      {!data ? (error ? null : <Loading />) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            <StatCard icon="alert-triangle" tone="bad" value={money(s.shortageValue)} label="Shortage value" sub={`${s.shortageCount} items`} />
            <StatCard icon="plus-circle" tone="warn" value={money(s.excessValue)} label="Excess value" sub={`${s.excessCount} items`} />
            <StatCard icon="activity" tone={dec(s.net).isNegative() ? 'bad' : 'ok'} value={money(s.net)} label="Net" />
            <StatCard icon="trash-2" tone="sky" value={money(s.wastageValue)} label="Wastage value" />
          </View>
          <Card><SectionTitle>By item (net)</SectionTitle><BarList color={th.series[1]} format={money} rows={(data.byItem as any[]).map((r) => ({ key: r.id, label: r.name, value: Math.abs(Number(r.net)), detail: `Shortage ${money(r.shortageValue)} · excess ${money(r.excessValue)}` }))} /></Card>
          <Card><SectionTitle>Wastage by item</SectionTitle><BarList color={th.series[5]} format={money} rows={(data.wastageByItem as any[]).map((r) => ({ key: r.itemId, label: r.name, value: Number(r.value) }))} /></Card>
          {!fixedLocationId && data.byLocation.length > 1 ? <Card><SectionTitle>By branch</SectionTitle><BarList color={th.series[0]} format={money} rows={(data.byLocation as any[]).map((r) => ({ key: r.id, label: r.name, value: Math.abs(Number(r.net)), detail: `Shortage ${money(r.shortageValue)} · excess ${money(r.excessValue)}` }))} /></Card> : null}
          {(data.rows as any[]).slice(0, 40).map((r) => (
            <ListRow
              key={r.id} title={`${r.itemName ?? r.name} · ${prettyDate(String(r.businessDate).slice(0, 10))}`}
              lines={[r.locationName, r.reason ? `Reason: ${r.reason}` : null, r.explanation]}
              right={<Text style={{ color: dec(r.varianceValue ?? r.value).isNegative() ? th.bad.text : th.warn.text, fontWeight: '800' }}>{money(dec(r.varianceValue ?? r.value ?? 0).abs().toString())}</Text>}
            />
          ))}
        </>
      )}
    </>
  );
}


