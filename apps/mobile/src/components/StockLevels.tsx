import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { dec, formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';
import { Card, Chip, ErrorBox, Field, ListRow, Loading, Muted, SelectField, Sheet, ToggleRow } from './ui';

const q = (v: string | number) => dec(v).toDecimalPlaces(3).toString();

/** Stock on hand per item with its value; low stock is flagged. Tap an item to see its recent movements. */
export function StockLevels({ fixedLocationId }: { fixedLocationId?: string }) {
  const th = useTheme();
  const branches = useBranches();
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<{ item: any; rows: any[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (locationId) p.set('locationId', locationId);
      setRows(await api.get(`/stock?${p}`)); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  async function showMoves(r: any) {
    setMoves({ item: r, rows: [] });
    try { setMoves({ item: r, rows: await api.get(`/stock/movements?locationId=${r.locationId}&itemId=${r.itemId}&pageSize=30`) }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }

  const shown = (rows ?? []).filter((r) => (!lowOnly || r.low) && (!search || `${r.itemName} ${r.itemCode}`.toLowerCase().includes(search.toLowerCase())));
  const total = shown.reduce((a, r) => a.plus(dec(r.value)), dec(0));

  return (
    <>
      {!fixedLocationId ? <SelectField label="Branch" value={locationId} onChange={setLocationId} placeholder="All locations" options={[{ value: '', label: 'All locations' }, ...branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))]} /> : null}
      <Field label="Search items" value={search} onChangeText={setSearch} autoCapitalize="none" />
      <ToggleRow label="Low stock only" value={lowOnly} onChange={setLowOnly} />
      <ErrorBox error={error} />
      {!rows ? <Loading /> : shown.length === 0 ? <Muted>No stock records.</Muted> : (
        <>
          <Muted small>{shown.length} items · total value {formatINR(total, { decimals: false })}</Muted>
          {shown.map((r) => (
            <ListRow
              key={`${r.locationId}-${r.itemId}`} title={r.itemName}
              lines={[`${r.itemCode}${!fixedLocationId && !locationId ? ` · ${r.locationName}` : ''}`, `Avg cost ${dec(r.avgCost).greaterThan(0) ? `₹${dec(r.avgCost).toDecimalPlaces(2)}` : '—'}${dec(r.minStock).isZero() ? '' : ` · min ${q(r.minStock)}`}`]}
              right={<>
                <Text style={{ color: r.low ? th.bad.text : th.ink, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{q(r.quantity)} {r.unit}</Text>
                <Text style={{ color: th.muted, fontSize: 12 }}>{formatINR(r.value, { decimals: false })}</Text>
                {r.low ? <Chip text="Low" tone="bad" icon="▼" /> : null}
              </>}
              onPress={() => showMoves(r)}
            />
          ))}
        </>
      )}

      <Sheet open={!!moves} onClose={() => setMoves(null)} title={moves?.item.itemName ?? 'Movements'}>
        {!moves || moves.rows.length === 0 ? <Muted>No recent movements.</Muted> : moves.rows.map((m: any, i: number) => (
          <Card key={m.id ?? i} style={{ gap: 2, padding: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: th.ink, fontWeight: '600' }}>{String(m.txnType ?? m.type ?? '').replace(/_/g, ' ')}</Text>
              <Text style={{ color: dec(m.quantity).isNegative() ? th.bad.text : th.ok.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{dec(m.quantity).greaterThan(0) ? '+' : ''}{q(m.quantity)} {r_unit(m, moves.item)}</Text>
            </View>
            <Text style={{ color: th.muted, fontSize: 12 }}>{m.businessDate ? prettyDate(String(m.businessDate).slice(0, 10)) : ''}{m.balanceAfter != null ? ` · balance ${q(m.balanceAfter)}` : ''}</Text>
          </Card>
        ))}
      </Sheet>
    </>
  );
}

const r_unit = (m: any, item: any) => m.unit ?? m.unitCode ?? item.unit ?? '';
