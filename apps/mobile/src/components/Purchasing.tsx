import { useCallback, useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { Text } from './Text';
import { api, ApiError, uploadAttachment } from '@/lib/api';
import { prettyDate, todayIST, uuid } from '@/lib/dates';
import { approvalTone, MODE_LABEL, STATUS_LABEL } from '@/lib/labels';
import { amt, cleanAmount, dec, formatINR } from '@/lib/money';
import { pickPhoto, type Photo } from '@/lib/photo';
import { cleanQty } from '@/lib/qty';
import type { Period } from '@/lib/period';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';
import { BarList, Banner, Button, Card, Chip, Chips, ErrorBox, Field, Heading, ListRow, Loading, MoneyField, Muted, SectionTitle, SelectField, Sheet, StatCard } from './ui';

const money = (n: number | string | null | undefined) => formatINR(n == null ? null : String(n), { decimals: false });
const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CREDIT'] as const;

// ------------------------------------------------------------------ overview
/** Purchases for a period: totals, by supplier, by item, by branch, payment mix and what is still owed. */
export function PurchaseOverview({ period }: { period: Period }) {
  const th = useTheme();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    api.get(`/purchases/summary?from=${period.from}&to=${period.to}`).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [period]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const t = data.totals;
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <StatCard icon="shopping-bag" value={money(t.total)} label="Purchased" sub={`${t.count} purchases`} />
        <StatCard icon="check-circle" tone="ok" value={money(t.paid)} label="Paid now" />
        <StatCard icon="clock" tone="warn" value={money(t.credit)} label="On credit" />
        <StatCard icon="alert-triangle" tone={t.pendingApproval.count ? 'warn' : 'ok'} value={String(t.pendingApproval.count)} label="Pending approval" sub={money(t.pendingApproval.amount)} />
      </View>
      <Card tone={dec(data.outstanding.overdue).greaterThan(0) ? 'bad' : undefined}>
        <SectionTitle>Owed to suppliers</SectionTitle>
        <Text style={{ color: th.ink, fontSize: 26, fontWeight: '800' }}>{money(data.outstanding.total)}</Text>
        <Muted>{data.outstanding.suppliers} suppliers · overdue {money(data.outstanding.overdue)} · due soon {money(data.outstanding.dueSoon)}</Muted>
      </Card>
      <Card><SectionTitle>By supplier</SectionTitle><BarList color={th.series[0]} format={money} rows={(data.suppliers as any[]).map((s) => ({ key: s.supplierId, label: s.name, value: Number(s.amount), detail: `${s.count} purchases${s.sharePct == null ? '' : ` · ${s.sharePct}%`}` }))} /></Card>
      <Card><SectionTitle>By item</SectionTitle><BarList color={th.series[2]} format={money} rows={(data.items as any[]).slice(0, 10).map((i) => ({ key: i.itemId, label: i.name, value: Number(i.amount) }))} /></Card>
      <Card><SectionTitle>By branch</SectionTitle><BarList color={th.series[1]} format={money} rows={(data.locations as any[]).map((l) => ({ key: l.locationId, label: l.name, value: Number(l.amount), detail: `${l.count} purchases${l.sharePct == null ? '' : ` · ${l.sharePct}%`}` }))} /></Card>
      <Card><SectionTitle>Payment mix</SectionTitle><BarList color={th.series[3]} format={money} rows={(data.paymentModes as any[]).map((m) => ({ key: m.mode, label: MODE_LABEL[m.mode] ?? m.mode, value: Number(m.amount), detail: `${m.count} purchases` }))} /></Card>
    </>
  );
}

