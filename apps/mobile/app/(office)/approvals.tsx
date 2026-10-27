import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Button, Card, ErrorBox, Field, Heading, Loading, Screen, Sheet } from '@/components/ui';
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
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get('/expenses?status=SUBMITTED&pageSize=100')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const branch = (id: string) => me?.locations.find((l) => l.id === id)?.name ?? '';

  async function approve(id: string) {
    setBusy(id); setError(null);
    try { await api.post(`/expenses/${id}/approve`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id); setError(null);
    try { await api.post(`/expenses/${rejecting.id}/reject`, { reason }); setRejecting(null); setReason(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(null); }
  }

  return (
    <Screen onRefresh={load}>
      <Heading title="Approvals · Expenses" />
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : rows.map((e) => (
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
