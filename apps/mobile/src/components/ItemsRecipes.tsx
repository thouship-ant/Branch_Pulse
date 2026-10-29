import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { api, ApiError } from '@/lib/api';
import { todayIST } from '@/lib/dates';
import { dec, formatINR } from '@/lib/money';
import { cleanQty, fmtQty, toBase, toDisplay } from '@/lib/qty';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { addDays } from '@/lib/dates';
import { useBranches } from '@/lib/useLookups';
import { BarList, Button, Card, Chip, Chips, ErrorBox, Field, Heading, ListRow, Loading, Muted, MoneyField, SectionTitle, SelectField, Sheet, StatCard, ToggleRow } from './ui';

const CATEGORIES = ['DAIRY', 'BEVERAGE_BASE', 'GRAIN', 'SPICE', 'FUEL', 'SNACKS', 'PACKAGING', 'CONSUMABLE', 'RAW_MATERIAL', 'OTHER'];

// ------------------------------------------------------------------ items
interface IDraft { id?: string; nameEn: string; nameTa: string; category: string; baseUnitId: string; purchaseUnitId: string; perishable: boolean; daily: boolean; pct: string; qty: string; active: boolean; mins: Record<string, string> }

/** Inventory items: add, rename, set units, the daily-count flag, variance thresholds and per-branch minimum stock. */
export function ItemsPanel() {
  const th = useTheme();
  const { can } = useSession();
  const branches = useBranches();
  const [items, setItems] = useState<any[] | null>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<IDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => { try { setItems(await api.get('/items?includeInactive=true')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); } }, []);
  useEffect(() => { void load(); api.get('/sync/bootstrap').then((b) => setUnits(b.units)).catch(() => undefined); }, [load]);

  const baseUnits = units.filter((u) => !u.baseUnitId);
  const blank = (): IDraft => ({ nameEn: '', nameTa: '', category: 'RAW_MATERIAL', baseUnitId: baseUnits.find((u) => u.code === 'PCS')?.id ?? baseUnits[0]?.id ?? '', purchaseUnitId: '', perishable: false, daily: false, pct: '', qty: '', active: true, mins: {} });
  const fromItem = (i: any): IDraft => ({
    id: i.id, nameEn: i.nameEnOrig ?? i.nameEn, nameTa: i.nameTa ?? '', category: i.category, baseUnitId: i.baseUnitId, purchaseUnitId: i.purchaseUnitId ?? '', perishable: i.isPerishable, daily: i.dailyCountRequired,
    pct: i.varianceThresholdPct ? String(i.varianceThresholdPct) : '', qty: i.varianceThresholdQty ? toDisplay(String(i.varianceThresholdQty), i.displayFactor) : '', active: i.status === 'ACTIVE',
    mins: Object.fromEntries((i.settings as any[]).map((s) => [s.locationId, toDisplay(String(s.minStock), i.displayFactor)])),
  });

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const factor = draft.purchaseUnitId ? String(units.find((u) => u.id === draft.purchaseUnitId)?.factorToBase ?? 1) : '1';
      const body: Record<string, unknown> = {
        nameEn: draft.nameEn.trim(), nameTa: draft.nameTa.trim() || undefined, category: draft.category, purchaseUnitId: draft.purchaseUnitId || undefined,
        isPerishable: draft.perishable, dailyCountRequired: draft.daily,
        varianceThresholdPct: draft.pct ? draft.pct : draft.id ? null : undefined, varianceThresholdQty: draft.qty ? toBase(draft.qty, factor) : draft.id ? null : undefined,
      };
      if (draft.id) {
        await api.patch(`/items/${draft.id}`, { ...body, active: draft.active });
        for (const b of branches) { const v = draft.mins[b.id]; if (v !== undefined && v !== '') await api.put(`/items/${draft.id}/locations/${b.id}`, { minStock: toBase(v, factor) }); }
      } else await api.post('/items', { ...body, baseUnitId: draft.baseUnitId });
      setDraft(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save'); }
    finally { setBusy(false); }
  }

  const manage = can('item:manage');
  const shown = (items ?? []).filter((i) => !search || `${i.nameEn} ${i.code}`.toLowerCase().includes(search.toLowerCase()));
  const buUnits = draft ? units.filter((u) => u.baseUnitId === draft.baseUnitId) : [];
  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading title="Items" />
        {manage ? <Button small icon="plus" title="Add" onPress={() => { setFormError(null); setDraft(blank()); }} /> : null}
      </View>
      <Field label="Search" value={search} onChangeText={setSearch} autoCapitalize="none" />
      <ErrorBox error={error} />
      {!items ? <Loading /> : shown.map((i) => (
        <ListRow
          key={i.id} title={i.nameEn + (i.status !== 'ACTIVE' ? ' (inactive)' : '')}
          lines={[`${i.code} · ${i.category.replace(/_/g, ' ')}`, `Stock unit ${i.baseUnit}${i.purchaseUnit ? ` · bought in ${i.purchaseUnit}` : ''}${dec(i.avgCost).greaterThan(0) ? ` · avg ₹${dec(i.avgCost).toDecimalPlaces(2)}` : ''}`]}
          right={<>{i.isPerishable ? <Chip text="Perishable" tone="warn" /> : null}{i.dailyCountRequired ? <Chip text="Daily count" tone="sky" /> : null}</>}
          onPress={manage ? () => { setFormError(null); setDraft(fromItem(i)); } : undefined}
        />
      ))}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit item' : 'Add item'}>
        {draft ? (
          <>
            <Field label="Name" required value={draft.nameEn} onChangeText={(v) => setDraft({ ...draft, nameEn: v })} maxLength={100} />
            <SelectField label="Category" value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} options={[...new Set([...CATEGORIES, draft.category])].map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))} />
            {!draft.id ? <Chips label="Stock unit" value={draft.baseUnitId} onChange={(v) => setDraft({ ...draft, baseUnitId: v, purchaseUnitId: '' })} options={baseUnits.map((u) => ({ value: u.id, label: u.code }))} /> : null}
            <Chips label="Bought in (optional)" value={draft.purchaseUnitId} onChange={(v) => setDraft({ ...draft, purchaseUnitId: v })} options={[{ value: '', label: 'Same as stock unit' }, ...buUnits.map((u) => ({ value: u.id, label: `${u.code}` }))]} />
            <ToggleRow label="Perishable" value={draft.perishable} onChange={(v) => setDraft({ ...draft, perishable: v })} />
            <ToggleRow label="Counted every day" value={draft.daily} onChange={(v) => setDraft({ ...draft, daily: v })} />
            <Field label="Variance alert (%)" value={draft.pct} keyboardType="decimal-pad" onChangeText={(v) => setDraft({ ...draft, pct: v.replace(/[^\d.]/g, '') })} placeholder="shop default" />
            <Field label="Variance alert (quantity)" value={draft.qty} keyboardType="decimal-pad" onChangeText={(v) => setDraft({ ...draft, qty: cleanQty(v) })} />
            {draft.id ? (
              <>
                <Text style={{ color: th.ink, fontWeight: '700' }}>Minimum stock per branch</Text>
                {branches.map((b) => <Field key={b.id} label={b.name} value={draft.mins[b.id] ?? ''} keyboardType="decimal-pad" onChangeText={(v) => setDraft({ ...draft, mins: { ...draft.mins, [b.id]: cleanQty(v) } })} />)}
                <ToggleRow label="Active" value={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} />
              </>
            ) : null}
            <ErrorBox error={formError} />
            <Button title="Save" onPress={save} loading={busy} disabled={!draft.nameEn.trim() || !draft.baseUnitId} />
          </>
        ) : null}
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ recipes
interface RLine { itemId: string; unitId: string; qty: string }
interface RDraft { id?: string; nameEn: string; yieldQty: string; sellingPrice: string; lines: RLine[]; active: boolean }

