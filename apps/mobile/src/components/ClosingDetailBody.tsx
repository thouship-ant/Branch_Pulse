import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/Text';
import { Banner, Button, Card, ErrorBox, Field, H3, Heading, Loading, Muted, Row, Sheet, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate, prettyTime } from '@/lib/dates';
import { REASON_LABEL } from '@/lib/labels';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useIsTeaShop, useTheme } from '@/lib/theme';

type Action = 'approve' | 'reject' | 'reopen';

/**
 * One branch's closing for one day: sales and cash summary, history, approve / reject / reopen.
 * Returns the page body and a reload function, so the same content serves the closing page and the pop-up on the Approvals page.
 * `onDecided` runs after an approve / reject / reopen went through; `onLeave` runs just before it navigates elsewhere.
 */
export function useClosingDetail(locationId: string, date: string, opts: { onDecided?: () => void; onLeave?: () => void } = {}) {
  const th = useTheme();
  const router = useRouter();
  const { can, me } = useSession();
  const [screen, setScreen] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.get(`/closings/${locationId}/${date}`);
      setScreen(s);
      setEvents(await api.get(`/closings/${s.closing.id}/events`));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId, date]);
  useEffect(() => { setScreen(null); void load(); }, [load]);

  async function run() {
    if (!action) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/closings/${screen.closing.id}/${action}`, { comment: comment || undefined });
      setAction(null); setComment('');
      await load();
      opts.onDecided?.();
    } catch (e) {
      setAction(null);
      setError(e instanceof ApiError ? `${e.message}${e.code === 'CLOSING_HAS_PENDING_ITEMS' ? ' (clear the pending items under Approvals first)' : ''}` : 'Failed');
    } finally { setBusy(false); }
  }

  if (!screen) return { load, body: error ? <ErrorBox error={error} /> : <Loading page /> };
  const c = screen.closing;
  const cash = screen.cash;
  const locName = me?.locations.find((l) => l.id === locationId)?.name ?? 'Branch';
  const needComment = action === 'reject' || action === 'reopen';
  const pend = screen.pending.expenses + screen.pending.purchases + screen.pending.wastage;

  const body = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading sub={prettyDate(String(date))} title={locName} />
        <StatusPill status={c.status} />
      </View>
      <ErrorBox error={error} />

      <Card style={{ gap: 6 }}>
        <H3>Sales</H3>
        <Row label="Total sales" value={formatINR(screen.sales?.totalSales)} bold />
        <Row label="Cash" value={formatINR(screen.sales?.cashSales)} />
        <Row label="UPI" value={formatINR(screen.sales?.upiSales)} />
        <Row label="Card" value={formatINR(screen.sales?.cardSales)} />
        <Row label={`Expenses (${screen.totals.expenseCount})`} value={formatINR(screen.totals.totalExpenses)} />
        <Row label={`Purchases (${screen.totals.purchaseCount})`} value={formatINR(screen.totals.totalPurchases)} />
        <Row label="Wastage" value={formatINR(screen.totals.totalWastageValue)} />
      </Card>

      <Card style={{ gap: 6 }}>
        <H3>Cash</H3>
        <Row label="Opening cash" value={formatINR(cash?.openingCash)} />
        <Row label="Expected cash" value={formatINR(cash?.expectedClosing)} />
        <Row label="Actual cash" value={formatINR(cash?.actualClosing)} />
        <Row label={`Variance · ${cash?.varianceLabel ?? ''}`} value={formatINR(cash?.variance)} bold />
        {cash?.varianceReason ? <Muted>Reason: {REASON_LABEL[cash.varianceReason] ?? cash.varianceReason}</Muted> : null}
        {cash?.managerExplanation ? <Muted>“{cash.managerExplanation}”</Muted> : null}
        {cash?.varianceApproval ? <Muted small>Variance: {cash.varianceApproval}</Muted> : null}
      </Card>

      {c.remarks || c.stockNotes ? (
        <Card>
          {c.remarks ? <Text style={{ color: th.ink }}><Text style={{ fontWeight: '700' }}>Remarks: </Text>{c.remarks}</Text> : null}
          {c.stockNotes ? <Text style={{ color: th.ink }}><Text style={{ fontWeight: '700' }}>Stock notes: </Text>{c.stockNotes}</Text> : null}
        </Card>
      ) : null}

      {pend > 0 ? <Banner tone="warn">⚠ {screen.pending.expenses} expenses · {screen.pending.purchases} purchases · {screen.pending.wastage} wastage waiting for approval</Banner> : null}

      {c.status === 'SUBMITTED' && can('closing:approve') ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button variant="approve" title="✓ Approve" style={{ flex: 1 }} onPress={() => setAction('approve')} />
          <Button title="✕ Reject" variant="reject" style={{ flex: 1 }} onPress={() => setAction('reject')} />
        </View>
      ) : null}
      {c.status === 'APPROVED' && can('closing:reopen') ? <Button title="↺ Reopen" variant="secondary" onPress={() => setAction('reopen')} /> : null}
      {can('cash:view') ? <Button title="Open cash reconciliation →" variant="secondary" onPress={() => { opts.onLeave?.(); router.push(`/more/cash-detail/${locationId}/${date}` as any); }} /> : null}

      <Card>
        <H3>History</H3>
        {events.length === 0 ? <Muted>—</Muted> : events.map((e) => (
          <Text key={e.id} style={{ color: th.ink, fontSize: 14 }}>
            <Text style={{ color: th.muted }}>{prettyTime(e.createdAt)}  </Text>{e.fromStatus ?? '—'} → <Text style={{ fontWeight: '700' }}>{e.toStatus}</Text>{e.comment ? <Text style={{ color: th.muted }}>  “{e.comment}”</Text> : null}
          </Text>
        ))}
      </Card>

      <Sheet open={!!action} onClose={() => setAction(null)} title={action ? action[0].toUpperCase() + action.slice(1) : ''}>
        <Field label={`Comment${needComment ? ' *' : ''}`} value={comment} onChangeText={setComment} multiline />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setAction(null)} />
          <Button title="Confirm" variant={action === 'approve' ? 'primary' : action === 'reject' ? 'danger' : 'secondary'} style={{ flex: 1 }} loading={busy} disabled={needComment && !comment.trim()} onPress={run} />
        </View>
      </Sheet>
    </>
  );
  return { load, body };
}

/** One closing opened as a pop-up over any page (same content as the closing page), with a close button; mount it only while open. */
export function ClosingModal({ view, onClose, onDecided }: { view: { locationId: string; date: string }; onClose: () => void; onDecided?: () => void }) {
  const teaShop = useIsTeaShop();
  const { body } = useClosingDetail(view.locationId, view.date, { onDecided, onLeave: onClose });
  return <Sheet open onClose={onClose} title="Closing" tall themed={teaShop}>{body}</Sheet>;
}
