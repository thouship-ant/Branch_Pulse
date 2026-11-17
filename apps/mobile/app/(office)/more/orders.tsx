import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/Text';
import { Banner, Button, HeaderButton, Chip, Chips, ErrorBox, Field, ListRow, Loading, MoneyField, Muted, Screen, SegTabs, SelectField, Sheet } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';

const TYPES = [{ value: 'BUSINESS_MEETING', label: 'Business meeting' }, { value: 'FUNCTION', label: 'Function' }, { value: 'PARTY', label: 'Party' }, { value: 'CORPORATE', label: 'Corporate' }, { value: 'OTHER', label: 'Other' }];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label])) as Record<string, string>;
const MODES = [{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }, { value: 'BANK_TRANSFER', label: 'Bank' }, { value: 'CHEQUE', label: 'Cheque' }];
const PAY: Record<string, { text: string; tone: 'bad' | 'warn' | 'ok'; icon: string }> = {
  UNPAID: { text: 'Not paid', tone: 'bad', icon: '○' }, PARTIAL: { text: 'Partly paid', tone: 'warn', icon: '◐' }, PAID: { text: 'Paid', tone: 'ok', icon: '●' },
};
const STATUS: Record<string, string> = { PLANNED: 'Upcoming', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };
const money = (v: unknown) => formatINR(String(v ?? 0), { decimals: false });
type Tab = 'ALL' | 'PLANNED' | 'DELIVERED' | 'CANCELLED';

const blank = () => ({ locationId: '', customerName: '', customerPhone: '', eventType: 'FUNCTION', eventDate: todayIST(), eventTime: '', venue: '', itemsSummary: '', peopleCount: '', amount: '', advance: '', advanceMode: 'CASH', notes: '' });

