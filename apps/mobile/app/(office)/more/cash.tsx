import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/Text';
import { Chip, DateStepper, Empty, ErrorBox, ListRow, Loading, Screen, SectionTitle, SegTabs, SelectField, StatCard, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { approvalTone, REASON_LABEL } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import { useDay } from '@/lib/useDate';

type Tab = 'daily' | 'report';
const whole = (v: string | number | null | undefined) => formatINR(v == null ? null : String(v), { decimals: false });

/** Cash for every branch: the day's reconciliation, and the history of differences. */
export default function CashScreen() {
  const [tab, setTab] = useState<Tab>('daily');
  return (
    <Screen title="Cash">
      <SegTabs value={tab} onChange={setTab} tabs={[{ key: 'daily', label: 'Daily' }, { key: 'report', label: 'Variance report' }]} />
      {tab === 'daily' ? <Daily /> : <Report />}
    </Screen>
  );
}

function Daily() {
  const th = useTheme();
  const router = useRouter();
  const day = useDay();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.get(`/cash/overview?date=${day.date}`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [day.date]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const tot = data?.totals;

  return (
    <>
      <DateStepper label={day.label} onPrev={day.prev} onNext={day.next} nextDisabled={day.isToday} />
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            <StatCard icon="dollar-sign" value={whole(tot.expected)} label="Expected cash" />
            <StatCard icon="check-circle" tone="ok" value={whole(tot.actual)} label="Actual cash" sub={`${tot.branchesCounted} / ${data.rows.length} counted`} />
            <StatCard icon="alert-triangle" tone={dec(tot.netVariance).isNegative() ? 'bad' : 'neutral'} alert={dec(tot.netVariance).isNegative()} value={whole(tot.netVariance)} label="Net variance" sub={`${tot.shortages} short · ${tot.surpluses} surplus`} />
            <StatCard icon="clock" tone={tot.awaitingApproval ? 'warn' : 'ok'} value={String(tot.awaitingApproval)} label="Awaiting approval" />
          </View>
          <SectionTitle>Branches</SectionTitle>
          {data.rows.length === 0 ? <Empty text="No branches." /> : data.rows.map((r: any) => {
            const v = r.variance === null ? null : dec(r.variance);
            return (
              <ListRow
                key={r.locationId} title={r.name}
                lines={[`Expected ${whole(r.expectedClosing)} · Actual ${r.actualClosing === null ? 'not counted' : whole(r.actualClosing)}`, `Sales ${whole(r.cashSales)} · Expenses ${whole(r.cashExpenses)}`]}
                right={<>
                  {v ? <Text style={{ color: v.isNegative() ? th.bad.text : v.isZero() ? th.ok.text : th.warn.text, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{v.isZero() ? '✓' : v.isNegative() ? '▼' : '▲'} {v.isZero() ? '' : formatINR(v.abs(), { decimals: false })}</Text> : <Text style={{ color: th.faint }}>—</Text>}
                  <StatusPill status={r.closingStatus} />
                </>}
                onPress={() => router.push(`/more/cash-detail/${r.locationId}/${day.date}` as any)}
              />
            );
          })}
        </>
      )}
    </>
  );
}

function Report() {
  const th = useTheme();
  const router = useRouter();
  const today = todayIST();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [branches, setBranches] = useState<any[]>([]);
  const [locationId, setLocationId] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get('/locations?type=BRANCH').then((b) => setBranches(b as any[])).catch(() => undefined); }, []);
  const load = useCallback(async () => {
    try {
      const qs = `${locationId ? `locationId=${locationId}&` : ''}from=${addDays(today, -(Number(days) - 1))}&to=${today}`;
      setRows((await api.get(`/cash/variance-report?${qs}`)).rows); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [days, locationId, today]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  return (
    <>
      <SegTabs value={days} onChange={setDays} tabs={[{ key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' }]} />
      <SelectField label="Branch" value={locationId} onChange={setLocationId} placeholder="All branches" options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text="No cash differences in this period." /> : rows.map((r) => {
        const neg = dec(r.variance).isNegative();
        const d = String(r.businessDate).slice(0, 10);
        return (
          <ListRow
            key={r.id} title={`${prettyDate(d)} · ${r.name}`} tone={neg ? undefined : undefined}
            lines={[`Expected ${whole(r.expectedClosing)} · Actual ${whole(r.actualClosing)}`, r.reason ? `Reason: ${REASON_LABEL[r.reason] ?? r.reason}` : null, r.managerExplanation]}
            right={<>
              <Text style={{ color: neg ? th.bad.text : th.warn.text, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{neg ? '▼' : '▲'} {formatINR(dec(r.variance).abs(), { decimals: false })}</Text>
              <Chip text={r.approvalStatus ?? 'Not sent'} tone={approvalTone(r.approvalStatus)} />
            </>}
            onPress={() => router.push(`/more/cash-detail/${r.locationId}/${d}` as any)}
          />
        );
      })}
    </>
  );
}