// ------------------------------------------------------------------ list
/** Purchase list with approve / reject, and the entry form. */
export function PurchaseList({ period, fixedLocationId }: { period?: Period; fixedLocationId?: string }) {
  const th = useTheme();
  const { can } = useSession();
  const branches = useBranches();
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<any[] | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const from = period?.from ?? todayIST().slice(0, 8) + '01';
  const to = period?.to ?? todayIST();
  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ from: period ? from : new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), to, pageSize: '60' });
      if (locationId) p.set('locationId', locationId);
      if (status) p.set('status', status);
      setRows(await api.get(`/purchases?${p}`)); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId, status, from, to, period]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  async function act(id: string, kind: 'approve' | 'reject', body?: unknown) {
    setBusy(id); setError(null);
    try { await api.post(`/purchases/${id}/${kind}`, body); setRejecting(null); setReason(''); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  return (
    <>
      {!fixedLocationId ? <SelectField label="Branch" value={locationId} onChange={setLocationId} placeholder="All branches" options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} /> : null}
      <Chips value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, { value: 'SUBMITTED', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />
      {can('purchase:create') ? <Button small icon="plus" title="New purchase" onPress={() => { setNotice(null); setAdding(true); }} /> : null}
      {notice ? <Banner tone="ok">✓ Purchase saved{notice.length ? `\n${notice.map((w) => `⚠ ${w.message}`).join('\n')}` : ''}</Banner> : null}
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No purchases for these filters.</Muted> : rows.map((p) => {
        const st = p.status !== 'ACTIVE' ? p.status : p.approvalStatus;
        return (
          <Card key={p.id} style={{ gap: 6, opacity: p.status !== 'ACTIVE' ? 0.6 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: th.ink, fontWeight: '700' }}>{p.supplierName}</Text>
                <Text style={{ color: th.muted, fontSize: 12 }}>{prettyDate(String(p.businessDate).slice(0, 10))} · {p.locationName} · {p.code}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={{ color: th.ink, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatINR(p.totalAmount)}</Text>
                <Chip text={STATUS_LABEL[st] ?? st} tone={approvalTone(st)} />
              </View>
            </View>
            <Text numberOfLines={2} style={{ color: th.muted, fontSize: 12 }}>{(p.items as any[]).map((i) => `${i.itemName} ${dec(i.quantity).toDecimalPlaces(3).toString()} ${i.unitCode}`).join(', ')}</Text>
            {dec(p.creditAmount).greaterThan(0) ? <Text style={{ color: th.warn.text, fontSize: 12 }}>◔ On credit {formatINR(p.creditAmount)}{p.dueDate ? ` · due ${prettyDate(String(p.dueDate).slice(0, 10))}` : ''}</Text> : null}
            {p.rejectionReason ? <Text style={{ color: th.bad.text, fontSize: 12 }}>✕ {p.rejectionReason}</Text> : null}
            {p.approvalStatus === 'SUBMITTED' && p.status === 'ACTIVE' && can('purchase:approve') ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button small title="✓ Approve" loading={busy === p.id} onPress={() => act(p.id, 'approve')} />
                <Button small variant="danger" title="✕ Reject" onPress={() => { setReason(''); setRejecting(p); }} />
              </View>
            ) : null}
          </Card>
        );
      })}
      <Sheet open={adding} onClose={() => setAdding(false)} title="New purchase">
        <PurchaseForm fixedLocationId={fixedLocationId} onSaved={(w) => { setAdding(false); setNotice(w); void load(); }} />
      </Sheet>
      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject · ${rejecting?.code ?? ''}`}>
        <Field label="Reason" required value={reason} onChangeText={setReason} multiline />
        <Button title="Confirm reject" variant="danger" disabled={!reason.trim()} onPress={() => act(rejecting.id, 'reject', { reason })} />
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ entry form
interface Line { itemId: string; unitId: string; qty: string; rate: string }
const blank = (): Line => ({ itemId: '', unitId: '', qty: '', rate: '' });

/** Purchase entry: supplier, items with quantity / unit / rate, payment (cash, part payment or credit with a due date), invoice photo. */
export function PurchaseForm({ fixedLocationId, onSaved }: { fixedLocationId?: string; onSaved: (warnings: any[]) => void }) {
  const branches = useBranches();
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [boot, setBoot] = useState<any>(null);
  const [supplierId, setSupplierId] = useState('');
  const [refNo, setRefNo] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [other, setOther] = useState('');
  const [discount, setDiscount] = useState('');
  const [mode, setMode] = useState<(typeof MODES)[number]>('CASH');
  const [paid, setPaid] = useState('');
  const [due, setDue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get(`/sync/bootstrap${locationId ? `?locationId=${locationId}` : ''}`).then(setBoot).catch(() => undefined); }, [locationId]);
  const items: any[] = (boot?.items ?? []).filter((i: any) => i.status === 'ACTIVE');
  const units: any[] = boot?.units ?? [];
  const suppliers: any[] = boot?.suppliers ?? [];
  const unitsFor = (itemId: string) => { const it = items.find((i) => i.id === itemId); return it ? [it.purchaseUnitId, it.baseUnitId].filter(Boolean).map((id: string) => units.find((u) => u.id === id)).filter(Boolean) : []; };

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const subtotal = lines.reduce((a, l) => a.plus(dec(l.qty || '0').mul(dec(l.rate || '0'))), dec(0));
  const total = subtotal.plus(dec(other || '0')).minus(dec(discount || '0'));
  const effectivePaid = mode === 'CREDIT' ? dec(0) : paid !== '' ? dec(paid) : total;
  const credit = total.minus(effectivePaid);
  const valid = lines.filter((l) => l.itemId && l.unitId && dec(l.qty || '0').greaterThan(0) && l.rate !== '');
  const anyPartial = lines.some((l) => (l.itemId || l.qty || l.rate) && !(l.itemId && l.unitId && dec(l.qty || '0').greaterThan(0) && l.rate !== ''));
  const ready = !!locationId && !!supplierId && valid.length > 0 && !anyPartial && total.greaterThanOrEqualTo(0) && !effectivePaid.greaterThan(total) && (credit.lessThanOrEqualTo(0) || !!due);

  async function save() {
    setBusy(true); setError(null);
    try {
      const attachmentKeys = photo ? [await uploadAttachment(photo.uri, photo.name, locationId)] : undefined;
      const res = await api.full.post('/purchases', {
        locationId, businessDate: todayIST(), supplierId, supplierRefNo: refNo.trim() || undefined,
        items: valid.map((l) => ({ itemId: l.itemId, unitId: l.unitId, quantity: dec(l.qty).toString(), rate: dec(l.rate).toString() })),
        otherCharges: other ? amt(other) : undefined, discount: discount ? amt(discount) : undefined,
        paymentMode: mode, paidAmount: mode === 'CREDIT' ? undefined : effectivePaid.toFixed(2), dueDate: credit.greaterThan(0) ? due : undefined, remarks: remarks.trim() || undefined, attachmentKeys, clientUuid: uuid(),
      });
      onSaved(res.warnings ?? []);
    } catch (e) { setError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save'); setBusy(false); }
  }

  return (
    <>
      {!fixedLocationId ? <SelectField label="Branch" required value={locationId} onChange={setLocationId} options={branches.map((b) => ({ value: b.id, label: b.name }))} /> : null}
      <SelectField label="Supplier" required value={supplierId} onChange={setSupplierId} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
      <Field label="Invoice no." value={refNo} onChangeText={setRefNo} maxLength={40} />
      {lines.map((l, i) => (
        <Card key={i} style={{ gap: 8, padding: 12 }}>
          <SelectField label={`Item ${i + 1}`} value={l.itemId} onChange={(v) => set(i, { itemId: v, unitId: unitsFor(v)[0]?.id ?? '' })} options={items.map((it) => ({ value: it.id, label: it.nameEn }))} />
          {l.itemId ? <Chips value={l.unitId} onChange={(v) => set(i, { unitId: v })} options={unitsFor(l.itemId).map((u: any) => ({ value: u.id, label: u.code }))} /> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Quantity" value={l.qty} keyboardType="decimal-pad" onChangeText={(v) => set(i, { qty: cleanQty(v) })} /></View>
            <View style={{ flex: 1 }}><MoneyField label="Rate" value={l.rate} onChange={(v) => set(i, { rate: cleanAmount(v, 4) })} /></View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Muted small>Line total {formatINR(dec(l.qty || '0').mul(dec(l.rate || '0')).toDecimalPlaces(2))}</Muted>
            {lines.length > 1 ? <Button small variant="secondary" title="Remove" onPress={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} /> : null}
          </View>
        </Card>
      ))}
      <Button small variant="secondary" title="+ Add item" onPress={() => setLines((ls) => [...ls, blank()])} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><MoneyField label="Other charges" value={other} onChange={setOther} /></View>
        <View style={{ flex: 1 }}><MoneyField label="Discount" value={discount} onChange={setDiscount} /></View>
      </View>
      <Card tone="neutral"><Heading title={`Total ${formatINR(total)}`} /></Card>
      <Chips label="Payment" value={mode} onChange={(m) => { setMode(m); setPaid(''); }} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
      {mode !== 'CREDIT' ? <MoneyField label="Paid now (blank = full)" value={paid} onChange={setPaid} /> : null}
      {credit.greaterThan(0) ? <Field label={`On credit ${formatINR(credit)} — due date (YYYY-MM-DD)`} required value={due} onChangeText={setDue} placeholder="2026-11-15" /> : null}
      <Field label="Remarks" value={remarks} onChangeText={setRemarks} multiline />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Button small variant="secondary" icon="camera" title="Invoice photo" onPress={async () => { try { const p = await pickPhoto('camera'); if (p) setPhoto(p); } catch (e) { setError(e instanceof Error ? e.message : 'Photo failed'); } }} />
        {photo ? <Image source={{ uri: photo.uri }} style={{ width: 48, height: 48, borderRadius: 10 }} /> : null}
      </View>
      <ErrorBox error={error} />
      <Button title="Save purchase" onPress={save} loading={busy} disabled={!ready} />
    </>
  );
}

// ------------------------------------------------------------------ suppliers
/** Suppliers with what is owed to each; open one for its ledger and to record a payment. */
export function SuppliersPanel() {
  const th = useTheme();
  const { can } = useSession();
  const branches = useBranches();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<any | null>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [paying, setPaying] = useState(false);
  const [pay, setPay] = useState({ locationId: '', amount: '', mode: 'CASH', ref: '' });
  const [payError, setPayError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sup, setSup] = useState({ name: '', contact: '', phone: '', terms: '', opening: '' });
  const [supError, setSupError] = useState<string | null>(null);

  const load = useCallback(async () => { try { setRows(await api.get('/suppliers')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function openSupplier(s: any) {
    setOpen(s); setLedger(null);
    if (!can('supplier:pay')) return;
    try { setLedger(await api.get(`/suppliers/${s.id}/ledger`)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the ledger'); }
  }
  async function pays() {
    setBusy(true); setPayError(null);
    try {
      await api.post(`/suppliers/${open.id}/payments`, { locationId: pay.locationId, amount: amt(pay.amount), paymentMode: pay.mode, referenceNo: pay.ref.trim() || undefined });
      setPaying(false); setPay({ locationId: '', amount: '', mode: 'CASH', ref: '' }); await load(); setLedger(await api.get(`/suppliers/${open.id}/ledger`));
    } catch (e) { setPayError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }
  async function addSupplier() {
    setBusy(true); setSupError(null);
    try {
      await api.post('/suppliers', { name: sup.name.trim(), contactPerson: sup.contact.trim() || undefined, phone: sup.phone.trim() || undefined, paymentTermsDays: sup.terms ? Number(sup.terms) : undefined, openingBalance: sup.opening ? amt(sup.opening) : undefined });
      setAdding(false); setSup({ name: '', contact: '', phone: '', terms: '', opening: '' }); await load();
    } catch (e) { setSupError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }

  return (
    <>
      {can('supplier:manage') ? <Button small icon="plus" title="Add supplier" onPress={() => { setSupError(null); setAdding(true); }} /> : null}
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No suppliers yet.</Muted> : rows.map((s) => (
        <ListRow
          key={s.id} title={s.name} tone={s.overdue ? 'bad' : undefined}
          lines={[`${s.code}${s.phone ? ` · ${s.phone}` : ''}`, `Purchased ${money(s.totalPurchases)} · paid ${money(s.totalPaid)}`, s.nextDue ? `Next due ${prettyDate(String(s.nextDue).slice(0, 10))}` : null]}
          right={<><Text style={{ color: dec(s.outstanding).greaterThan(0) ? th.warn.text : th.ink, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{money(s.outstanding)}</Text><Muted small>owed</Muted>{s.overdue ? <Chip text="Overdue" tone="bad" /> : null}</>}
          onPress={() => openSupplier(s)}
        />
      ))}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? 'Supplier'}>
        {open ? (
          <>
            <Muted>{open.code} · terms {open.paymentTermsDays ?? 0} days{open.phone ? ` · ${open.phone}` : ''}</Muted>
            <Card tone={dec(open.outstanding).greaterThan(0) ? 'warn' : undefined}><Text style={{ color: th.ink, fontSize: 24, fontWeight: '800' }}>{money(open.outstanding)}</Text><Muted>outstanding</Muted></Card>
            {can('supplier:pay') ? <Button title="Record payment" onPress={() => { setPayError(null); setPaying(true); }} /> : null}
            {ledger ? (
              <>
                <SectionTitle>Ledger</SectionTitle>
                {(ledger.entries as any[]).length === 0 ? <Muted>No entries.</Muted> : (ledger.entries as any[]).slice(-40).reverse().map((e) => (
                  <View key={e.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: th.ink }}>{String(e.entryType).replace(/_/g, ' ')}</Text>
                      <Text style={{ color: th.muted, fontSize: 12 }}>{prettyDate(String(e.entryDate).slice(0, 10))}{e.narration ? ` · ${e.narration}` : ''}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: dec(e.credit).greaterThan(0) ? th.ok.text : th.ink, fontVariant: ['tabular-nums'] }}>{dec(e.credit).greaterThan(0) ? `− ${formatINR(e.credit)}` : `+ ${formatINR(e.debit)}`}</Text>
                      <Text style={{ color: th.faint, fontSize: 11 }}>bal {money(e.balance)}</Text>
                    </View>
                  </View>
                ))}
              </>
            ) : can('supplier:pay') ? <Loading /> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet open={paying} onClose={() => setPaying(false)} title={`Pay ${open?.name ?? ''}`}>
        <SelectField label="Paid from branch" required value={pay.locationId} onChange={(v) => setPay({ ...pay, locationId: v })} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        <MoneyField label="Amount" required value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} />
        <Chips label="Paid by" value={pay.mode} onChange={(v) => setPay({ ...pay, mode: v })} options={['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'].map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
        <Field label="Reference no." value={pay.ref} onChangeText={(v) => setPay({ ...pay, ref: v })} maxLength={40} />
        <Muted small>The oldest dues are settled first.</Muted>
        <ErrorBox error={payError} />
        <Button title="Save payment" loading={busy} disabled={!pay.locationId || !dec(pay.amount || '0').greaterThan(0)} onPress={pays} />
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add supplier">
        <Field label="Name" required value={sup.name} onChangeText={(v) => setSup({ ...sup, name: v })} maxLength={100} />
        <Field label="Contact person" value={sup.contact} onChangeText={(v) => setSup({ ...sup, contact: v })} />
        <Field label="Phone" value={sup.phone} keyboardType="phone-pad" onChangeText={(v) => setSup({ ...sup, phone: v.replace(/[^\d+ -]/g, '') })} />
        <Field label="Payment terms (days)" value={sup.terms} keyboardType="number-pad" onChangeText={(v) => setSup({ ...sup, terms: v.replace(/\D/g, '').slice(0, 3) })} />
        <MoneyField label="Opening balance (owed before the app)" value={sup.opening} onChange={(v) => setSup({ ...sup, opening: v })} />
        <ErrorBox error={supError} />
        <Button title="Save" loading={busy} disabled={!sup.name.trim()} onPress={addSupplier} />
      </Sheet>
    </>
  );
}
