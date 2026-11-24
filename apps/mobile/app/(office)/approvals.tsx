import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';
import { Banner, Button, Card, ErrorBox, Field, Heading, Loading, PageTitle, Screen, SegTabs, Sheet } from '@/components/ui';
import { ClosingModal } from '@/components/ClosingDetailBody';
import { useTeaHeaderRight } from '@/components/TeaShopHeaderActions';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { tAlert } from '@/lib/i18n';
import { MODE_LABEL } from '@/lib/labels';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { hideToast, showToast } from '@/lib/toast';
import { useIsTeaShop, useTheme } from '@/lib/theme';
import { useLive } from '@/lib/live';

// what the page showed, kept for as long as the app runs: coming back from "View closing" must find the same tab and the same cards open
const rememberedOpen = new Set<string>();
let rememberedTab: 'expenses' | 'closing' | 'backdate' = 'expenses';
function useOpen(id: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => rememberedOpen.has(id));
  const flip = () => setOpen((o) => { if (o) rememberedOpen.delete(id); else rememberedOpen.add(id); return !o; });
  return [open, flip];
}

function age(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? '<1h' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Two buttons joined into one pill: the chosen half is filled. */
function JoinedTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ key: T; label: string }> }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', borderRadius: 999, borderWidth: 1, borderColor: th.brand, overflow: 'hidden', backgroundColor: th.surface }}>
      {tabs.map((t, i) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key} onPress={() => onChange(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? th.brand : 'transparent', borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: th.brand }}
          >
            <Text style={{ color: on ? th.onBrand : th.brand, fontWeight: '800', fontSize: 14 }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One decided missed-day request: what was asked, the decision, who decided and when. */
function HistoryCard({ r }: { r: any }) {
  const th = useTheme();
  const ok = r.status === 'APPROVED';
  const tone = ok ? th.ok : th.bad;
  const when = r.decidedAt ?? r.createdAt;
  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: th.ink, fontWeight: '700' }}>{r.locationName} · {prettyDate(String(r.businessDate).slice(0, 10))}</Text>
        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: tone.bg, borderWidth: 1, borderColor: tone.border }}>
          <Text style={{ color: tone.text, fontSize: 12, fontWeight: '800' }}>{ok ? 'Approved' : 'Rejected'}</Text>
        </View>
      </View>
      <Text style={{ color: th.muted, fontSize: 13 }}>{r.requestedByName} ({r.requestedByUsername})</Text>
      <Text style={{ color: th.ink }}>“{r.reason}”</Text>
      {r.decisionNote ? <Text style={{ color: th.muted, fontSize: 13 }}>Note: {r.decisionNote}</Text> : null}
      <Text style={{ color: th.faint, fontSize: 12 }}>{ok ? 'Approved' : 'Rejected'}{r.decidedByUsername ? ` by ${r.decidedByUsername}` : ''} · {prettyDate(String(when).slice(0, 10))}</Text>
    </Card>
  );
}

/** Round thumbs-up / thumbs-down button: the whole approve / reject decision in one tap. */
function Thumb({ up, onPress, disabled, label, size = 48 }: { up: boolean; onPress: () => void; disabled?: boolean; label: string; size?: number }) {
  const th = useTheme();
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({
        width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        backgroundColor: up ? '#1f7a35' : '#c62828',
      })}
    >
      <Feather name={up ? 'thumbs-up' : 'thumbs-down'} size={size * 0.46} color="#fff" />
    </Pressable>
  );
}

const MODE_TONE: Record<string, { bg: string; fg: string }> = {
  CASH: { bg: '#d6f0d9', fg: '#2e7d4f' }, UPI: { bg: '#dce6fb', fg: '#1d4fb8' }, CARD: { bg: '#ebd9f7', fg: '#6b2a98' },
};

/** Small chevron that opens / closes the details of a card. */
function ExpandToggle({ open, onPress }: { open: boolean; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={open ? 'Hide details' : 'Show details'} accessibilityState={{ expanded: open }} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: th.dark ? th.brandLight : '#f3e6d6' }}>
      <Feather name={open ? 'chevron-up' : 'chevron-down'} size={20} color={th.dark ? th.ink : '#6a351c'} />
    </Pressable>
  );
}

