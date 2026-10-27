import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, Text, TextInput, View } from 'react-native';
import { addDays, prettyDate } from '@/lib/dates';
import { api, ApiError, uploadAttachment, type Warning } from '@/lib/api';
import { MOVEMENT_LABEL, REASON_LABEL } from '@/lib/labels';
import { amt, cleanAmount, dec, formatINR, sumDec } from '@/lib/money';
import { pickPhoto, type Photo } from '@/lib/photo';
import { useTheme } from '@/lib/theme';
import { Banner, Button, Card, Chip, Chips, ErrorBox, Field, H3, Loading, Muted, MoneyField, Row, Sheet, Warnings } from './ui';

const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];
const MAX_PHOTOS = 3;
const MANUAL = ['OTHER_RECEIPT', 'WITHDRAWAL', 'DEPOSIT_TO_BANK', 'ADJUSTMENT'];

/** Surplus / shortage presentation: colour + icon + word. */
function tone(v: ReturnType<typeof dec>): { key: 'ok' | 'warn' | 'bad'; icon: string; text: string } {
  if (v.isZero()) return { key: 'ok', icon: '✓', text: 'Tallied' };
  return v.isNegative() ? { key: 'bad', icon: '▼', text: 'Shortage' } : { key: 'warn', icon: '▲', text: 'Surplus' };
}

/**
 * The branch manager's daily cash reconciliation: expected cash from the day's movements, the counted cash, the
 * difference, and - when there is one - the reason, explanation, optional photos and "send for approval".
 */
