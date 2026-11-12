import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';
import { Banner, Button, Card, ErrorBox, Field, Heading, Loading, Screen, SegTabs, Sheet } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { tAlert } from '@/lib/i18n';
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
  const [requests, setRequests] = useState<any[] | null>(null);
  const [deciding, setDeciding] = useState<{ r: any; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  // tick boxes + bulk actions (a separate selection per tab)
  const [pickedExp, setPickedExp] = useState<string[]>([]);
  const [pickedCl, setPickedCl] = useState<string[]>([]);
  const [bulk, setBulk] = useState<'approve' | 'reject' | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const params = useLocalSearchParams<{ tab?: string; reject?: string }>();
  const [tab, setTab] = useState<'expenses' | 'closing' | 'backdate'>('expenses');
  const [rows, setRows] = useState<any[] | null>(null);
  const [closings, setClosings] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ex, cl, bd] = await Promise.all([api.get<any[]>('/expenses?status=SUBMITTED&pageSize=100'), api.get<any[]>('/closings/awaiting').catch(() => [] as any[]), api.get<any[]>('/backdate-requests?status=PENDING').catch(() => [] as any[])]);
      setRows(ex); setClosings(cl); setRequests(bd); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // opened from a notification: show the Closing tab, or the reject box of one expense
  useEffect(() => { if (params.tab === 'closing' || params.tab === 'backdate') setTab(params.tab); }, [params.tab]);
  useEffect(() => {
    if (!params.reject || !rows) return;
    const e = rows.find((x) => x.id === params.reject);
    if (e) { setTab('expenses'); setReason(''); setRejecting(e); }
    router.setParams({ reject: undefined });
  }, [params.reject, rows]);

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

  return (
    <Screen onRefresh={load}>
      <Heading onBlue title={tab === 'expenses' ? 'Approvals · Expenses' : tab === 'closing' ? 'Approvals · Closing' : 'Approvals · Date requests'} />
      <SegTabs
        value={tab} onChange={setTab}
        tabs={[{ key: 'expenses', label: `Expenses${rows?.length ? ` (${rows.length})` : ''}` }, { key: 'closing', label: `Closing${closings?.length ? ` (${closings.length})` : ''}` }, { key: 'backdate', label: `Date requests${requests?.length ? ` (${requests.length})` : ''}` }]}
      />
      <ErrorBox error={error} />
      {ids.length > 0 ? (
        <Card style={{ gap: 10 }}>
          <Pressable onPress={() => setPicked(allPicked ? [] : ids)} accessibilityRole="checkbox" accessibilityState={{ checked: allPicked }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
            <Feather name={allPicked ? 'check-square' : picked.length ? 'minus-square' : 'square'} size={24} color={picked.length ? th.brand : th.faint} />
            <Text style={{ color: th.ink, fontWeight: '700', flex: 1 }}>Select all</Text>
            <Text style={{ color: th.muted, fontVariant: ['tabular-nums'] }}>{picked.length} / {ids.length} selected</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title={`✓ ${allPicked ? 'Approve all' : 'Approve selected'}${picked.length ? ` (${picked.length})` : ''}`} style={{ flex: 1 }} disabled={picked.length === 0 || busy !== null} onPress={() => setBulk('approve')} />
            <Button title={`✕ ${allPicked ? 'Reject all' : 'Reject selected'}${picked.length ? ` (${picked.length})` : ''}`} variant="danger" style={{ flex: 1 }} disabled={picked.length === 0 || busy !== null} onPress={() => { setBulkReason(''); setBulk('reject'); }} />
          </View>
        </Card>
      ) : null}
      {tab === 'backdate' ? (
        !requests ? <Loading /> : requests.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : requests.map((r) => (
          <Card key={r.id} style={{ gap: 6 }}>
            <Text style={{ color: th.ink, fontWeight: '700' }}>{r.locationName} · {prettyDate(String(r.businessDate).slice(0, 10))}</Text>
            <Text style={{ color: th.muted, fontSize: 13 }}>{r.requestedByName} ({r.requestedByUsername}) · ⏱ {age(r.createdAt)}</Text>
            <Text style={{ color: th.ink }}>“{r.reason}”</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button title="✓ Approve" style={{ flex: 1 }} disabled={busy !== null} onPress={() => { setNote(''); setDeciding({ r, approve: true }); }} />
              <Button title="✕ Reject" variant="danger" style={{ flex: 1 }} disabled={busy !== null} onPress={() => { setNote(''); setDeciding({ r, approve: false }); }} />
            </View>
          </Card>
        ))
      ) : tab === 'closing' ? (
        !closings ? <Loading /> : closings.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : closings.map((c) => (
          <Card key={c.closingId} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              {tick(c.closingId)}
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            {tick(e.id)}
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