/** Tea-shop look for one expense waiting for approval: icon tile, payment chip, amount, receipt warning and the two decision buttons. */
function ExpenseCardTea({ e, branchName, picked, onTick, busy, onApprove, onReject }: { e: any; branchName: string; picked: boolean; onTick: () => void; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const th = useTheme();
  const tone = MODE_TONE[String(e.paymentMode).toUpperCase()] ?? { bg: '#f3e6d6', fg: '#6a351c' };
  const noReceipt = e.receiptCount === 0 && Number(e.amount) > 500;
  const [open, flipOpen] = useOpen(e.id);
  return (
    <View style={{ borderRadius: 22, padding: 14, gap: 10, backgroundColor: th.dark ? th.surface : 'rgba(255,250,244,0.97)', borderWidth: 1, borderColor: picked ? '#a4501f' : th.border, shadowColor: '#45220f', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onPress={onTick} accessibilityRole="checkbox" accessibilityState={{ checked: picked }} hitSlop={8}>
          <Feather name={picked ? 'check-square' : 'square'} size={24} color={picked ? '#a4501f' : th.faint} />
        </Pressable>
        <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: '#fdecc4', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="script-text-outline" size={22} color="#a4501f" />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={1} style={{ color: th.ink, fontSize: 16, fontWeight: '800' }}>{e.categoryName}</Text>
          <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: tone.bg }}>
            <Text style={{ color: tone.fg, fontSize: 11, fontWeight: '800' }}>{MODE_LABEL[e.paymentMode] ?? e.paymentMode}</Text>
          </View>
        </View>
        <Text style={{ color: th.dark ? th.ink : '#54210d', fontWeight: '800', fontSize: 20, fontVariant: ['tabular-nums'] }}>{formatINR(e.amount)}</Text>
        <ExpandToggle open={open} onPress={flipOpen} />
      </View>
      {open ? <View style={{ gap: 3, paddingLeft: 2 }}>
        <Text style={{ color: th.muted, fontSize: 13 }}>{branchName} · {prettyDate(e.businessDate)}{e.payeeName ? ` · ${e.payeeName}` : ''}</Text>
        {e.description ? <Text style={{ color: th.ink, fontSize: 13, fontStyle: 'italic' }}>“{e.description}”</Text> : null}
        {noReceipt ? (
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: '#fbd9d6' }}>
            <Feather name="alert-triangle" size={12} color="#b91c1c" />
            <Text style={{ color: '#b91c1c', fontSize: 11, fontWeight: '800' }}>No receipt above ₹500</Text>
          </View>
        ) : null}
      </View> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: th.border }}>
        <Text numberOfLines={1} style={{ flex: 1, color: th.faint, fontSize: 12 }}>{e.code} · ⏱ {age(e.createdAt)}{e.receiptCount === 0 && !noReceipt ? ' · No receipt' : ''}</Text>
        <Thumb up size={42} label="Approve" disabled={busy} onPress={onApprove} />
        <Thumb up={false} size={42} label="Reject" disabled={busy} onPress={onReject} />
      </View>
    </View>
  );
}

