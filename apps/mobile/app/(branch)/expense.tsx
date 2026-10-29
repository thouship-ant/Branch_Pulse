import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, View } from 'react-native';
import { tAlert } from '@/lib/i18n';
import { Text } from '@/components/Text';
import { Banner, Button, Card, Chips, ErrorBox, Field, H3, Heading, Loading, Muted, MoneyField, Screen, Warnings } from '@/components/ui';
import { api, ApiError, uploadAttachment, type Warning } from '@/lib/api';
import { prettyDate, todayIST, uuid } from '@/lib/dates';
import { MODE_LABEL, STATUS_LABEL } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { pickPhoto, type Photo } from '@/lib/photo';
import { useBranch } from '@/lib/session';
import { useTheme } from '@/lib/theme';

interface Category { id: string; nameEn: string; requiresReceiptAbove?: string | null; requiresSupplier?: boolean; parentId?: string | null }
interface Supplier { id: string; code: string; name: string }
interface Bootstrap { categories: Category[]; suppliers?: Supplier[]; rules: { receiptAbove: number } }

const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'] as const;

export default function ExpenseScreen() {
  const th = useTheme();
  const { locationId } = useBranch();
  const date = todayIST();
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [list, setList] = useState<any[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [subId, setSubId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<(typeof MODES)[number]>('CASH');
  const [payee, setPayee] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [b, rows] = await Promise.all([
        api.get(`/sync/bootstrap?locationId=${locationId}`),
        api.get(`/expenses?locationId=${locationId}&from=${date}&to=${date}&pageSize=100`),
      ]);
      setBoot(b); setList(rows); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId, date]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const category = boot?.categories.find((c) => c.id === categoryId);
  const receiptAbove = dec(category?.requiresReceiptAbove ?? boot?.rules.receiptAbove ?? 500);
  const needsReceipt = amount !== '' && dec(amount).greaterThan(receiptAbove);
  const missingReceipt = needsReceipt && !photo;
  const needsSupplier = !!category?.requiresSupplier;
  const missingSupplier = needsSupplier && !supplierId;
  const canSave = !!categoryId && !!amount && !dec(amount).isZero() && !missingReceipt && !missingSupplier;

  async function attach(source: 'camera' | 'library') {
    try { const p = await pickPhoto(source); if (p) setPhoto(p); } catch (e) { tAlert('Photo', e instanceof Error ? e.message : 'Could not add the photo'); }
  }

  async function save(another: boolean) {
    setBusy(true); setError(null); setInfo(null); setWarnings([]);
    try {
      const attachmentKeys = photo ? [await uploadAttachment(photo.uri, photo.name, locationId)] : undefined;
      const res = await api.post<any>('/expenses', {
        locationId, businessDate: date, categoryId, subCategoryId: subId || undefined, amount: dec(amount).toFixed(2), paymentMode: mode,
        supplierId: supplierId || undefined, payeeName: payee || undefined, description: note || undefined, attachmentKeys, clientUuid: uuid(),
      });
      void res;
      setInfo('✓ Saved');
      setAmount(''); setPayee(''); setNote(''); setPhoto(null); setSupplierId('');
      if (!another) { setCategoryId(''); setSubId(''); }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the expense');
    } finally { setBusy(false); }
  }

  if (!boot) return <Screen onRefresh={load}>{error ? <ErrorBox error={error} /> : <Loading />}</Screen>;
  const top = boot.categories.filter((c) => !c.parentId);
  const subs = boot.categories.filter((c) => c.parentId === categoryId);

  return (
    <Screen onRefresh={load}>
      <Heading sub={prettyDate(date)} title="Expense" />

      <Card>
        <Chips label="Category" value={categoryId} onChange={(v) => { setCategoryId(v); setSubId(''); setSupplierId(''); }} options={top.map((c) => ({ value: c.id, label: c.nameEn }))} />
        {subs.length > 0 && <Chips label="Sub-category" value={subId} onChange={setSubId} options={subs.map((c) => ({ value: c.id, label: c.nameEn }))} />}
        <MoneyField label="Amount" value={amount} onChange={setAmount} required />
        <Chips label="Payment mode" value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
        {needsSupplier && (boot.suppliers?.length ?? 0) > 0 && (
          <Chips label="Supplier (required for this category)" value={supplierId} onChange={setSupplierId} options={boot.suppliers!.map((s) => ({ value: s.id, label: s.name }))} />
        )}
        <Field label="Paid to" value={payee} onChangeText={setPayee} />
        <Field label="Description" value={note} onChangeText={setNote} />

        <View style={{ gap: 8 }}>
          <Text style={{ color: th.muted, fontSize: 13, fontWeight: '600' }}>Receipt photo{needsReceipt ? <Text style={{ color: th.bad.text }}> * required above {formatINR(receiptAbove, { decimals: false })}</Text> : null}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button small variant="secondary" icon="camera" title="Camera" onPress={() => attach('camera')} />
            <Button small variant="secondary" icon="image" title="Gallery" onPress={() => attach('library')} />
            {photo && <Image source={{ uri: photo.uri }} style={{ width: 52, height: 52, borderRadius: 12, borderWidth: 1, borderColor: th.border }} accessibilityLabel="Receipt preview" />}
          </View>
        </View>
      </Card>

      <Warnings items={warnings} />
      <ErrorBox error={error} />
      {info && <Banner tone="ok">{info}</Banner>}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button title="Save & add another" variant="secondary" style={{ flex: 1 }} disabled={busy || !canSave} onPress={() => save(true)} />
        <Button title="Save" style={{ flex: 1 }} loading={busy} disabled={!canSave} onPress={() => save(false)} />
      </View>

      <View style={{ gap: 8 }}>
        <H3>Today's expenses</H3>
        {list.length === 0 && <Muted>Nothing recorded yet.</Muted>}
        {list.map((e) => (
          <Card key={e.id} style={{ gap: 4, padding: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: th.ink, fontWeight: '600' }}>{e.categoryName}{e.subCategoryName ? <Text style={{ color: th.muted, fontWeight: '400' }}> › {e.subCategoryName}</Text> : null}</Text>
                <Text style={{ color: th.muted, fontSize: 12 }}>{e.code}{e.receiptCount > 0 ? ' · 🧾' : ''}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: th.ink, fontVariant: ['tabular-nums'] }}>{formatINR(e.amount)}</Text>
                <Text style={{ color: th.muted, fontSize: 12 }}>{STATUS_LABEL[e.status !== 'ACTIVE' ? e.status : e.approvalStatus] ?? e.approvalStatus}</Text>
              </View>
            </View>
            {(e.supplierName || e.payeeName || e.description) ? <Text numberOfLines={1} style={{ color: th.muted, fontSize: 12 }}>{[e.supplierName, e.payeeName, e.description].filter(Boolean).join(' · ')}</Text> : null}
            {e.approvalStatus === 'REJECTED' && e.rejectionReason ? <Text style={{ color: th.bad.text, fontSize: 12 }}>{e.rejectionReason}</Text> : null}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