/** Recipes with their cost per portion and margin; open one for the ingredient breakdown and cost trend. */
export function RecipesPanel() {
  const th = useTheme();
  const { can } = useSession();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<any | null>(null);
  const [trend, setTrend] = useState<any[] | null>(null);
  const [draft, setDraft] = useState<RDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [boot, setBoot] = useState<any>(null);

  const load = useCallback(async () => { try { setRows(await api.get('/recipes')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); } }, []);
  useEffect(() => { void load(); api.get('/sync/bootstrap').then(setBoot).catch(() => undefined); }, [load]);

  const items: any[] = (boot?.items ?? []).filter((i: any) => i.status === 'ACTIVE');
  const units: any[] = boot?.units ?? [];
  const unitsFor = (itemId: string) => { const it = items.find((i) => i.id === itemId); return it ? [it.baseUnitId, it.purchaseUnitId].filter(Boolean).map((id: string) => units.find((u) => u.id === id)).filter(Boolean) : []; };

  async function open(r: any) {
    setTrend(null);
    try {
      const d = await api.get(`/recipes/${r.id}`);
      setView(d);
      const tr = await api.get(`/recipes/${r.id}/cost-trend?from=${addDays(todayIST(), -89)}&to=${todayIST()}`).catch(() => null);
      setTrend(tr?.points ?? tr ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }
  function edit(d: any) {
    setView(null);
    setDraft({ id: d.id, nameEn: d.nameEnOrig ?? d.nameEn, yieldQty: String(d.yieldQty), sellingPrice: d.sellingPrice ? String(d.sellingPrice) : '', active: d.status === 'ACTIVE', lines: (d.items as any[]).map((i) => ({ itemId: i.itemId, unitId: i.unitId, qty: String(i.quantity) })) });
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const valid = draft.lines.filter((l) => l.itemId && l.unitId && dec(l.qty || '0').greaterThan(0));
      const body: Record<string, unknown> = {
        nameEn: draft.nameEn.trim(), yieldQty: dec(draft.yieldQty || '1').toString(), sellingPrice: draft.sellingPrice ? dec(draft.sellingPrice).toFixed(2) : draft.id ? null : undefined,
        items: valid.map((l) => ({ itemId: l.itemId, unitId: l.unitId, quantity: dec(l.qty).toString() })),
      };
      if (draft.id) await api.patch(`/recipes/${draft.id}`, { ...body, active: draft.active }); else await api.post('/recipes', body);
      setDraft(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save'); } finally { setBusy(false); }
  }

  const manage = can('recipe:manage');
  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading title="Recipes" />
        {manage ? <Button small icon="plus" title="Add" onPress={() => { setFormError(null); setDraft({ nameEn: '', yieldQty: '1', sellingPrice: '', active: true, lines: [{ itemId: '', unitId: '', qty: '' }] }); }} /> : null}
      </View>
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No recipes yet.</Muted> : rows.map((r) => (
        <ListRow
          key={r.id} title={r.nameEn + (r.status !== 'ACTIVE' ? ' (inactive)' : '')}
          lines={[`${r.code} · ${r.ingredientCount} ingredients · yield ${r.yieldQty}`, `Cost ${formatINR(r.totalCost)} · per unit ${formatINR(r.costPerUnit)}`]}
          right={<>{r.sellingPrice ? <Text style={{ color: th.ink, fontWeight: '800' }}>{formatINR(r.sellingPrice, { decimals: false })}</Text> : null}{r.marginPct != null ? <Chip text={`${r.marginPct}% margin`} tone={dec(r.marginPct).isNegative() ? 'bad' : 'ok'} /> : null}</>}
          onPress={() => open(r)}
        />
      ))}

      <Sheet open={!!view} onClose={() => setView(null)} title={view?.nameEn ?? 'Recipe'}>
        {view ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <StatCard icon="layers" value={formatINR(view.totalCost)} label="Total cost" />
              <StatCard icon="tag" tone="sky" value={formatINR(view.costPerUnit)} label="Cost per unit" />
              <StatCard icon="dollar-sign" tone="ok" value={view.sellingPrice ? formatINR(view.sellingPrice, { decimals: false }) : '—'} label="Selling price" />
              <StatCard icon="percent" tone="violet" value={view.marginPct != null ? `${view.marginPct}%` : '—'} label="Margin" />
            </View>
            <SectionTitle>Ingredients</SectionTitle>
            {(view.breakdown as any[]).map((b) => (
              <View key={b.itemId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: th.ink }}>{b.name} <Text style={{ color: th.muted }}>{dec(b.quantity).toDecimalPlaces(3).toString()} {b.unitCode}</Text></Text>
                <Text style={{ color: th.ink, fontVariant: ['tabular-nums'] }}>{formatINR(b.lineCost)}</Text>
              </View>
            ))}
            {trend && trend.length > 0 ? (
              <>
                <SectionTitle>Cost trend (90 days)</SectionTitle>
                <BarList color={th.series[1]} format={(n) => `₹${n.toFixed(2)}`} rows={trend.slice(-12).map((p: any, i: number) => ({ key: String(i), label: String(p.date ?? p.day ?? p.businessDate ?? i).slice(0, 10), value: Number(p.costPerUnit ?? p.cost ?? p.totalCost ?? 0) }))} />
              </>
            ) : null}
            {manage ? <Button title="Edit recipe" variant="secondary" onPress={() => edit(view)} /> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit recipe' : 'Add recipe'}>
        {draft ? (
          <>
            <Field label="Name" required value={draft.nameEn} onChangeText={(v) => setDraft({ ...draft, nameEn: v })} maxLength={100} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label="Yield (portions)" value={draft.yieldQty} keyboardType="decimal-pad" onChangeText={(v) => setDraft({ ...draft, yieldQty: cleanQty(v) })} /></View>
              <View style={{ flex: 1 }}><MoneyField label="Selling price" value={draft.sellingPrice} onChange={(v) => setDraft({ ...draft, sellingPrice: v })} /></View>
            </View>
            {draft.lines.map((l, idx) => (
              <Card key={idx} style={{ gap: 8, padding: 12 }}>
                <SelectField label={`Ingredient ${idx + 1}`} value={l.itemId} onChange={(v) => setDraft({ ...draft, lines: draft.lines.map((x, i) => (i === idx ? { ...x, itemId: v, unitId: unitsFor(v)[0]?.id ?? '' } : x)) })} options={items.map((i) => ({ value: i.id, label: i.nameEn }))} />
                {l.itemId ? <Chips value={l.unitId} onChange={(v) => setDraft({ ...draft, lines: draft.lines.map((x, i) => (i === idx ? { ...x, unitId: v } : x)) })} options={unitsFor(l.itemId).map((u: any) => ({ value: u.id, label: u.code }))} /> : null}
                <Field label="Quantity" value={l.qty} keyboardType="decimal-pad" onChangeText={(v) => setDraft({ ...draft, lines: draft.lines.map((x, i) => (i === idx ? { ...x, qty: cleanQty(v) } : x)) })} />
                {draft.lines.length > 1 ? <Button small variant="secondary" title="Remove" onPress={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) })} /> : null}
              </Card>
            ))}
            <Button small variant="secondary" title="+ Add ingredient" onPress={() => setDraft({ ...draft, lines: [...draft.lines, { itemId: '', unitId: '', qty: '' }] })} />
            {draft.id ? <ToggleRow label="Active" value={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} /> : null}
            <ErrorBox error={formError} />
            <Button title="Save" onPress={save} loading={busy} disabled={!draft.nameEn.trim() || !draft.lines.some((l) => l.itemId && dec(l.qty || '0').greaterThan(0))} />
          </>
        ) : null}
      </Sheet>
    </>
  );
}

export { fmtQty };
