import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { Image, Pressable, useWindowDimensions, View } from 'react-native';
import { tAlert } from '@/lib/i18n';
import { Text } from '@/components/Text';
import { ACCENT, type AccentName, Banner, Button, Card, Chips, ErrorBox, Field, H3, Heading, Loading, Muted, MoneyField, Screen, Warnings } from '@/components/ui';
import { api, ApiError, uploadAttachment, type Warning } from '@/lib/api';
import { prettyDate, uuid } from '@/lib/dates';
import { MODE_LABEL, STATUS_LABEL } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { pickPhoto, type Photo } from '@/lib/photo';
import { useBranch } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useWorkDate } from '@/lib/workDate';
import { useLive } from '@/lib/live';

interface Category { id: string; nameEn: string; requiresReceiptAbove?: string | null; requiresSupplier?: boolean; parentId?: string | null }
interface Supplier { id: string; code: string; name: string }
interface Bootstrap { categories: Category[]; suppliers?: Supplier[]; rules: { receiptAbove: number } }

const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'] as const;

const ACCENTS: AccentName[] = ['blue', 'amber', 'purple', 'green', 'sky', 'rose'];
const CAT_ICON: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  salary: 'users', 'staff advance': 'dollar-sign', rent: 'home', electricity: 'zap', transport: 'truck', maintenance: 'tool', repairs: 'settings',
  cleaning: 'droplet', miscellaneous: 'more-horizontal', water: 'droplet', internet: 'wifi', phone: 'phone', gas: 'zap', packaging: 'package', marketing: 'send',
};
const MODE_ICON: Record<string, React.ComponentProps<typeof Feather>['name']> = { CASH: 'dollar-sign', UPI: 'smartphone', CARD: 'credit-card', BANK_TRANSFER: 'briefcase', CHEQUE: 'file-text' };

/** A section heading: coloured icon tile and title. */
function Section({ icon, accent, title }: { icon: React.ComponentProps<typeof Feather>['name']; accent: AccentName; title: string }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: ACCENT[accent].bg, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon} size={16} color={ACCENT[accent].fg} />
      </View>
      <Text style={{ color: th.ink, fontSize: 16, fontWeight: '800' }}>{title}</Text>
    </View>
  );
}

