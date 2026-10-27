import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Button, Card, ErrorBox, Field, Heading, Loading, MoneyField, Screen, Warnings } from '@/components/ui';
import { api, ApiError, type Warning } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { amt, dec, formatINR, sumDec } from '@/lib/money';
import { useBranch } from '@/lib/session';
import { useTheme } from '@/lib/theme';

interface Form { total: string; cash: string; upi: string; card: string; credit: string; comp: string; other: string; remarks: string }
const EMPTY: Form = { total: '', cash: '', upi: '', card: '', credit: '', comp: '', other: '', remarks: '' };

export default function SalesScreen() {
  const th = useTheme();
  const { branch, locationId } = useBranch();
  const date = todayIST();
  const [form, setForm] = useState<Form>(EMPTY);
  const [version, setVersion] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const s = await api.get(`/daily-sales?locationId=${locationId}&date=${date}`);
      if (s) {
        setVersion(s.version);
        setForm({
          total: s.totalSales, cash: s.cashSales, upi: s.upiSales, card: s.cardSales, credit: s.creditSales,
          comp: s.complimentaryAmount, other: s.otherAdjustments, remarks: s.remarks ?? '',
        });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
  }, [locationId, date]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const set = (k: keyof Form) => (v: string) => { setSaved(false); setForm((f) => ({ ...f, [k]: v })); };
  const diff = dec(form.total).minus(sumDec([form.cash, form.upi, form.card, form.credit, form.other]));
  const matches = diff.isZero();

  async function save() {
    setBusy(true); setError(null); setWarnings([]);
    try {
      const body = {
        totalSales: amt(form.total) ?? '0.00', cashSales: amt(form.cash), upiSales: amt(form.upi), cardSales: amt(form.card),
        creditSales: amt(form.credit), complimentaryAmount: amt(form.comp), otherAdjustments: amt(form.other),
        remarks: form.remarks || undefined, version,
      };
      const res = await api.full.put(`/daily-sales?locationId=${locationId}&date=${date}`, body);
      setWarnings(res.warnings ?? []);
      setSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'Someone else changed these sales. Pull down to reload, then try again.' : e instanceof Error ? e.message : 'Could not save');
    } finally { setBusy(false); }
  }

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen onRefresh={load}>
      <Heading sub={prettyDate(date)} title="Sales" />
      <Card>
        <MoneyField label="Total sales" value={form.total} onChange={set('total')} required />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><MoneyField label="Cash" value={form.cash} onChange={set('cash')} /></View>
          <View style={{ flex: 1 }}><MoneyField label="UPI" value={form.upi} onChange={set('upi')} /></View>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {branch?.cardEnabled !== false && <View style={{ flex: 1 }}><MoneyField label="Card" value={form.card} onChange={set('card')} /></View>}
          <View style={{ flex: 1 }}><MoneyField label="Credit" value={form.credit} onChange={set('credit')} /></View>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><MoneyField label="Complimentary" value={form.comp} onChange={set('comp')} /></View>
          <View style={{ flex: 1 }}><MoneyField label="Other adjustment" value={form.other} onChange={set('other')} /></View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderRadius: 16, borderWidth: 1, backgroundColor: matches ? th.ok.bg : th.warn.bg, borderColor: matches ? th.ok.border : th.warn.border }}>
          <Text style={{ fontWeight: '600', color: matches ? th.ok.text : th.warn.text }}>Difference</Text>
          <Text style={{ fontWeight: '600', color: matches ? th.ok.text : th.warn.text, fontVariant: ['tabular-nums'] }}>{matches ? '✓' : '⚠'} {formatINR(diff)}</Text>
        </View>

        <Field label={`Remarks${matches ? '' : ' *'}`} value={form.remarks} onChangeText={set('remarks')} multiline />
      </Card>

      <Warnings items={warnings} />
      <ErrorBox error={error} />
      {saved && <Banner tone="ok">✓ Saved</Banner>}
      <Button title="Save" onPress={save} loading={busy} disabled={!form.total} />
    </Screen>
  );
}
