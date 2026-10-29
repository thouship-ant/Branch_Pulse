import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Text } from '@/components/Text';
import { Banner, Button, Card, Chip, ErrorBox, Field, H3, Heading, Loading, Muted, Row, Screen, Sheet, StatusPill } from '@/components/ui';
import { api, ApiError, API_ORIGIN } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { approvalTone, MOVEMENT_LABEL, REASON_LABEL } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** One branch's cash for one day as the Admin / Accountant sees it: workings, count, difference, explanation, decision. */
export default function CashDetail() {
  const th = useTheme();
  const { locationId, date } = useLocalSearchParams<{ locationId: string; date: string }>();
  const { me, can } = useSession();
  const [cash, setCash] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [closing, setClosing] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, m, s] = await Promise.all([
        api.get(`/cash/reconciliation/${locationId}/${date}`),
        api.get(`/cash/transactions?locationId=${locationId}&date=${date}`),
        api.get(`/closings/${locationId}/${date}`),
      ]);
      setCash(c); setMoves(m); setClosing(s.closing); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId, date]);
  useEffect(() => { void load(); }, [load]);

  async function decide(kind: 'approve' | 'reject') {
    setBusy(true); setError(null);
    try {
      await api.post(`/cash/reconciliation/${cash.id}/${kind}`, kind === 'reject' ? { comment } : {});
      setRejecting(false); setComment(''); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); setRejecting(false); }
    finally { setBusy(false); }
  }

  async function photo(id: string) {
    try { const { url } = await api.get(`/attachments/${id}/url`); await Linking.openURL(url.startsWith('/') ? `${API_ORIGIN}${url}` : url); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open the photo'); }
  }

  if (!cash || !closing) return <Screen title="Cash">{error ? <ErrorBox error={error} /> : <Loading />}</Screen>;
  const locName = me?.locations.find((l) => l.id === locationId)?.name ?? 'Branch';
  const v = cash.variance === null ? null : dec(cash.variance);
  const canDecide = cash.varianceApproval === 'SUBMITTED' && can('cash:approve');
  const denoms = cash.denominations as Record<string, number> | null;
  const denomLine = denoms ? Object.entries(denoms).filter(([, n]) => n).sort((a, b) => Number(b[0]) - Number(a[0])).map(([d, n]) => `₹${d} × ${n}`).join('   ') : '';
  const live = moves.filter((m) => m.status === 'ACTIVE');

  return (
    <Screen title="Cash" onRefresh={load}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Heading sub={prettyDate(String(date))} title={locName} />
        <View style={{ gap: 4, alignItems: 'flex-end' }}>
          {cash.varianceApproval ? <Chip text={cash.varianceApproval} tone={approvalTone(cash.varianceApproval)} /> : null}
          <StatusPill status={closing.status} />
        </View>
      </View>
      <ErrorBox error={error} />

      <Card style={{ gap: 6 }}>
        <H3>Expected cash</H3>
        <Row label="Opening cash" value={formatINR(cash.openingCash)} />
        <Row label="+ Cash sales" value={formatINR(cash.cashSales)} />
        <Row label="+ Other receipts" value={formatINR(cash.otherReceipts)} />
        <Row label="− Expenses" value={formatINR(cash.cashExpenses)} />
        {!dec(cash.cashPurchases).isZero() ? <Row label="− Purchases" value={formatINR(cash.cashPurchases)} /> : null}
        {!dec(cash.otherCashOut).isZero() ? <Row label="− Supplier advances" value={formatINR(cash.otherCashOut)} /> : null}
        <Row label="− Withdrawals" value={formatINR(cash.withdrawals)} />
        <View style={{ borderTopWidth: 1, borderTopColor: th.border, paddingTop: 8, marginTop: 4, gap: 6 }}>
          <Row label="Expected cash" value={formatINR(cash.expectedClosing, { decimals: false })} bold />
          <Row label="Actual cash" value={formatINR(cash.actualClosing)} bold />
        </View>
        {v ? (
          <Banner tone={v.isZero() ? 'ok' : v.isNegative() ? 'bad' : 'warn'}>{v.isZero() ? '✓ Tallied' : `${v.isNegative() ? '▼ Shortage' : '▲ Surplus'} ${formatINR(v.abs())}`}</Banner>
        ) : null}
      </Card>

      <Card style={{ gap: 8 }}>
        <H3>Cash movements</H3>
        {live.length === 0 ? <Muted>—</Muted> : live.map((m) => (
          <View key={m.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: th.ink }}>{MOVEMENT_LABEL[m.txnType] ?? m.txnType}</Text>
              {m.description ? <Text numberOfLines={1} style={{ color: th.muted, fontSize: 12 }}>{m.description}</Text> : null}
            </View>
            <Text style={{ color: th.ink, fontVariant: ['tabular-nums'] }}>{m.direction < 0 ? '−' : '+'} {formatINR(m.amount)}</Text>
          </View>
        ))}
        {denomLine ? <View style={{ borderTopWidth: 1, borderTopColor: th.border, paddingTop: 8 }}><Muted small>NOTE COUNT</Muted><Text style={{ color: th.ink }}>{denomLine}</Text></View> : null}
      </Card>

      {v && !v.isZero() ? (
        <Card>
          <H3>Explanation</H3>
          <Text style={{ color: th.ink }}><Text style={{ color: th.muted }}>Reason: </Text><Text style={{ fontWeight: '700' }}>{cash.varianceReason ? (REASON_LABEL[cash.varianceReason] ?? cash.varianceReason) : '—'}</Text></Text>
          <Text style={{ color: th.ink, backgroundColor: th.neutral.bg, borderRadius: 12, padding: 10 }}>{cash.managerExplanation ?? '—'}</Text>
          {(cash.photos as any[]).length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(cash.photos as any[]).map((p, i) => <Button key={p.id} small variant="secondary" icon="image" title={`Photo ${i + 1}`} onPress={() => photo(p.id)} />)}
            </View>
          ) : null}
          {cash.varianceApproval === 'APPROVED' ? <Banner tone="ok">✓ Approved by {cash.approvedBy ?? '—'}</Banner> : null}
          {closing.status === 'REJECTED' && closing.reviewComment ? <Banner tone="bad">✕ {closing.reviewComment}</Banner> : null}
          {canDecide ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button title="✓ Approve" style={{ flex: 1 }} loading={busy} onPress={() => decide('approve')} />
              <Button title="✕ Reject" variant="danger" style={{ flex: 1 }} disabled={busy} onPress={() => setRejecting(true)} />
            </View>
          ) : null}
        </Card>
      ) : null}

      <Sheet open={rejecting} onClose={() => setRejecting(false)} title="Reject">
        <Field label="Comment *" value={comment} onChangeText={setComment} multiline />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setRejecting(false)} />
          <Button title="Confirm" variant="danger" style={{ flex: 1 }} loading={busy} disabled={!comment.trim()} onPress={() => decide('reject')} />
        </View>
      </Sheet>
    </Screen>
  );
}
