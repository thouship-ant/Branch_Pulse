import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/Text';
import { PeriodPill } from '@/components/PeriodPill';
import { Card, ErrorBox, Loading, Muted, Row, Screen, SegTabs, SelectField, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { dec, formatINR } from '@/lib/money';
import { periodLabel, resolvePeriod, type Period } from '@/lib/period';
import { useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';

type Tab = 'branch' | 'consolidated';

interface PLLines {
  label: string; from: string; to: string; totalSales: string; rawMaterial: string; salary: string; rent: string; electricity: string;
  transport: string; maintenance: string; otherExpenses: string; wastage: string; operatingProfit: string; marginPct: string | null;
  salesDays: number; avgDailySales: string; branchCount?: number;
}

/** Management P&L: one branch, or the whole business, for a chosen period. */
export default function PLScreen() {
  const today = todayIST();
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));
  const [tab, setTab] = useState<Tab>('branch');
  const branches = useBranches();
  const [locationId, setLocationId] = useState('');
  const [data, setData] = useState<PLLines | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab === 'branch' && !locationId) { setData(null); return; }
    let alive = true;
    setData(null); setError(null);
    const url = tab === 'branch' ? `/pl/branch?locationId=${locationId}&from=${period.from}&to=${period.to}` : `/pl/consolidated?from=${period.from}&to=${period.to}`;
    api.get<PLLines>(url).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [tab, locationId, period]);

  return (
    <Screen title="Profit & Loss" headerRight={<PeriodPill period={period} today={today} onChange={setPeriod} />}>
      <SegTabs value={tab} onChange={setTab} tabs={[{ key: 'branch', label: 'Branch' }, { key: 'consolidated', label: 'Consolidated' }]} />
      {tab === 'branch' ? <SelectField label="Branch" value={locationId} onChange={setLocationId} placeholder="Choose a branch…" options={branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} /> : null}
      <ErrorBox error={error} />
      {tab === 'branch' && !locationId ? <Muted>Choose a branch to see its profit and loss.</Muted> : !data ? (error ? null : <Loading />) : <Report data={data} period={periodLabel(period)} />}
    </Screen>
  );
}

function Report({ data, period }: { data: PLLines; period: string }) {
  const th = useTheme();
  const profit = dec(data.operatingProfit);
  const lines: Array<[string, string]> = [
    ['Raw material', data.rawMaterial], ['Salary', data.salary], ['Rent', data.rent], ['Electricity', data.electricity],
    ['Transport', data.transport], ['Maintenance', data.maintenance], ['Other expenses', data.otherExpenses], ['Wastage value', data.wastage],
  ];
  return (
    <>
      <Card tone="neutral">
        <Text style={{ color: th.brandDark, fontWeight: '800', fontSize: 12, letterSpacing: 0.8 }}>{data.label.toUpperCase()}</Text>
        <Muted>{prettyDate(data.from)} – {prettyDate(data.to)} · {period} · management accounts, not a statutory statement</Muted>
        {data.branchCount != null ? <Muted>{data.branchCount} branches</Muted> : null}
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <StatCard icon="trending-up" tone="ok" value={formatINR(data.totalSales, { decimals: false })} label="Total sales" />
        <StatCard icon="dollar-sign" tone={profit.isNegative() ? 'bad' : 'ok'} alert={profit.isNegative()} value={formatINR(data.operatingProfit, { decimals: false })} label="Operating profit" />
        <StatCard icon="percent" tone="violet" value={data.marginPct !== null ? `${data.marginPct}%` : '—'} label="Margin" />
        <StatCard icon="calendar" tone="sky" value={formatINR(data.avgDailySales, { decimals: false })} label="Avg daily sales" sub={`${data.salesDays} sales days`} />
      </View>
      <Card style={{ gap: 8 }}>
        <Row label="Total sales" value={formatINR(data.totalSales)} bold />
        {lines.map(([l, v]) => <Row key={l} label={`− ${l}`} value={formatINR(v)} />)}
        <View style={{ borderTopWidth: 2, borderTopColor: th.border, paddingTop: 8 }}>
          <Row label="= Operating profit" value={formatINR(data.operatingProfit)} bold accent={profit.isNegative() ? th.bad.text : th.ok.text} />
        </View>
      </Card>
    </>
  );
}