/** A grid of icon tiles to pick one option: easier to hit and to scan than a row of small chips. */
function Tiles<T extends string>({ options, value, onChange, cols = 3 }: { options: Array<{ value: T; label: string; icon: React.ComponentProps<typeof Feather>['name']; accent: AccentName }>; value: T | ''; onChange: (v: T) => void; cols?: number }) {
  const th = useTheme();
  const { width } = useWindowDimensions();
  const gap = 10;
  const cell = Math.floor((width - 32 - 32 - gap * (cols - 1)) / cols);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {options.map((o) => {
        const on = value === o.value;
        const c = ACCENT[o.accent];
        return (
          <Pressable
            key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ width: cell, minHeight: cols > 3 ? 72 : 84, borderRadius: 16, borderWidth: on ? 2 : 1, borderColor: on ? th.brand : th.border, backgroundColor: on ? th.brandLight : th.surface, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 6 }}
          >
            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={o.icon} size={18} color={c.fg} />
            </View>
            <Text numberOfLines={2} style={{ color: on ? th.brand : th.ink, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{o.label}</Text>
            {on ? <View style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: th.brand, alignItems: 'center', justifyContent: 'center' }}><Feather name="check" size={12} color="#fff" /></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ExpenseScreen() {
  const th = useTheme();
  const { locationId } = useBranch();
  const date = useWorkDate();
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
  const [bought, setBought] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!locationId) return;
    try {
      const [b, rows, buys] = await Promise.all([
        api.get(`/sync/bootstrap?locationId=${locationId}`),
        api.get(`/expenses?locationId=${locationId}&from=${date}&to=${date}&pageSize=100`),
        api.get<any[]>(`/purchases?locationId=${locationId}&from=${date}&to=${date}&pageSize=50`).catch(() => [] as any[]),
      ]);
      setBoot(b); setList(rows); setBought(buys); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId, date]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useLive(load, ['EXPENSE', 'PURCHASE']);

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
  // stock items (milk, tea powder ...) are bought through Stock > Purchase, which carries the payment
  const top = boot.categories.filter((c) => !c.parentId && !c.requiresSupplier);
  const subs = boot.categories.filter((c) => c.parentId === categoryId);

  return (
    <Screen onRefresh={load}>
      <Heading onBlue sub={prettyDate(date)} title="Expense" />

      <Card style={{ gap: 18 }}>
        <Section icon="grid" accent="blue" title="Category" />
        <Tiles
          value={categoryId} onChange={(v) => { setCategoryId(v); setSubId(''); setSupplierId(''); }}
          options={top.map((c, i) => ({ value: c.id, label: c.nameEn, icon: CAT_ICON[c.nameEn.toLowerCase()] ?? 'tag', accent: ACCENTS[i % ACCENTS.length] }))}
        />
        {subs.length > 0 && <Chips label="Sub-category" value={subId} onChange={setSubId} options={subs.map((c) => ({ value: c.id, label: c.nameEn }))} />}

        <Section icon="dollar-sign" accent="green" title="Amount" />
        <MoneyField label="How much?" value={amount} onChange={setAmount} required />

        <Section icon="credit-card" accent="purple" title="Paid by" />
        <Tiles
          value={mode} onChange={setMode} cols={4}
          options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m], icon: MODE_ICON[m] ?? 'circle', accent: 'purple' as AccentName }))}
        />
        {needsSupplier && (boot.suppliers?.length ?? 0) > 0 && (
          <Chips label="Supplier (required for this category)" value={supplierId} onChange={setSupplierId} options={boot.suppliers!.map((s) => ({ value: s.id, label: s.name }))} />
        )}

        <Section icon="file-text" accent="amber" title="Details" />
        <Field label="Paid to" value={payee} onChangeText={setPayee} placeholder="Person or shop" />
        <Field label="Description" value={note} onChangeText={setNote} placeholder="What was it for?" />

        <Section icon="camera" accent="sky" title="Receipt photo" />
        {needsReceipt ? <Text style={{ color: th.bad.text, fontSize: 13, fontWeight: '700', marginTop: -10 }}>Required above {formatINR(receiptAbove, { decimals: false })}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {([['camera', 'camera', 'Camera'], ['library', 'image', 'Gallery']] as const).map(([src, icon, label]) => (
            <Pressable key={src} onPress={() => attach(src)} accessibilityRole="button" style={{ flex: 1, minHeight: 64, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: th.brand, backgroundColor: th.brandLight, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <Feather name={icon} size={22} color={th.brand} />
              <Text style={{ color: th.brand, fontWeight: '800', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
          {photo && <Image source={{ uri: photo.uri }} style={{ width: 64, height: 64, borderRadius: 14, borderWidth: 1, borderColor: th.border }} accessibilityLabel="Receipt preview" />}
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
        <Card tone="sky" style={{ gap: 6 }}>
          <H3>Purchases paid to suppliers</H3>
          <Muted small>Entered in Stock › Purchase; shown here for the day.</Muted>
          {bought.length === 0 ? <Muted>No purchases today.</Muted> : bought.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}><Text style={{ color: th.ink, fontWeight: '600' }}>{p.supplierName ?? p.supplierCode}</Text><Text style={{ color: th.muted, fontSize: 12 }}>{p.code} · {String(p.paymentMode).replace('_', ' ')}</Text></View>
              <View style={{ alignItems: 'flex-end' }}><Text style={{ color: th.ink, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatINR(p.paidAmount)}</Text><Text style={{ color: th.muted, fontSize: 12 }}>{dec(p.creditAmount).greaterThan(0) ? `On credit ${formatINR(p.creditAmount)}` : 'Paid in full'}</Text></View>
            </View>
          ))}
        </Card>
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