export function CashRecon({ locationId, date, onContinue }: { locationId: string; date: string; onContinue?: () => void }) {
  const th = useTheme();
  const [cash, setCash] = useState<any>(null);
  const [closing, setClosing] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [override, setOverride] = useState('');
  const [reason, setReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [c, s, m, h] = await Promise.all([
        api.get(`/cash/reconciliation/${locationId}/${date}`),
        api.get(`/closings/${locationId}/${date}`),
        api.get(`/cash/transactions?locationId=${locationId}&date=${date}`),
        api.get(`/cash/variance-report?locationId=${locationId}&from=${addDays(date, -29)}&to=${date}`),
      ]);
      setCash(c); setClosing(s.closing); setMoves(m); setHistory(h.rows);
      // a typed total is saved with an empty note count ({}), so only a non-empty note count means the notes were used
      if (c.denominations && Object.keys(c.denominations).length) setCounts(Object.fromEntries(Object.entries(c.denominations as Record<string, number>).map(([k, v]) => [k, String(v)])));
      else if (c.actualClosing != null) setOverride(String(c.actualClosing));
      if (c.varianceReason) setReason(c.varianceReason);
      if (c.managerExplanation) setExplanation(c.managerExplanation);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId, date]);
  useEffect(() => { void load(); }, [load]);

  const denomTotal = sumDec(DENOMS.map((d) => dec(counts[d] || 0).mul(d)));
  const hasCount = override !== '' || !denomTotal.isZero();
  const actual = override !== '' ? dec(override) : denomTotal;
  const variance = actual.minus(dec(cash?.expectedClosing));
  const tallied = variance.isZero();
  const vt = tone(variance);
  const closingStatus = closing?.status ?? 'PENDING';
  const locked = closingStatus === 'SUBMITTED' || closingStatus === 'APPROVED' || !!cash?.isLocked;
  const explained = tallied || (reason !== '' && explanation.trim().length >= 10);
  const approval = cash?.varianceApproval as string | null;
  const savedHasVariance = cash?.variance != null && !dec(cash.variance).isZero();
  const photoCount = (cash?.photos?.length ?? 0) + photos.length;

  const payload = (extra: Record<string, unknown> = {}) => ({
    actualClosing: actual.toFixed(2),
    denominations: Object.fromEntries(Object.entries(counts).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])),
    varianceReason: tallied ? undefined : reason || undefined, managerExplanation: tallied ? undefined : explanation || undefined,
    version: cash?.version ?? undefined, ...extra,
  });

  /** Save the count as a draft (photos are uploaded first and attached to it). */
  async function save(): Promise<boolean> {
    setBusy(true); setError(null); setNotice(null); setWarnings([]);
    try {
      const keys: string[] = [];
      for (const p of photos) keys.push(await uploadAttachment(p.uri, p.name, locationId));
      const res = await api.full.put(`/cash/reconciliation/${locationId}/${date}`, payload(keys.length ? { attachmentKeys: keys } : {}));
      setWarnings(res.warnings ?? []);
      setPhotos([]);
      setNotice(tallied ? 'Saved' : 'Saved as draft');
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      return false;
    } finally { setBusy(false); }
  }

  async function saveAndContinue() {
    if (locked || (await save())) onContinue?.();
  }

  /** Save, then send the difference for approval (the server checks the reason and explanation). */
  async function send() {
    if (!(await save())) return;
    setBusy(true); setError(null);
    try { await api.post(`/cash/reconciliation/${locationId}/${date}/submit`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send'); }
    finally { setBusy(false); }
  }

  async function cancelMove(id: string) {
    setBusy(true); setError(null);
    try { await api.post(`/cash/transactions/${id}/cancel`, {}); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not cancel'); }
    finally { setBusy(false); }
  }

  async function addPhoto(source: 'camera' | 'library') {
    if (photoCount >= MAX_PHOTOS) return;
    try { const p = await pickPhoto(source); if (p) setPhotos((x) => [...x, p]); } catch (e) { Alert.alert('Photo', e instanceof Error ? e.message : 'Could not add the photo'); }
  }

  if (!cash || !closing) return error ? <ErrorBox error={error} /> : <Loading />;
  const live = moves.filter((m) => m.status === 'ACTIVE');

  return (
    <View style={{ gap: 16 }}>
      {closingStatus === 'REJECTED' && closing.reviewComment ? <Banner tone="bad">✕ Review comment: {closing.reviewComment}</Banner> : null}
      {locked ? <Banner tone="warn">{closingStatus === 'APPROVED' ? '✓ Approved' : '◔ Submitted'} — the count is locked</Banner> : null}

      {/* workings: opening + cash sales + other receipts - expenses - withdrawals = expected */}
      <Card style={{ gap: 6 }}>
        <Row label="Opening cash" value={formatINR(cash.openingCash)} />
        <Row label="+ Cash sales" value={formatINR(cash.cashSales)} />
        {!dec(cash.otherReceipts).isZero() && <Row label="+ Other receipts" value={formatINR(cash.otherReceipts)} />}
        <Row label="− Expenses" value={formatINR(cash.cashExpenses)} />
        {!dec(cash.cashPurchases).isZero() && <Row label="− Purchases" value={formatINR(cash.cashPurchases)} />}
        {!dec(cash.otherCashOut).isZero() && <Row label="− Supplier advances" value={formatINR(cash.otherCashOut)} />}
        {!dec(cash.withdrawals).isZero() && <Row label="− Withdrawals" value={formatINR(cash.withdrawals)} />}
        <View style={{ borderTopWidth: 1, borderTopColor: th.border, paddingTop: 8, marginTop: 4 }}>
          <Row label="Expected cash" value={formatINR(cash.expectedClosing, { decimals: false })} bold />
        </View>
      </Card>

      {/* movements that feed the workings */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <H3>Cash movements</H3>
          <Button small variant="secondary" title="+ Add" disabled={locked} onPress={() => setAdding(true)} />
        </View>
        {live.length === 0 ? <Muted>—</Muted> : live.map((m) => (
          <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: th.ink, fontWeight: '500' }}>{MOVEMENT_LABEL[m.txnType] ?? m.txnType}</Text>
              {m.description ? <Text numberOfLines={1} style={{ color: th.muted, fontSize: 12 }}>{m.description}</Text> : null}
            </View>
            <Text style={{ color: m.direction < 0 ? th.ink : th.ok.text, fontWeight: m.direction < 0 ? '400' : '600', fontVariant: ['tabular-nums'] }}>{m.direction < 0 ? '−' : '+'} {formatINR(m.amount)}</Text>
            {!locked && !m.sourceType && MANUAL.includes(m.txnType) && (
              <Pressable disabled={busy} onPress={() => cancelMove(m.id)} accessibilityLabel="Cancel entry" style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: th.border, borderRadius: 10 }}>
                <Text style={{ color: th.muted }}>✕</Text>
              </Pressable>
            )}
          </View>
        ))}
      </Card>

      {/* the count */}
      <Card>
        <H3>Cash count</H3>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {DENOMS.map((d) => (
            <View key={d} style={{ width: '30.5%' }}>
              <Text style={{ color: th.muted, fontSize: 13, fontWeight: '600', marginBottom: 4 }}>₹{d}</Text>
              <TextInput
                keyboardType="number-pad" placeholder="0" placeholderTextColor={th.faint} editable={!locked}
                value={counts[d] ?? ''} onChangeText={(v) => { setOverride(''); setCounts((c) => ({ ...c, [d]: v.replace(/\D/g, '').slice(0, 5) })); }}
                style={{ minHeight: 48, borderWidth: 1, borderColor: th.border, borderRadius: 12, backgroundColor: th.fieldBg, color: th.ink, fontSize: 18, textAlign: 'center' }}
              />
            </View>
          ))}
        </View>
        <MoneyField label="Or type the total" value={override} onChange={(v) => setOverride(cleanAmount(v))} disabled={locked} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: th.neutral.bg, borderRadius: 12, padding: 12 }}>
          <Text style={{ color: th.ink, fontWeight: '600' }}>Actual cash</Text>
          <Text style={{ color: th.ink, fontWeight: '700', fontSize: 18, fontVariant: ['tabular-nums'] }}>{hasCount ? formatINR(actual) : '—'}</Text>
        </View>
      </Card>

      {/* surplus / shortage */}
      {hasCount && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 16, borderWidth: 1, backgroundColor: th[vt.key].bg, borderColor: th[vt.key].border }}>
          <Text style={{ color: th[vt.key].text, fontWeight: '600' }}>{vt.icon} {vt.text}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: th[vt.key].text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatINR(variance.abs())}</Text>
            {savedHasVariance && approval ? <Chip text={approval === 'APPROVED' ? 'Approved' : approval === 'REJECTED' ? 'Rejected' : 'Sent'} tone={approval === 'APPROVED' ? 'ok' : approval === 'REJECTED' ? 'bad' : 'warn'} /> : null}
          </View>
        </View>
      )}

      {/* a difference needs a reason, an explanation and (optionally) a photo, then approval */}
      {hasCount && !tallied && (
        <Card>
          <Chips label="Reason *" value={reason} onChange={setReason} options={Object.keys(REASON_LABEL).map((v) => ({ value: v, label: REASON_LABEL[v] }))} />
          <Field label="Explanation *" value={explanation} onChangeText={setExplanation} editable={!locked} multiline error={explanation.length > 0 && explanation.trim().length < 10 ? 'Write at least 10 characters' : null} />
          <View style={{ gap: 8 }}>
            <Text style={{ color: th.muted, fontSize: 13, fontWeight: '600' }}>Photo (optional) · up to {MAX_PHOTOS}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              {(cash.photos as any[]).map((p, i) => <Chip key={p.id} text={`Photo ${i + 1} saved`} tone="sky" icon="🖼" />)}
              {photos.map((p) => <Image key={p.uri} source={{ uri: p.uri }} style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: th.border }} />)}
              {photoCount < MAX_PHOTOS && !locked && (
                <>
                  <Button small variant="secondary" icon="camera" title="Camera" onPress={() => addPhoto('camera')} />
                  <Button small variant="secondary" icon="image" title="Gallery" onPress={() => addPhoto('library')} />
                </>
              )}
            </View>
          </View>
          {approval === 'SUBMITTED' && <Banner tone="warn">◔ Sent for approval</Banner>}
          {approval === 'APPROVED' && <Banner tone="ok">✓ Approved by {cash.approvedBy ?? '—'}</Banner>}
        </Card>
      )}

      <Warnings items={warnings} />
      <ErrorBox error={error} />
      {notice ? <Banner tone="ok">✓ {notice}</Banner> : null}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button title="Save" variant="secondary" style={{ flex: 1 }} loading={busy} disabled={locked || !hasCount} onPress={save} />
        {!tallied && hasCount && (
          <Button title="Send for approval" style={{ flex: 1 }} disabled={busy || locked || !explained || approval === 'SUBMITTED' || approval === 'APPROVED'} onPress={send} />
        )}
      </View>
      {onContinue && <Button title="Continue →" onPress={saveAndContinue} loading={busy} disabled={!locked && !hasCount} />}

      {/* recent differences for this branch */}
      <Card>
        <H3>Recent differences</H3>
        {history.length === 0 ? <Muted>No differences in the last 30 days.</Muted> : history.slice(0, 8).map((h) => {
          const neg = dec(h.variance).isNegative();
          return (
            <View key={h.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: th.ink }}>{prettyDate(h.businessDate)}</Text>
                {h.reason ? <Text style={{ color: th.muted, fontSize: 12 }}>{REASON_LABEL[h.reason] ?? h.reason}</Text> : null}
              </View>
              <Text style={{ color: neg ? th.bad.text : th.ink, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{neg ? '▼ ' : '▲ '}{formatINR(dec(h.variance).abs())}</Text>
            </View>
          );
        })}
      </Card>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add cash movement">
        <MoveForm locationId={locationId} date={date} onSaved={() => { setAdding(false); void load(); }} />
      </Sheet>
    </View>
  );
}

function MoveForm({ locationId, date, onSaved }: { locationId: string; date: string; onSaved: () => void }) {
  const [type, setType] = useState<'OTHER_RECEIPT' | 'WITHDRAWAL' | 'DEPOSIT_TO_BANK'>('OTHER_RECEIPT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.post('/cash/transactions', { locationId, businessDate: date, type, amount: amt(amount), description: note || undefined });
      onSaved();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }

  return (
    <View style={{ gap: 16 }}>
      <Chips
        label="Type" value={type} onChange={setType}
        options={[{ value: 'OTHER_RECEIPT', label: '+ Other receipt' }, { value: 'WITHDRAWAL', label: '− Withdrawal' }, { value: 'DEPOSIT_TO_BANK', label: '− Deposit to bank' }]}
      />
      <MoneyField label="Amount" value={amount} onChange={setAmount} required />
      <Field label="Note" value={note} onChangeText={setNote} />
      <ErrorBox error={error} />
      <Button title="Save" onPress={save} loading={busy} disabled={!amount || dec(amount).isZero()} />
    </View>
  );
}