/** One label / value line of the expanded closing card. */
function FigureRow({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      <Text style={{ color: bold ? th.ink : th.muted, fontSize: 13, fontWeight: bold ? '800' : '500' }}>{label}</Text>
      <Text style={{ color: tone ?? th.ink, fontSize: 13, fontWeight: bold ? '800' : '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

/** The important figures of a submitted closing: sales split, what went out, the cash count, and anything still pending. */
function ClosingFigures({ d }: { d: any }) {
  const th = useTheme();
  const cash = d.cash;
  const pend = (d.pending?.expenses ?? 0) + (d.pending?.purchases ?? 0) + (d.pending?.wastage ?? 0);
  const v = cash?.variance != null ? Number(cash.variance) : null;
  return (
    <>
      <FigureRow label="Cash sales" value={formatINR(d.sales?.cashSales)} />
      <FigureRow label="UPI sales" value={formatINR(d.sales?.upiSales)} />
      <FigureRow label="Card sales" value={formatINR(d.sales?.cardSales)} />
      <View style={{ height: 1, backgroundColor: th.border, marginVertical: 2 }} />
      <FigureRow label={`Expenses (${d.totals?.expenseCount ?? 0})`} value={formatINR(d.totals?.totalExpenses)} />
      <FigureRow label={`Purchases (${d.totals?.purchaseCount ?? 0})`} value={formatINR(d.totals?.totalPurchases)} />
      <FigureRow label="Wastage" value={formatINR(d.totals?.totalWastageValue)} />
      {cash ? (
        <>
          <View style={{ height: 1, backgroundColor: th.border, marginVertical: 2 }} />
          <FigureRow label="Expected cash" value={formatINR(cash.expectedClosing)} />
          <FigureRow label="Actual cash" value={formatINR(cash.actualClosing)} />
          <FigureRow bold label={`Variance${cash.varianceLabel ? ` · ${cash.varianceLabel}` : ''}`} value={formatINR(cash.variance)} tone={v && v < 0 ? '#b91c1c' : v && v > 0 ? '#a4501f' : '#2e7d4f'} />
          {cash.managerExplanation ? <Text style={{ color: th.ink, fontSize: 13, fontStyle: 'italic' }}>“{cash.managerExplanation}”</Text> : null}
        </>
      ) : null}
      {d.closing?.remarks ? <Text style={{ color: th.ink, fontSize: 13 }}><Text style={{ fontWeight: '700' }}>Remarks: </Text>{d.closing.remarks}</Text> : null}
      {pend > 0 ? (
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: '#fbd9d6' }}>
          <Feather name="alert-triangle" size={12} color="#b91c1c" />
          <Text style={{ color: '#b91c1c', fontSize: 11, fontWeight: '800' }}>{pend} item{pend === 1 ? '' : 's'} still waiting for approval</Text>
        </View>
      ) : null}
    </>
  );
}

/** Tea-shop look for one closing waiting for approval: branch tile, date and age, sales, cash difference, View + the decision buttons. */
function ClosingCardTea({ c, picked, onTick, busy, onView, onApprove, onReject }: { c: any; picked: boolean; onTick: () => void; busy: boolean; onView: () => void; onApprove: () => void; onReject: () => void }) {
  const th = useTheme();
  const diff = c.cashVariance != null && Number(c.cashVariance) !== 0 ? Number(c.cashVariance) : null;
  const [open, flipOpen] = useOpen(c.closingId);
  // the day's figures are fetched the first time the card is opened
  const [detail, setDetail] = useState<any | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || detail) return;
    let live = true;
    setFailed(false);
    api.get(`/closings/${c.locationId}/${String(c.businessDate).slice(0, 10)}`).then((d) => { if (live) setDetail(d); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, detail, c.locationId, c.businessDate]);
  return (
    <View style={{ borderRadius: 22, padding: 14, gap: 10, backgroundColor: th.dark ? th.surface : 'rgba(255,250,244,0.97)', borderWidth: 1, borderColor: picked ? '#a4501f' : th.border, shadowColor: '#45220f', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onPress={onTick} accessibilityRole="checkbox" accessibilityState={{ checked: picked }} hitSlop={8}>
          <Feather name={picked ? 'check-square' : 'square'} size={24} color={picked ? '#a4501f' : th.faint} />
        </Pressable>
        <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: '#d6f0d9', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="storefront-outline" size={22} color="#2e7d4f" />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: th.ink, fontSize: 16, fontWeight: '800' }}>{c.locationName}</Text>
          <Text numberOfLines={1} style={{ color: th.muted, fontSize: 13 }}>{prettyDate(String(c.businessDate).slice(0, 10))}{c.submittedAt ? ` · ⏱ ${age(c.submittedAt)}` : ''}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: th.muted, fontSize: 11 }}>Sales</Text>
          <Text style={{ color: th.dark ? th.ink : '#54210d', fontWeight: '800', fontSize: 20, fontVariant: ['tabular-nums'] }}>{c.totalSales != null ? formatINR(c.totalSales) : '—'}</Text>
        </View>
        <ExpandToggle open={open} onPress={flipOpen} />
      </View>
      {open ? (
        <View style={{ gap: 6, paddingTop: 2 }}>
          {failed ? <Text style={{ color: th.muted, fontSize: 13 }}>Could not load the details</Text> : !detail ? <Text style={{ color: th.muted, fontSize: 13 }}>Loading…</Text> : <ClosingFigures d={detail} />}
        </View>
      ) : null}
      {open && diff !== null ? (
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: diff < 0 ? '#fbd9d6' : '#fdecc4' }}>
          <Feather name="alert-triangle" size={12} color={diff < 0 ? '#b91c1c' : '#a4501f'} />
          <Text style={{ color: diff < 0 ? '#b91c1c' : '#a4501f', fontSize: 11, fontWeight: '800' }}>Cash difference {formatINR(c.cashVariance)}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: th.border }}>
        <Pressable onPress={onView} accessibilityRole="button" style={({ pressed }) => ({ flex: 1, height: 42, borderRadius: 999, backgroundColor: '#f3e6d6', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
          <Text style={{ color: '#6a351c', fontWeight: '800', fontSize: 14 }}>View closing</Text>
        </Pressable>
        <Thumb up size={42} label="Approve" disabled={busy} onPress={onApprove} />
        <Thumb up={false} size={42} label="Reject" disabled={busy} onPress={onReject} />
      </View>
    </View>
  );
}

/** Tea-shop look for one missed-day request: branch tile, the day asked for, who asked, their reason and the decision buttons. */
function RequestCardTea({ r, busy, onApprove, onReject }: { r: any; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const th = useTheme();
  const [open, flipOpen] = useOpen(r.id);
  return (
    <View style={{ borderRadius: 22, padding: 14, gap: 10, backgroundColor: th.dark ? th.surface : 'rgba(255,250,244,0.97)', borderWidth: 1, borderColor: th.border, shadowColor: '#45220f', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: '#dce6fb', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="calendar-clock-outline" size={22} color="#1d4fb8" />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: th.ink, fontSize: 16, fontWeight: '800' }}>{r.locationName}</Text>
          <Text numberOfLines={1} style={{ color: th.muted, fontSize: 13 }}>Missed day · {prettyDate(String(r.businessDate).slice(0, 10))}</Text>
        </View>
        <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: '#fdecc4' }}>
          <Text style={{ color: '#a4501f', fontSize: 11, fontWeight: '800' }}>⏱ {age(r.createdAt)}</Text>
        </View>
        <ExpandToggle open={open} onPress={flipOpen} />
      </View>
      {open ? <View style={{ gap: 3, paddingLeft: 2 }}>
        <Text style={{ color: th.muted, fontSize: 13 }}>Asked by {r.requestedByName} ({r.requestedByUsername})</Text>
        <Text style={{ color: th.ink, fontSize: 13, fontStyle: 'italic' }}>“{r.reason}”</Text>
      </View> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: th.border }}>
        <Thumb up size={42} label="Approve" disabled={busy} onPress={onApprove} />
        <Thumb up={false} size={42} label="Reject" disabled={busy} onPress={onReject} />
      </View>
    </View>
  );
}

