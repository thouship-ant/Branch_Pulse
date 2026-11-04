import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/Text';
import { Banner, Button, Card, ErrorBox, Field, Heading, Loading, Screen, SegTabs, Sheet } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { MODE_LABEL } from '@/lib/labels';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

function age(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? '<1h' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Expenses waiting for approval. */
export default function ApprovalsScreen() {
  const th = useTheme();
  const { me } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<'expenses' | 'closing'>('expenses');
  const [rows, setRows] = useState<any[] | null>(null);
  const [closings, setClosings] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ex, cl] = await Promise.all([api.get<any[]>('/expenses?status=SUBMITTED&pageSize=100'), api.get<any[]>('/closings/awaiting').catch(() => [] as any[])]);
      setRows(ex); setClosings(cl); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const branch = (id: string) => me?.locations.find((l) => l.id === id)?.name ?? '';

  async function approve(id: string) {
    setBusy(id); setError(null);
    try { await api.post(`/expenses/${id}/approve`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  async function approveClosing(id: string) {
    setBusy(id); setError(null);
    try { await api.post(`/closings/${id}/approve`, {}); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id); setError(null);
    try {
      if (rejecting.closingId) await api.post(`/closings/${rejecting.closingId}/reject`, { comment: reason });
      else await api.post(`/expenses/${rejecting.id}/reject`, { reason }); setRejecting(null); setReason(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  return (
    <Screen onRefresh={load}>
      <Heading onBlue title={tab === 'expenses' ? 'Approvals · Expenses' : 'Approvals · Closing'} />
      <SegTabs
        value={tab} onChange={setTab}
        tabs={[{ key: 'expenses', label: `Expenses${rows?.length ? ` (${rows.length})` : ''}` }, { key: 'closing', label: `Closing${closings?.length ? ` (${closings.length})` : ''}` }]}
      />
      <ErrorBox error={error} />
      {tab === 'closing' ? (
        !closings ? <Loading /> : closings.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : closings.map((c) => (
          <Card key={c.closingId} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: th.ink, fontWeight: '700', flex: 1 }}>{c.locationName}</Text>
              <Text style={{ color: th.ink, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{c.totalSales != null ? formatINR(c.totalSales) : '—'}</Text>
            </View>
            <Text style={{ color: th.muted, fontSize: 13 }}>
              {prettyDate(String(c.businessDate).slice(0, 10))}{c.cashVariance != null && Number(c.cashVariance) !== 0 ? ` · Difference ${formatINR(c.cashVariance)}` : ''}{c.submittedAt ? ` · ⏱ ${age(c.submittedAt)}` : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="View" variant="secondary" style={{ flex: 0.8 }} onPress={() => router.push(`/more/closing/${c.locationId}/${String(c.businessDate).slice(0, 10)}` as any)} />
              <Button title="✓ Approve" style={{ flex: 1.2 }} loading={busy === c.closingId} disabled={busy !== null} onPress={() => approveClosing(c.closingId)} />
              <Button title="✕ Reject" variant="danger" style={{ flex: 1 }} disabled={busy !== null} onPress={() => { setReason(''); setRejecting({ ...c, id: c.closingId, code: `${c.locationCode} ${String(c.businessDate).slice(0, 10)}` }); }} />
            </View>
          </Card>
        ))
      ) : !rows ? <Loading /> : rows.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : rows.map((e) => (
        <Card key={e.id} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: th.ink, fontWeight: '700', flex: 1 }}>{e.categoryName}</Text>
            <Text style={{ color: th.ink, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatINR(e.amount)}</Text>
          </View>
          <Text style={{ color: th.muted, fontSize: 13 }}>
            {branch(e.locationId)} · {prettyDate(e.businessDate)} · {MODE_LABEL[e.paymentMode] ?? e.paymentMode}{e.payeeName ? ` · ${e.payeeName}` : ''}
          </Text>
          <Text style={{ color: th.faint, fontSize: 12 }}>{e.code} · ⏱ {age(e.createdAt)}{e.enteredByName ? ` · ${e.enteredByName}` : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button title="✓ Approve" style={{ flex: 1 }} loading={busy === e.id} disabled={busy !== null} onPress={() => approve(e.id)} />
            <Button title="✕ Reject" variant="danger" style={{ flex: 1 }} disabled={busy !== null} onPress={() => setRejecting(e)} />
          </View>
        </Card>
      ))}

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject · ${rejecting?.code ?? ''}`}>
        <Field label="Reason" required value={reason} onChangeText={setReason} multiline />
        <Button title="Confirm reject" variant="danger" onPress={reject} loading={busy !== null} disabled={!reason.trim()} />
      </Sheet>
    </Screen>
  );
}
