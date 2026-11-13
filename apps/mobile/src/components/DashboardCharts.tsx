import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, ErrorBox, Muted, SegTabs } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';

const SALES = '#3B82F6';
const EXPENSES = '#D97706';
const WASTAGE = '#E11D48';
const SALARY = '#9333EA';
const ALLOWANCE = '#16A34A';
const STOCK = '#0284C7';

const money = (n: number) => formatINR(String(Math.round(n)), { decimals: false });
const compact = (n: number) => (Math.abs(n) >= 10_000_000 ? `${(n / 10_000_000).toFixed(1)}Cr` : Math.abs(n) >= 100_000 ? `${(n / 100_000).toFixed(1)}L` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n * 10) / 10));
const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UNIT: Record<string, string> = { ML: 'ml', L: 'L', G: 'g', KG: 'kg', PCS: 'pcs', PKT: 'pkt' };

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  const th = useTheme();
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: th.ink, fontSize: 17, fontWeight: '800' }}>{title}</Text>
          {sub ? <Text style={{ color: th.muted, fontSize: 12 }}>{sub}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </Card>
  );
}

function Legend({ items }: { items: Array<{ name: string; color: string }> }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
      {items.map((i) => (
        <View key={i.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: i.color }} />
          <Text style={{ color: th.muted, fontSize: 12 }}>{i.name}</Text>
        </View>
      ))}
    </View>
  );
}

