import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { CashRecon } from '@/components/CashRecon';
import { Button, Card, Chip, ErrorBox, Field, H3, Heading, Loading, Row, Screen, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useBranch } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** Closing: step 1 the cash count, step 2 the summary, pre-checks and submit. */
export default function ClosingScreen() {
  const th = useTheme();
  const { locationId } = useBranch();
  const date = todayIST();
  const [step, setStep] = useState<1 | 2>(1);
  const [cash, setCash] = useState<any>(null);
  const [screen, setScreen] = useState<any>(null);
  const [remarks, setRemarks] = useState('');
  const [stockNotes, setStockNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Array<{ code: string; message: string }>>([]);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [c, s] = await Promise.all([api.get(`/cash/reconciliation/${locationId}/${date}`), api.get(`/closings/${locationId}/${date}`)]);
      setCash(c); setScreen(s); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId, date]);

  // reload the summary whenever the user lands on step 2 or returns to this tab (the count may have just changed)
  useFocusEffect(useCallback(() => { void load(); }, [load, step]));

  async function submitClosing() {
    setBusy(true); setError(null); setFailed([]);
    try {
      await api.post(`/closings/${screen.closing.id}/submit`, { remarks: remarks || undefined, stockNotes: stockNotes || undefined });
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CLOSING_PRECHECK_FAILED') setFailed(e.details ?? []);
      else setError(e instanceof ApiError ? e.message : 'Could not submit');
    } finally { setBusy(false); }
  }

  if (!locationId) return <Screen><Loading /></Screen>;
  const status = screen?.closing?.status ?? 'PENDING';
  const locked = status === 'SUBMITTED' || status === 'APPROVED';
  const tot = screen?.totals;

  const stepChip = (n: 1 | 2, label: string) => (
    <View style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderColor: step === n ? th.brand : th.border, backgroundColor: step === n ? th.brand : th.surface }}>
      <Text style={{ color: step === n ? th.onBrand : th.ink, fontWeight: '600', fontSize: 13 }}>{n} · {label}</Text>
    </View>
  );

  return (
    <Screen onRefresh={load}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Heading sub={prettyDate(date)} title="Closing" />
        <StatusPill status={status} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>{stepChip(1, 'Cash count')}{stepChip(2, 'Submit')}</View>

      {step === 1 && <CashRecon locationId={locationId} date={date} onContinue={() => setStep(2)} />}

      {step === 2 && (!cash || !screen ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <>
          <Card style={{ gap: 8 }}>
            <Row label="Total sales" value={formatINR(screen.sales?.totalSales)} bold />
            <Row label="Cash" value={formatINR(screen.sales?.cashSales)} />
            <Row label="UPI" value={formatINR(screen.sales?.upiSales)} />
            <Row label="Card" value={formatINR(screen.sales?.cardSales)} />
            <Row label={`Expenses (${tot.expenseCount})`} value={formatINR(tot.totalExpenses)} />
            <Row label={`Purchases (${tot.purchaseCount})`} value={formatINR(tot.totalPurchases)} />
            <Row label="Wastage" value={formatINR(tot.totalWastageValue)} />
            <Row label="Expected cash" value={formatINR(cash.expectedClosing, { decimals: false })} />
            <Row label="Actual cash" value={formatINR(cash.actualClosing)} />
            <Row label={`Variance · ${cash.varianceLabel ?? ''}`} value={formatINR(cash.variance)} bold />
          </Card>

          <Card>
            <H3>Pre-checks</H3>
            {screen.prechecks.map((p: any) => (
              <Text key={p.code} style={{ color: p.ok ? th.ok.text : th.bad.text, fontSize: 14 }}>{p.ok ? '✓' : '✕'} {p.message}</Text>
            ))}
          </Card>

          {!locked && (
            <Card>
              <Field label="Stock notes" value={stockNotes} onChangeText={setStockNotes} multiline />
              <Field label="Remarks" value={remarks} onChangeText={setRemarks} multiline />
            </Card>
          )}

          {failed.length > 0 && (
            <Card tone="bad">{failed.map((f) => <Text key={f.code} style={{ color: th.bad.text }}>✕ {f.message}</Text>)}</Card>
          )}
          <ErrorBox error={error} />
          {locked ? <Chip text={status === 'APPROVED' ? 'Approved' : 'Submitted for approval'} tone={status === 'APPROVED' ? 'ok' : 'warn'} icon={status === 'APPROVED' ? '✓' : '◔'} /> : null}
          <Button title="Submit closing" onPress={submitClosing} loading={busy} disabled={locked || !screen.canSubmit} />
          <Button title="← Cash count" variant="secondary" onPress={() => setStep(1)} />
        </>
      ))}
    </Screen>
  );
}