/** Tea-shop look for one decided request: the result as a coloured pill, then who decided and when. */
function HistoryCardTea({ r }: { r: any }) {
  const th = useTheme();
  const ok = r.status === 'APPROVED';
  const when = r.decidedAt ?? r.createdAt;
  return (
    <View style={{ borderRadius: 22, padding: 14, gap: 8, backgroundColor: th.dark ? th.surface : 'rgba(255,250,244,0.97)', borderWidth: 1, borderColor: th.border, shadowColor: '#45220f', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: ok ? '#d6f0d9' : '#fbd9d6', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name={ok ? 'check-circle-outline' : 'close-circle-outline'} size={22} color={ok ? '#2e7d4f' : '#b91c1c'} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: th.ink, fontSize: 16, fontWeight: '800' }}>{r.locationName}</Text>
          <Text numberOfLines={1} style={{ color: th.muted, fontSize: 13 }}>Missed day · {prettyDate(String(r.businessDate).slice(0, 10))}</Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: ok ? '#d6f0d9' : '#fbd9d6' }}>
          <Text style={{ color: ok ? '#2e7d4f' : '#b91c1c', fontSize: 12, fontWeight: '800' }}>{ok ? 'Approved' : 'Rejected'}</Text>
        </View>
      </View>
      <Text style={{ color: th.muted, fontSize: 13 }}>Asked by {r.requestedByName} ({r.requestedByUsername})</Text>
      <Text style={{ color: th.ink, fontSize: 13, fontStyle: 'italic' }}>“{r.reason}”</Text>
      {r.decisionNote ? <Text style={{ color: th.muted, fontSize: 13 }}>Note: {r.decisionNote}</Text> : null}
      <Text style={{ color: th.faint, fontSize: 12 }}>{ok ? 'Approved' : 'Rejected'}{r.decidedByUsername ? ` by ${r.decidedByUsername}` : ''} · {prettyDate(String(when).slice(0, 10))}</Text>
    </View>
  );
}

