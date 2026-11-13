import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { hideToast, showToast } from '@/lib/toast';
import { useTheme } from '@/lib/theme';
import { useLive } from '@/lib/live';

function age(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return h < 1 ? '<1h' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Round thumbs-up / thumbs-down button: the whole approve / reject decision in one tap. */
function Thumb({ up, onPress, disabled, label, size = 48 }: { up: boolean; onPress: () => void; disabled?: boolean; label: string; size?: number }) {
  const th = useTheme();
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({
        width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        backgroundColor: up ? '#059669' : th.bad.bg, borderWidth: up ? 0 : 2, borderColor: th.bad.border,
      })}
    >
      <Feather name={up ? 'thumbs-up' : 'thumbs-down'} size={size * 0.46} color={up ? '#fff' : th.bad.text} />
    </Pressable>
  );
}

/** Expenses waiting for approval. */
export default function ApprovalsScreen() {
  const th = useTheme();
  const { me, can } = useSession();
  // closings and missed-day requests are decided by the Admin only; others never see those tabs
  const showClosing = can('closing:approve');
  const showBackdate = can('closing:reopen');
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

  const load = useCallback(async () => {
    try {
      const [ex, cl, bd] = await Promise.all([api.get<any[]>('/expenses?status=SUBMITTED&pageSize=100'), api.get<any[]>('/closings/awaiting').catch(() => [] as any[]), api.get<any[]>('/backdate-requests?status=PENDING').catch(() => [] as any[])]);
      setRows(ex); setClosings(cl); setRequests(bd); setError(null);
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

  return (
    <Screen
      onRefresh={load}
      top={(
        <>
      <Heading onBlue title={tab === 'expenses' ? 'Approvals · Expenses' : tab === 'closing' ? 'Approvals · Closing' : 'Approvals · Date requests'} />
      <SegTabs
        value={tab} onChange={setTab}
        tabs={[{ key: 'expenses' as const, label: `Expenses${rows?.length ? ` (${rows.length})` : ''}` }, ...(showClosing ? [{ key: 'closing' as const, label: `Closing${closings?.length ? ` (${closings.length})` : ''}` }] : []), ...(showBackdate ? [{ key: 'backdate' as const, label: `Date requests${requests?.length ? ` (${requests.length})` : ''}` }] : [])]}
      />
      <ErrorBox error={error} />
      {ids.length > 0 ? (
        <Card style={{ paddingVertical: 8, paddingHorizontal: 12 }}>
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
                style={{ minWidth: 48, height: 44, paddingHorizontal: 10, borderRadius: 22, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', opacity: picked.length === 0 ? 0.45 : 1, backgroundColor: up ? '#059669' : th.bad.bg, borderWidth: up ? 0 : 2, borderColor: th.bad.border }}
              >
                <Feather name={up ? 'thumbs-up' : 'thumbs-down'} size={20} color={up ? '#fff' : th.bad.text} />
                {picked.length > 0 ? <Text style={{ color: up ? '#fff' : th.bad.text, fontWeight: '800', fontSize: 13 }}>{picked.length}</Text> : null}
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
        </>
      )}
    >
      {tab === 'backdate' ? (
        !requests ? <Loading /> : requests.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : requests.map((r) => (
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
        ))
      ) : tab === 'closing' ? (
        !closings ? <Loading /> : closings.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : closings.map((c) => (
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
              <Pressable onPress={() => router.push(`/more/closing/${c.locationId}/${String(c.businessDate).slice(0, 10)}` as any)} accessibilityRole="button" style={({ pressed }) => ({ flex: 1, height: 46, borderRadius: 14, backgroundColor: th.brandLight, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
                <Text style={{ color: th.brand, fontWeight: '800', fontSize: 15 }}>View</Text>
              </Pressable>
              <Thumb up label="Approve" disabled={busy !== null} onPress={() => approveClosing(c.closingId)} />
              <Thumb up={false} label="Reject" disabled={busy !== null} onPress={() => { setReason(''); setRejecting({ ...c, id: c.closingId, code: `${c.locationCode} ${String(c.businessDate).slice(0, 10)}` }); }} />
            </View>
          </Card>
        ))
      ) : !rows ? <Loading /> : rows.length === 0 ? <Banner tone="ok">✓ Nothing waiting for approval</Banner> : rows.map((e) => (
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