/** Vertical bars, one or two per column; scrolls sideways when there are many. Tap a column to read its exact value. */
function Columns({ cols, colors, names, height = 130 }: { cols: Array<{ key: string; label: string; values: Array<number | null> }>; colors: string[]; names?: string[]; height?: number }) {
  const th = useTheme();
  const [sel, setSel] = useState<string | null>(null);
  const max = Math.max(1, ...cols.flatMap((c) => c.values.map((v) => v ?? 0)));
  const w = Math.max(colors.length > 1 ? 34 : 26, 0);
  const every = cols.length > 16 ? Math.ceil(cols.length / 10) : 1;
  const picked = cols.find((c) => c.key === sel);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ minHeight: 18 }}>
        {picked ? (
          <Text style={{ color: th.ink, fontSize: 12, fontWeight: '700' }}>
            {picked.label}: {picked.values.map((v, i) => `${names?.[i] ? names[i] + ' ' : ''}${v === null ? '—' : money(v)}`).join('  ·  ')}
          </Text>
        ) : <Text style={{ color: th.faint, fontSize: 12 }}>Tap a bar for the exact amount</Text>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 6, borderBottomWidth: 1, borderBottomColor: th.border }}>
            {cols.map((c) => (
              <Pressable key={c.key} onPress={() => setSel(c.key === sel ? null : c.key)} style={{ width: w, height: '100%', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, opacity: sel && sel !== c.key ? 0.45 : 1 }}>
                {c.values.map((v, i) => (
                  <View key={i} style={{ flex: 1, height: v === null ? 0 : `${Math.max(v > 0 ? 3 : 0, (v / max) * 100)}%`, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: colors[i] }} />
                ))}
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            {cols.map((c, i) => <Text key={c.key} numberOfLines={1} style={{ width: w, textAlign: 'center', color: th.muted, fontSize: 10, fontVariant: ['tabular-nums'] }}>{i % every === 0 ? c.label : ''}</Text>)}
          </View>
        </View>
      </ScrollView>
      <Text style={{ color: th.faint, fontSize: 11 }}>Highest {money(max)}</Text>
    </View>
  );
}

/** Horizontal bars with the label above and the value at the right: easy to read on a narrow screen. */
function Bars({ rows, color, fmt = money }: { rows: Array<{ key: string; label: string; value: number | null; detail?: string }>; color: string; fmt?: (n: number) => string }) {
  const th = useTheme();
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value ?? 0)));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((r) => (
        <View key={r.key} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '600', flex: 1 }}>{r.label}</Text>
            <Text style={{ color: r.value !== null && r.value < 0 ? th.bad.text : th.ink, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{r.value === null ? '—' : fmt(r.value)}</Text>
          </View>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: th.border, overflow: 'hidden' }}>
            <View style={{ width: `${r.value === null ? 0 : Math.max(2, (Math.abs(r.value) / max) * 100)}%`, height: '100%', borderRadius: 5, backgroundColor: r.value !== null && r.value < 0 ? '#DC2626' : color }} />
          </View>
          {r.detail ? <Text style={{ color: th.muted, fontSize: 12 }}>{r.detail}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const CODES = ['daily-sales-trend', 'branch-sales', 'expense-categories', 'monthly-sales', 'monthly-expenses', 'branch-profitability', 'stock-consumption', 'wastage-trend', 'salary-trend'] as const;
type Range = '7' | '30' | '90';

/** The web dashboard's charts, drawn for a phone: one card per chart, bars you can tap, no hover needed. */
export function DashboardCharts() {
  const th = useTheme();
  const [range, setRange] = useState<Range>('30');
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wasteMode, setWasteMode] = useState<'value' | 'pct'>('value');

  const to = todayIST();
  const from = addDays(to, -(Number(range) - 1));
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(CODES.map((c) => api.get<any>(`/dashboard/charts/${c}?from=${from}&to=${to}`).then((d) => [c, d] as const)))
      .then((e) => { if (alive) { setData(Object.fromEntries(e)); setError(null); } })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load charts'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [from, to]);

  const dayLabel = (d: string) => d.slice(8);
  const monthCols = (code: string) => ((data[code]?.months ?? []) as Array<{ month: string; amount: string }>).map((m) => ({ key: m.month, label: `${MONTHS[Number(m.month.slice(5, 7)) - 1]}${m.month.endsWith('-01') ? ` ’${m.month.slice(2, 4)}` : ''}`, values: [Number(m.amount)] as Array<number | null> }));
  const rangeText = `${prettyDate(from)} – ${prettyDate(to)}`;

  const trend = data['daily-sales-trend'];
  const bs = data['branch-sales']?.rows as any[] | undefined;
  const cats = data['expense-categories'];
  const prof = data['branch-profitability']?.rows as any[] | undefined;
  const stock = data['stock-consumption'];
  const waste = data['wastage-trend'];
  const sal = data['salary-trend'];
  const catTotal = Number(cats?.total ?? 0);
  const none = <Muted>No data for this period.</Muted>;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ color: th.ink, fontSize: 20, fontWeight: '800' }}>Charts</Text>
        <SegTabs value={range} onChange={setRange} tabs={[{ key: '7', label: 'Last 7 days' }, { key: '30', label: 'Last 30 days' }, { key: '90', label: 'Last 90 days' }]} />
        <Text style={{ color: th.muted, fontSize: 12 }}>{rangeText}</Text>
      </View>
      <ErrorBox error={error} />
      {loading && !trend ? <Muted>Loading charts…</Muted> : null}

      {trend ? (
        <Panel title="Daily sales" sub={rangeText}>
          {trend.total.every((v: string | null) => v === null) ? none : <Columns cols={(trend.dates as string[]).map((d, i) => ({ key: d, label: dayLabel(d), values: [num(trend.total[i])] }))} colors={[SALES]} />}
        </Panel>
      ) : null}

      {bs ? (
        <Panel title="Branch-wise sales" sub={rangeText}>
          {bs.every((r) => Number(r.sales) === 0) ? none : <Bars color={SALES} rows={bs.map((r) => ({ key: r.locationId, label: r.name, value: Number(r.sales), detail: `${r.days} days` }))} />}
        </Panel>
      ) : null}

      {cats ? (
        <Panel title="Expense categories" sub={`${rangeText} · total ${money(catTotal)}`}>
          {(cats.rows ?? []).length === 0 ? none : <Bars color={EXPENSES} rows={(cats.rows as any[]).slice(0, 12).map((r) => ({ key: r.categoryId, label: r.name, value: Number(r.amount), detail: catTotal ? `${((Number(r.amount) / catTotal) * 100).toFixed(1)}% of total` : undefined }))} />}
        </Panel>
      ) : null}

      {data['monthly-sales'] ? (
        <Panel title="Monthly sales" sub="Last 12 months">
          <Columns cols={monthCols('monthly-sales')} colors={[SALES]} />
        </Panel>
      ) : null}
      {data['monthly-expenses'] ? (
        <Panel title="Monthly expenses" sub="Last 12 months">
          <Columns cols={monthCols('monthly-expenses')} colors={[EXPENSES]} />
        </Panel>
      ) : null}

      {prof ? (
        <Panel title="Branch profitability" sub="Profit as a share of sales">
          {prof.every((r) => r.marginPct === null) ? none : (
            <Bars color={SALES} fmt={(n) => `${n.toFixed(1)}%`} rows={prof.map((r) => ({ key: r.locationId, label: r.name, value: num(r.marginPct), detail: `Sales ${money(Number(r.sales))} · Net ${money(Number(r.profit))}` }))} />
          )}
        </Panel>
      ) : null}

      {sal ? (
        <Panel title="Daily salary & allowance" sub={rangeText}>
          <Legend items={[{ name: 'Salary', color: SALARY }, { name: 'Allowance', color: ALLOWANCE }]} />
          {sal.salary.every((v: string | null, i: number) => v === null && sal.allowance[i] === null) ? none : (
            <Columns names={['Salary', 'Allowance']} colors={[SALARY, ALLOWANCE]} cols={(sal.dates as string[]).map((d, i) => ({ key: d, label: dayLabel(d), values: [num(sal.salary[i]), num(sal.allowance[i])] }))} />
          )}
        </Panel>
      ) : null}

      {waste ? (
        <Panel
          title="Wastage" sub={rangeText}
          right={<SegTabs value={wasteMode} onChange={setWasteMode} tabs={[{ key: 'value', label: '₹' }, { key: 'pct', label: '% of sales' }]} />}
        >
          {waste.value.every((v: string | null) => v === null) ? none : (
            <Columns colors={[WASTAGE]} cols={(waste.dates as string[]).map((d, i) => ({ key: d, label: dayLabel(d), values: [num((wasteMode === 'value' ? waste.value : waste.pctOfSales)[i])] }))} />
          )}
        </Panel>
      ) : null}

      {stock && stock.items.length > 0 ? (
        <Panel title="Stock consumption" sub="One chart per item, as each has its own unit">
          <View style={{ gap: 16 }}>
            {stock.items.map((it: any) => {
              const raw = (it.values as Array<string | null>).map(num);
              const big = Math.max(0, ...raw.map((v) => v ?? 0));
              const div = (it.unit === 'ML' || it.unit === 'G') && big >= 1000 ? 1000 : 1;
              const unit = it.unit === 'ML' && div === 1000 ? 'L' : it.unit === 'G' && div === 1000 ? 'kg' : UNIT[it.unit] ?? String(it.unit).toLowerCase();
              return (
                <View key={it.itemId} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: th.ink, fontWeight: '700' }}>{it.name}</Text>
                    <Text style={{ color: th.muted, fontSize: 13 }}>{compact(Number(it.total) / div)} {unit}</Text>
                  </View>
                  <MiniBars values={raw.map((v) => (v === null ? null : v / div))} />
                </View>
              );
            })}
          </View>
        </Panel>
      ) : null}
    </View>
  );
}

/** A small sparkline-style bar strip for one stock item. */
function MiniBars({ values }: { values: Array<number | null> }) {
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 2 }}>
      {values.map((v, i) => <View key={i} style={{ flex: 1, height: v === null ? 0 : `${Math.max(v > 0 ? 4 : 0, (v / max) * 100)}%`, borderRadius: 2, backgroundColor: STOCK }} />)}
    </View>
  );
}