/** Expenses waiting for approval. */
export default function ApprovalsScreen() {
  const th = useTheme();
  const teaShop = useIsTeaShop();
  const tea = useTeaHeaderRight();
  const { me, can } = useSession();
  // closings and missed-day requests are decided by the Admin only; others never see those tabs
  const showClosing = can('closing:approve');
  const showBackdate = can('closing:reopen');
  const router = useRouter();
  const [requests, setRequests] = useState<any[] | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [bdSub, setBdSub] = useState<'requests' | 'history'>('requests');
  const [deciding, setDeciding] = useState<{ r: any; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  // tick boxes + bulk actions (a separate selection per tab)
  const [pickedExp, setPickedExp] = useState<string[]>([]);
  const [pickedCl, setPickedCl] = useState<string[]>([]);
  const [bulk, setBulk] = useState<'approve' | 'reject' | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const params = useLocalSearchParams<{ tab?: string; reject?: string }>();
  const [tab, setTabState] = useState<'expenses' | 'closing' | 'backdate'>(rememberedTab);
  const setTab = (t: 'expenses' | 'closing' | 'backdate') => { rememberedTab = t; setTabState(t); };
  const [rowsAll, setRows] = useState<any[] | null>(null);
  const [closingsAll, setClosings] = useState<any[] | null>(null);
  // an approval waits 5 seconds so it can be undone: the row leaves the list at once, the server is told when the time is up
  const [hidden, setHidden] = useState<string[]>([]);
  const timers = useRef(new Map<string, { run: () => Promise<void>; t: ReturnType<typeof setTimeout> }>());
  const rows = rowsAll ? rowsAll.filter((e) => !hidden.includes(e.id)) : null;
  const closings = closingsAll ? closingsAll.filter((c) => !hidden.includes(c.closingId)) : null;
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ locationId: string; date: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [ex, cl, bd] = await Promise.all([api.get<any[]>('/expenses?status=SUBMITTED&pageSize=100'), api.get<any[]>('/closings/awaiting').catch(() => [] as any[]), api.get<any[]>('/backdate-requests').catch(() => [] as any[])]);
      setRows(ex); setClosings(cl); setError(null);
      setRequests(bd.filter((r) => r.status === 'PENDING'));
      setHistory(bd.filter((r) => r.status !== 'PENDING').sort((a, b) => String(b.decidedAt ?? b.createdAt).localeCompare(String(a.decidedAt ?? a.createdAt))));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useLive(load, ['EXPENSE', 'DAILY_CLOSING', 'BACKDATE_REQUEST']);

  // opened from a notification: show the Closing tab, or the reject box of one expense
  useEffect(() => { if ((params.tab === 'closing' && showClosing) || (params.tab === 'backdate' && showBackdate) || params.tab === 'expenses') setTab(params.tab as any); }, [params.tab, showClosing, showBackdate]);
  useEffect(() => {
    if (!params.reject || !rows) return;
    const e = rows.find((x) => x.id === params.reject);
    if (e) { setTab('expenses'); setReason(''); setRejecting(e); }
    router.setParams({ reject: undefined });
  }, [params.reject, rows]);

  const branch = (id: string) => me?.locations.find((l) => l.id === id)?.name ?? '';

  function queueApprove(id: string, label: string, call: () => Promise<unknown>) {
    setHidden((h) => [...h, id]);
    const run = async () => {
      timers.current.delete(id);
      try { await call(); }
      catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
      finally { setHidden((h) => h.filter((x) => x !== id)); await load(); }
    };
    const t = setTimeout(() => { void run(); }, 5000);
    timers.current.set(id, { run, t });
    showToast(`✓ Approved: ${label}`, {
      label: 'Undo',
      onPress: () => { const q = timers.current.get(id); if (q) { clearTimeout(q.t); timers.current.delete(id); } setHidden((h) => h.filter((x) => x !== id)); },
    }, 5000);
  }
  // leaving the screen must not lose an approval that is still counting down
  useEffect(() => () => { for (const q of timers.current.values()) { clearTimeout(q.t); void q.run(); } hideToast(); }, []);

  const approve = (id: string) => { const e = rowsAll?.find((x) => x.id === id); if (e) queueApprove(id, `${e.code} · ${formatINR(e.amount)}`, () => api.post(`/expenses/${id}/approve`)); };
  const approveClosing = (id: string) => { const c = closingsAll?.find((x) => x.closingId === id); if (c) queueApprove(id, `${c.locationName} · ${prettyDate(String(c.businessDate).slice(0, 10))}`, () => api.post(`/closings/${id}/approve`, {})); };

  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id); setError(null);
    try {
      if (rejecting.closingId) await api.post(`/closings/${rejecting.closingId}/reject`, { comment: reason });
      else await api.post(`/expenses/${rejecting.id}/reject`, { reason }); setRejecting(null); setReason(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  const ids = tab === 'expenses' ? (rows ?? []).map((e) => e.id as string) : tab === 'closing' ? (closings ?? []).map((c) => c.closingId as string) : [];
  const picked = (tab === 'expenses' ? pickedExp : pickedCl).filter((id) => ids.includes(id));
  const setPicked = tab === 'expenses' ? setPickedExp : setPickedCl;
  const allPicked = ids.length > 0 && picked.length === ids.length;
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  /** Runs the action on every ticked item one after the other and reports how many went through. */
  async function runBulk() {
    if (!bulk) return;
    setBusy('bulk'); setError(null);
    let ok = 0;
    const failed: string[] = [];
    for (const id of picked) {
      const label = tab === 'expenses' ? rows?.find((e) => e.id === id)?.code : closings?.find((c) => c.closingId === id)?.locationName;
      try {
        if (tab === 'expenses') await api.post(`/expenses/${id}/${bulk}`, bulk === 'reject' ? { reason: bulkReason } : undefined);
        else await api.post(`/closings/${id}/${bulk}`, bulk === 'reject' ? { comment: bulkReason } : {});
        ok++;
      } catch (e) { failed.push(`${label ?? id}: ${e instanceof Error ? e.message : 'Failed'}`); }
    }
    setBulk(null); setBulkReason(''); setPicked([]); setBusy(null);
    await load();
    tAlert(failed.length ? `${ok} done, ${failed.length} failed` : `${ok} done`, failed.length ? failed.join('\n') : undefined);
  }

  const tick = (id: string) => (
    <Pressable onPress={() => toggle(id)} accessibilityRole="checkbox" accessibilityState={{ checked: picked.includes(id) }} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -8, marginTop: -8 }}>
      <Feather name={picked.includes(id) ? 'check-square' : 'square'} size={24} color={picked.includes(id) ? th.brand : th.faint} />
    </Pressable>
  );

  const controls = (
    <>
      {teaShop ? null : <Heading onBlue title={tab === 'expenses' ? 'Approvals · Expenses' : tab === 'closing' ? 'Approvals · Closing' : 'Approvals · Date requests'} />}
      <SegTabs
        fit value={tab} onChange={setTab}
        tabs={[{ key: 'expenses' as const, label: 'Expenses', badge: rows?.length }, ...(showClosing ? [{ key: 'closing' as const, label: 'Closing', badge: closings?.length }] : []), ...(showBackdate ? [{ key: 'backdate' as const, label: 'Date requests', badge: requests?.length }] : [])]}
      />
      {tab === 'backdate' ? (
        <JoinedTabs
          value={bdSub} onChange={setBdSub}
          tabs={[{ key: 'requests', label: `Requests${requests?.length ? ` (${requests.length})` : ''}` }, { key: 'history', label: 'History' }]}
        />
      ) : null}
      <ErrorBox error={error} />
      {ids.length > 0 ? (
        <Card style={[{ paddingVertical: 8, paddingHorizontal: 12 }, teaShop ? { borderRadius: 20, backgroundColor: th.dark ? th.surface : 'rgba(255,250,244,0.96)' } : null]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable onPress={() => setPicked(allPicked ? [] : ids)} accessibilityRole="checkbox" accessibilityState={{ checked: allPicked }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }}>
              <Feather name={allPicked ? 'check-square' : picked.length ? 'minus-square' : 'square'} size={24} color={picked.length ? th.brand : th.faint} />
              <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '700' }}>Select all</Text>
            </Pressable>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: th.brandLight }}>
              <Text style={{ color: th.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}><Text style={{ fontWeight: '800', color: th.ink }}>{picked.length}</Text> / {ids.length}</Text>
            </View>
            <View style={{ flex: 1 }} />
            {([true, false] as const).map((up) => (
              <Pressable
                key={String(up)} disabled={picked.length === 0 || busy !== null} accessibilityRole="button"
                accessibilityLabel={up ? (allPicked ? 'Approve all' : 'Approve selected') : (allPicked ? 'Reject all' : 'Reject selected')}
                onPress={() => { setBulkReason(''); setBulk(up ? 'approve' : 'reject'); }}
                style={{ minWidth: 48, height: 44, paddingHorizontal: 10, borderRadius: 22, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', opacity: picked.length === 0 ? 0.45 : 1, backgroundColor: up ? (teaShop ? '#1f7a35' : '#059669') : '#c62828' }}
              >
                <Feather name={up ? 'thumbs-up' : 'thumbs-down'} size={20} color="#fff" />
                {picked.length > 0 ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{picked.length}</Text> : null}
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
    </>
  );

  const pageTitle = (
    <PageTitle
      icon="check-decagram-outline" title="Approvals"
      subtitle={tab === 'expenses' ? 'Expenses waiting for your decision' : tab === 'closing' ? 'Daily closings waiting for your decision' : 'Requests to enter a missed day'}
    />
  );

  return (
    <Screen
      hero
      headerRight={teaShop ? tea.right : undefined}
      onRefresh={load}
      list={tab === 'backdate' && bdSub === 'history' ? {
        data: history, keyExtractor: (r) => r.id, renderItem: ({ item }) => (teaShop ? <HistoryCardTea r={item} /> : <HistoryCard r={item} />),
        empty: <Banner tone="neutral">No decided requests yet</Banner>,
      } : undefined}
      top={teaShop ? undefined : controls}
    >
      {teaShop ? <>{pageTitle}{controls}</> : null}
      {tab === 'backdate' ? (
        bdSub === 'history' ? null : !requests ? <Loading /> : requests.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : requests.map((r) => (teaShop ? (
          <RequestCardTea key={r.id} r={r} busy={busy !== null} onApprove={() => { setNote(''); setDeciding({ r, approve: true }); }} onReject={() => { setNote(''); setDeciding({ r, approve: false }); }} />
        ) : (
          <Card key={r.id} style={{ gap: 6 }}>
            <Text style={{ color: th.ink, fontWeight: '700' }}>{r.locationName} · {prettyDate(String(r.businessDate).slice(0, 10))}</Text>
            <Text style={{ color: th.muted, fontSize: 13 }}>{r.requestedByName} ({r.requestedByUsername}) · ⏱ {age(r.createdAt)}</Text>
            <Text style={{ color: th.ink }}>“{r.reason}”</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }} />
              <Thumb up label="Approve" disabled={busy !== null} onPress={() => { setNote(''); setDeciding({ r, approve: true }); }} />
              <Thumb up={false} label="Reject" disabled={busy !== null} onPress={() => { setNote(''); setDeciding({ r, approve: false }); }} />
            </View>
          </Card>
        )))
      ) : tab === 'closing' ? (
        !closings ? <Loading /> : closings.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : closings.map((c) => (teaShop ? (
          <ClosingCardTea key={c.closingId} c={c} picked={picked.includes(c.closingId)} onTick={() => toggle(c.closingId)} busy={busy !== null}
            onView={() => setViewing({ locationId: c.locationId, date: String(c.businessDate).slice(0, 10) })}
            onApprove={() => approveClosing(c.closingId)}
            onReject={() => { setReason(''); setRejecting({ ...c, id: c.closingId, code: `${c.locationCode} ${String(c.businessDate).slice(0, 10)}` }); }} />
        ) : (
          <Card key={c.closingId} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              {tick(c.closingId)}
              <View style={{ flex: 1 }}>
                <Text style={{ color: th.ink, fontWeight: '700' }}>{c.locationName}</Text>
                <Text style={{ color: th.muted, fontSize: 13 }}>{prettyDate(String(c.businessDate).slice(0, 10))}{c.submittedAt ? ` · ⏱ ${age(c.submittedAt)}` : ''}</Text>
                {c.cashVariance != null && Number(c.cashVariance) !== 0 ? <Text style={{ color: th.warn.text, fontSize: 12, fontWeight: '600' }}>Difference {formatINR(c.cashVariance)}</Text> : null}
              </View>
              <View style={{ width: 104, alignItems: 'flex-end' }}>
                <Text style={{ color: th.muted, fontSize: 11 }}>Sales</Text>
                <Text style={{ color: th.ink, fontWeight: '800', fontSize: 17, fontVariant: ['tabular-nums'] }}>{c.totalSales != null ? formatINR(c.totalSales) : '—'}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Pressable onPress={() => setViewing({ locationId: c.locationId, date: String(c.businessDate).slice(0, 10) })} accessibilityRole="button" style={({ pressed }) => ({ flex: 1, height: 46, borderRadius: 14, backgroundColor: th.brandLight, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
                <Text style={{ color: th.brand, fontWeight: '800', fontSize: 15 }}>View</Text>
              </Pressable>
              <Thumb up label="Approve" disabled={busy !== null} onPress={() => approveClosing(c.closingId)} />
              <Thumb up={false} label="Reject" disabled={busy !== null} onPress={() => { setReason(''); setRejecting({ ...c, id: c.closingId, code: `${c.locationCode} ${String(c.businessDate).slice(0, 10)}` }); }} />
            </View>
          </Card>
        )))
      ) : !rows ? <Loading /> : rows.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : rows.map((e) => (teaShop ? <ExpenseCardTea key={e.id} e={e} branchName={branch(e.locationId)} picked={picked.includes(e.id)} onTick={() => toggle(e.id)} busy={busy !== null} onApprove={() => approve(e.id)} onReject={() => setRejecting(e)} /> : (
        <Card key={e.id} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            {tick(e.id)}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: th.ink, fontWeight: '700' }}>{e.categoryName}  <Text style={{ color: th.muted, fontWeight: '500', fontSize: 12 }}>{MODE_LABEL[e.paymentMode] ?? e.paymentMode}</Text></Text>
              <Text style={{ color: th.muted, fontSize: 13 }}>{branch(e.locationId)} · {prettyDate(e.businessDate)}{e.payeeName ? ` · ${e.payeeName}` : ''}</Text>
              {e.description ? <Text style={{ color: th.ink, fontSize: 13, fontWeight: '600' }}>“{e.description}”</Text> : null}
              {e.receiptCount === 0 && Number(e.amount) > 500 ? <Text style={{ color: th.bad.text, fontSize: 12, fontWeight: '700' }}>⚠ No receipt for an amount above ₹500</Text> : null}
              <Text style={{ color: th.faint, fontSize: 12 }}>{e.code} · ⏱ {age(e.createdAt)}{e.receiptCount === 0 ? ' · No receipt' : ''}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 10 }}>
              <Text style={{ color: th.ink, fontWeight: '800', fontSize: 17, fontVariant: ['tabular-nums'] }}>{formatINR(e.amount)}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Thumb up size={42} label="Approve" disabled={busy !== null} onPress={() => approve(e.id)} />
                <Thumb up={false} size={42} label="Reject" disabled={busy !== null} onPress={() => setRejecting(e)} />
              </View>
            </View>
          </View>
        </Card>
      )))}

      {viewing ? <ClosingModal view={viewing} onClose={() => setViewing(null)} onDecided={() => { setViewing(null); void load(); }} /> : null}

      <Sheet open={!!deciding} onClose={() => setDeciding(null)} title={`${deciding?.approve ? 'Approve' : 'Reject'} · ${deciding ? prettyDate(String(deciding.r.businessDate).slice(0, 10)) : ''}`}>
        <Field label={deciding?.approve ? 'Comment (optional)' : 'Reason'} required={!deciding?.approve} value={note} onChangeText={setNote} multiline />
        <Button
          title={deciding?.approve ? 'Confirm approve' : 'Confirm reject'} variant={deciding?.approve ? 'primary' : 'danger'} loading={busy === 'decide'} disabled={!deciding?.approve && !note.trim()}
          onPress={async () => {
            if (!deciding) return;
            setBusy('decide'); setError(null);
            try { await api.post(`/backdate-requests/${deciding.r.id}/${deciding.approve ? 'approve' : 'reject'}`, { note: note.trim() || undefined }); setDeciding(null); setNote(''); await load(); }
            catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(null); }
          }}
        />
      </Sheet>

      <Sheet open={!!bulk} onClose={() => setBulk(null)} title={`${bulk === 'approve' ? (allPicked ? 'Approve all' : 'Approve selected') : allPicked ? 'Reject all' : 'Reject selected'} (${picked.length})`}>
        <Text style={{ color: th.muted }}>{bulk === 'approve' ? 'Approve these items?' : 'Reject these items? One reason is saved on every item.'}</Text>
        {picked.slice(0, 8).map((id) => (
          <Text key={id} style={{ color: th.ink }}>
            {tab === 'expenses' ? (() => { const e = rows?.find((x) => x.id === id); return e ? `${e.code} · ${formatINR(e.amount)}` : id; })() : (() => { const c = closings?.find((x) => x.closingId === id); return c ? `${c.locationName} · ${prettyDate(String(c.businessDate).slice(0, 10))}` : id; })()}
          </Text>
        ))}
        {picked.length > 8 ? <Text style={{ color: th.muted }}>+ {picked.length - 8} more</Text> : null}
        {bulk === 'reject' ? <Field label="Reason" required value={bulkReason} onChangeText={setBulkReason} multiline /> : null}
        <Button title={bulk === 'reject' ? 'Confirm reject' : 'Confirm approve'} variant={bulk === 'reject' ? 'danger' : 'primary'} onPress={runBulk} loading={busy === 'bulk'} disabled={bulk === 'reject' && !bulkReason.trim()} />
      </Sheet>

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject · ${rejecting?.code ?? ''}`}>
        <Field label="Reason" required value={reason} onChangeText={setReason} multiline />
        <Button title="Confirm reject" variant="danger" onPress={reject} loading={busy !== null} disabled={!reason.trim()} />
      </Sheet>
    </Screen>
  );
}