/** Outside-shop orders (meetings, functions, parties) with their payment status. */
export default function OrdersScreen() {
  const th = useTheme();
  const { can } = useSession();
  const branches = useBranches();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ALL');
  const [pay, setPay] = useState('');
  const [branch, setBranch] = useState('');
  const [adding, setAdding] = useState<ReturnType<typeof blank> | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<any | null>(null);
  const [payment, setPayment] = useState({ amount: '', mode: 'CASH', reference: '' });
  const manage = can('order:manage');

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (tab !== 'ALL') qs.set('status', tab);
      if (pay) qs.set('paymentStatus', pay);
      if (branch) qs.set('locationId', branch);
      setRows(await api.get(`/orders?${qs}`)); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [tab, pay, branch]);
  useEffect(() => { void load(); }, [load]);

  const live = (rows ?? []).filter((r) => r.status !== 'CANCELLED');
  const value = live.reduce((a, r) => a + Number(r.amount), 0);
  const received = live.reduce((a, r) => a + Number(r.paidAmount), 0);

  async function create() {
    if (!adding) return;
    setBusy(true); setFormError(null);
    try {
      await api.post('/orders', {
        locationId: adding.locationId || branches[0]?.id, customerName: adding.customerName.trim(), customerPhone: adding.customerPhone, eventType: adding.eventType, eventDate: adding.eventDate,
        eventTime: adding.eventTime || undefined, venue: adding.venue || undefined, itemsSummary: adding.itemsSummary || undefined, peopleCount: adding.peopleCount ? Number(adding.peopleCount) : undefined,
        amount: dec(adding.amount).toFixed(2), advance: adding.advance ? dec(adding.advance).toFixed(2) : undefined, advanceMode: adding.advance ? adding.advanceMode : undefined, notes: adding.notes || undefined,
      });
      setAdding(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save'); }
    finally { setBusy(false); }
  }
  async function openOrder(id: string) {
    try { setOpen(await api.get(`/orders/${id}`)); setPayment({ amount: '', mode: 'CASH', reference: '' }); setFormError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }
  async function addPayment() {
    if (!open) return;
    setBusy(true); setFormError(null);
    try { await api.post(`/orders/${open.id}/payments`, { amount: dec(payment.amount).toFixed(2), mode: payment.mode, reference: payment.reference || undefined }); await openOrder(open.id); await load(); }
    catch (e) { setFormError(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  }
  async function setStatus(status: string) {
    if (!open) return;
    setBusy(true);
    try { await api.patch(`/orders/${open.id}`, { status }); await openOrder(open.id); await load(); } catch (e) { setFormError(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  }

  return (
    <Screen title="Orders" onRefresh={load} headerRight={manage ? <HeaderButton icon="plus" title="New" onPress={() => { setFormError(null); setAdding({ ...blank(), locationId: branches[0]?.id ?? '' }); }} /> : undefined} top={<SegTabs value={tab} onChange={setTab} tabs={[{ key: 'ALL', label: 'All' }, { key: 'PLANNED', label: 'Upcoming' }, { key: 'DELIVERED', label: 'Delivered' }, { key: 'CANCELLED', label: 'Cancelled' }]} />}>
      <Muted>Meetings, functions and other outside-shop orders</Muted>
      <Chips label="Payment" value={pay as any} onChange={(v) => setPay(pay === v ? '' : v)} options={[{ value: 'UNPAID', label: 'Not paid' }, { value: 'PARTIAL', label: 'Partly paid' }, { value: 'PAID', label: 'Paid' }]} />
      <SelectField label="Branch" value={branch} onChange={setBranch} options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      <ErrorBox error={error} />
      {rows && rows.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {[['Order value', money(value)], ['Received', money(received)], ['Outstanding', money(value - received)]].map(([k, v]) => (
            <View key={k} style={{ flex: 1 }}><Text style={{ color: th.muted, fontSize: 12 }}>{k}</Text><Text style={{ color: k === 'Outstanding' && value - received > 0 ? th.bad.text : th.ink, fontWeight: '800', fontSize: 16, fontVariant: ['tabular-nums'] }}>{v}</Text></View>
          ))}
        </View>
      ) : null}
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No orders found.</Muted> : rows.map((o) => (
        <ListRow
          key={o.id} title={o.customerName} onPress={() => void openOrder(o.id)}
          lines={[`${TYPE_LABEL[o.eventType] ?? o.eventType} · ${prettyDate(String(o.eventDate).slice(0, 10))}${o.eventTime ? ` · ${o.eventTime}` : ''}`, o.venue, `${o.code} · ${o.locationName ?? ''}`]}
          right={<><Text style={{ color: th.ink, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{money(o.amount)}</Text><Chip text={PAY[o.paymentStatus].text} tone={PAY[o.paymentStatus].tone} icon={PAY[o.paymentStatus].icon} />{Number(o.balance) > 0 && o.status !== 'CANCELLED' ? <Text style={{ color: th.bad.text, fontSize: 12 }}>Balance {money(o.balance)}</Text> : null}</>}
        />
      ))}

      <Sheet open={!!adding} onClose={() => setAdding(null)} title="New order">
        {adding ? (
          <>
            <Field label="Customer" required value={adding.customerName} onChangeText={(v) => setAdding({ ...adding, customerName: v })} maxLength={100} />
            <Field label="Phone" required value={adding.customerPhone} onChangeText={(v) => setAdding({ ...adding, customerPhone: v.replace(/\D/g, '').slice(0, 10) })} keyboardType="number-pad" />
            <Chips label="Event type" value={adding.eventType as any} onChange={(v) => setAdding({ ...adding, eventType: v })} options={TYPES} />
            <Chips label="Event date" value={adding.eventDate as any} onChange={(v) => setAdding({ ...adding, eventDate: v })} options={[0, 1, 2, 7].map((d) => ({ value: addDays(todayIST(), d), label: d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d === 2 ? 'In 2 days' : 'In a week' }))} />
            <Field label="Date (YYYY-MM-DD)" value={adding.eventDate} onChangeText={(v) => setAdding({ ...adding, eventDate: v })} />
            <Field label="Time (HH:MM)" value={adding.eventTime} onChangeText={(v) => setAdding({ ...adding, eventTime: v })} />
            <Field label="People" value={adding.peopleCount} onChangeText={(v) => setAdding({ ...adding, peopleCount: v.replace(/\D/g, '').slice(0, 6) })} keyboardType="number-pad" />
            <Field label="Venue / address" value={adding.venue} onChangeText={(v) => setAdding({ ...adding, venue: v })} />
            <Field label="What is ordered" value={adding.itemsSummary} onChangeText={(v) => setAdding({ ...adding, itemsSummary: v })} multiline />
            <SelectField label="Handled by branch" value={adding.locationId} onChange={(v) => setAdding({ ...adding, locationId: v })} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            <MoneyField label="Order amount" required value={adding.amount} onChange={(v) => setAdding({ ...adding, amount: v })} />
            <MoneyField label="Advance paid" value={adding.advance} onChange={(v) => setAdding({ ...adding, advance: v })} />
            {adding.advance ? <Chips label="Advance paid by" value={adding.advanceMode as any} onChange={(v) => setAdding({ ...adding, advanceMode: v })} options={MODES} /> : null}
            <ErrorBox error={formError} />
            <Button title="Save order" onPress={create} loading={busy} disabled={!adding.customerName.trim() || adding.customerPhone.length !== 10 || !dec(adding.amount || '0').greaterThan(0)} />
          </>
        ) : null}
      </Sheet>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.customerName ?? ''}>
        {open ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Chip text={PAY[open.paymentStatus].text} tone={PAY[open.paymentStatus].tone} icon={PAY[open.paymentStatus].icon} />
              <Chip text={STATUS[open.status]} tone="neutral" />
            </View>
            <Muted>{open.code} · {TYPE_LABEL[open.eventType]} · {prettyDate(String(open.eventDate).slice(0, 10))}{open.eventTime ? ` · ${open.eventTime}` : ''}</Muted>
            <Muted>{open.locationName}{open.customerPhone ? ` · ${open.customerPhone}` : ''}</Muted>
            {open.venue ? <Muted>{open.venue}{open.peopleCount ? ` · ${open.peopleCount} people` : ''}</Muted> : null}
            {open.itemsSummary ? <Text style={{ color: th.ink }}>{open.itemsSummary}</Text> : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {[['Amount', money(open.amount), th.ink], ['Paid', money(open.paidAmount), th.ok.text], ['Balance', money(open.balance), Number(open.balance) > 0 ? th.bad.text : th.ink]].map(([k, v, c]) => (
                <View key={k as string}><Text style={{ color: th.muted, fontSize: 12 }}>{k}</Text><Text style={{ color: c as string, fontWeight: '800', fontSize: 17, fontVariant: ['tabular-nums'] }}>{v}</Text></View>
              ))}
            </View>
            <Text style={{ color: th.ink, fontWeight: '700' }}>Payments</Text>
            {open.payments.length === 0 ? <Muted>No payment yet</Muted> : open.payments.map((p: any) => (
              <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: th.muted }}>{prettyDate(String(p.paidOn).slice(0, 10))} · {p.mode}{p.reference ? ` · ${p.reference}` : ''}</Text>
                <Text style={{ color: th.ink, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{money(p.amount)}</Text>
              </View>
            ))}
            {manage && open.status !== 'CANCELLED' && Number(open.balance) > 0 ? (
              <>
                <Text style={{ color: th.ink, fontWeight: '700' }}>Add payment</Text>
                <MoneyField label="Amount" value={payment.amount} onChange={(v) => setPayment({ ...payment, amount: v })} hint={`Balance ${money(open.balance)}`} />
                <Chips label="Paid by" value={payment.mode as any} onChange={(v) => setPayment({ ...payment, mode: v })} options={MODES} />
                <Field label="Reference (optional)" value={payment.reference} onChangeText={(v) => setPayment({ ...payment, reference: v })} />
                <Button title="Add payment" onPress={addPayment} loading={busy} disabled={!dec(payment.amount || '0').greaterThan(0)} />
              </>
            ) : null}
            <ErrorBox error={formError} />
            {manage && open.status === 'PLANNED' ? (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Button title="Cancel order" variant="secondary" style={{ flex: 1 }} onPress={() => void setStatus('CANCELLED')} disabled={busy} />
                <Button title="✓ Mark delivered" style={{ flex: 1 }} onPress={() => void setStatus('DELIVERED')} disabled={busy} />
              </View>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
