import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { BranchForm } from '@/components/BranchForm';
import { PeriodPill } from '@/components/PeriodPill';
import { BarList, Button, Card, Chip, ErrorBox, H3, Heading, Loading, Muted, Row, Screen, SegTabs, SelectField, Sheet, StatCard } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { dec, formatINR } from '@/lib/money';
import { resolvePeriod, type Period } from '@/lib/period';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type Tab = 'overview' | 'report' | 'history';
const whole = (v: string | number | null | undefined) => formatINR(v == null ? null : String(v), { decimals: false });
const TYPE: Record<string, string> = { BRANCH: 'Branch', GODOWN: 'Godown', CENTRAL_OFFICE: 'Office' };

/** One branch: details and manager, performance report for a period, change history. */
export default function BranchDetail() {
  const th = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const today = todayIST();
  const [branch, setBranch] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [managers, setManagers] = useState<any[]>([]);
  const [managerId, setManagerId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setBranch(await api.get(`/locations/${id}`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  function toggle() {
    const next = branch.status === 'ACTIVE' ? 'deactivate' : 'activate';
    Alert.alert(`${next === 'deactivate' ? 'Deactivate' : 'Activate'} ${branch.name}?`, next === 'deactivate' ? 'It will no longer appear for daily entries.' : 'It will be available again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: next === 'deactivate' ? 'Deactivate' : 'Activate', style: next === 'deactivate' ? 'destructive' : 'default', onPress: async () => {
        try { await api.post(`/locations/${id}/${next}`); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
      } },
    ]);
  }

  async function openAssign() {
    setAssigning(true);
    try {
      const us = (await api.get('/users')) as any[];
      setManagers(us.filter((u) => u.status === 'ACTIVE' && u.roles.includes('BRANCH_MANAGER')));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load users'); }
  }
  async function assign(userId: string | null) {
    setBusy(true);
    try { await api.post(`/locations/${id}/manager`, { userId }); setAssigning(false); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  if (!branch) return <Screen title="Branch">{error ? <ErrorBox error={error} /> : <Loading />}</Screen>;
  const manage = can('location:manage');
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'overview', label: 'Overview' }];
  if (branch.type === 'BRANCH' && can('report:view')) tabs.push({ key: 'report', label: 'Report' });
  tabs.push({ key: 'history', label: 'History' });

  return (
    <Screen title={branch.name} onRefresh={load} headerRight={tab === 'report' ? <PeriodPill period={period} today={today} onChange={setPeriod} /> : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Heading sub={`${branch.code} · ${TYPE[branch.type] ?? branch.type}`} title={branch.name} />
        <Chip text={branch.status === 'ACTIVE' ? 'Active' : 'Inactive'} tone={branch.status === 'ACTIVE' ? 'ok' : 'neutral'} icon={branch.status === 'ACTIVE' ? '●' : '○'} />
      </View>
      <ErrorBox error={error} />
      <SegTabs value={tab} onChange={setTab} tabs={tabs} />

      {tab === 'overview' ? (
        <>
          <Card style={{ gap: 6 }}>
            <Row label="Address" value={branch.address || '—'} />
            <Row label="Phone" value={branch.phone || '—'} />
            {branch.type === 'BRANCH' ? <Row label="Opening cash" value={whole(branch.defaultOpeningCash)} /> : null}
            <Row label="Monthly rent" value={whole(branch.monthlyRent)} />
            {branch.type === 'BRANCH' ? <Row label="Card payments" value={branch.cardEnabled ? 'Accepted' : 'Not accepted'} /> : null}
            {branch.notes ? <Muted>{branch.notes}</Muted> : null}
          </Card>
          {branch.type === 'BRANCH' ? (
            <Card>
              <H3>Manager</H3>
              <Text style={{ color: th.ink }}>{branch.manager ? branch.manager.fullName : 'Not assigned'}</Text>
              {manage ? <Button small variant="secondary" title={branch.manager ? 'Change manager' : 'Assign manager'} onPress={openAssign} /> : null}
            </Card>
          ) : null}
          {manage ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button title="Edit" style={{ flex: 1 }} onPress={() => setEditing(true)} />
              <Button title={branch.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} variant={branch.status === 'ACTIVE' ? 'danger' : 'secondary'} style={{ flex: 1 }} onPress={toggle} />
            </View>
          ) : null}
        </>
      ) : tab === 'report' ? <Report id={String(id)} period={period} /> : <History id={String(id)} />}

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit branch">
        <BranchForm branch={branch} onDone={() => { setEditing(false); void load(); }} />
      </Sheet>
      <Sheet open={assigning} onClose={() => setAssigning(false)} title="Branch manager">
        <SelectField label="Manager" value={managerId} onChange={setManagerId} placeholder="Choose a user…" options={managers.map((u) => ({ value: u.id, label: `${u.fullName} · ${u.mobile ?? u.username}` }))} />
        <Muted small>Only users with the Branch Manager role are listed. Create them under Users.</Muted>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {branch.manager ? <Button title="Remove" variant="danger" style={{ flex: 1 }} loading={busy} onPress={() => assign(null)} /> : null}
          <Button title="Assign" style={{ flex: 1 }} loading={busy} disabled={!managerId} onPress={() => assign(managerId)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function Report({ id, period }: { id: string; period: Period }) {
  const th = useTheme();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    api.get(`/locations/${id}/report?from=${period.from}&to=${period.to}`).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id, period]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const s = data.summary;
  const profit = dec(s.operatingProfit);
  return (
    <>
      <Muted>{prettyDate(data.from)} – {prettyDate(data.to)}</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <StatCard icon="trending-up" tone="ok" value={whole(s.totalSales)} label="Sales" sub={`${s.salesDays} days · avg ${whole(s.avgDailySales)}`} />
        <StatCard icon="credit-card" tone="warn" value={whole(s.totalExpenses)} label="Expenses" />
        <StatCard icon="dollar-sign" tone={profit.isNegative() ? 'bad' : 'ok'} alert={profit.isNegative()} value={whole(s.operatingProfit)} label="Operating profit" sub={s.marginPct != null ? `${s.marginPct}% margin` : undefined} />
        <StatCard icon="alert-triangle" tone={dec(s.netCashVariance).isNegative() ? 'bad' : 'neutral'} value={whole(s.netCashVariance)} label="Net cash variance" sub={`${s.shortageDays} shortage days`} />
      </View>
      <Card>
        <H3>Payment mix</H3>
        <BarList color={th.series[0]} format={whole} rows={[
          { key: 'cash', label: 'Cash', value: Number(s.cash), detail: s.cashPct != null ? `${s.cashPct}%` : undefined },
          { key: 'upi', label: 'UPI', value: Number(s.upi), detail: s.upiPct != null ? `${s.upiPct}%` : undefined },
          { key: 'card', label: 'Card', value: Number(s.card), detail: s.cardPct != null ? `${s.cardPct}%` : undefined },
          { key: 'credit', label: 'Credit', value: Number(s.credit), detail: s.creditPct != null ? `${s.creditPct}%` : undefined },
        ].filter((r) => r.value > 0)} />
      </Card>
      <Card>
        <H3>Expenses by category</H3>
        <BarList color={th.series[1]} format={whole} rows={(data.expenseByCategory as any[]).map((c) => ({ key: c.categoryId, label: c.name, value: Number(c.amount), detail: c.sharePct != null ? `${c.sharePct}%` : undefined }))} />
      </Card>
      <Card>
        <H3>Closings</H3>
        <Row label="Approved" value={String(s.closings.approved)} />
        <Row label="Submitted" value={String(s.closings.submitted)} />
        <Row label="Rejected" value={String(s.closings.rejected)} />
        <Row label="Reopened" value={String(s.closings.reopened)} />
        <Row label="Pending" value={String(s.closings.pending)} />
      </Card>
    </>
  );
}

function History({ id }: { id: string }) {
  const th = useTheme();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get(`/locations/${id}/history`).then((r) => setRows(r as any[])).catch((e) => setError(e.message)); }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!rows) return <Loading />;
  return (
    <Card>
      <H3>Change history</H3>
      {rows.length === 0 ? <Muted>No changes recorded.</Muted> : rows.map((h, i) => (
        <View key={h.id ?? i} style={{ gap: 2 }}>
          <Text style={{ color: th.ink, fontWeight: '600' }}>{h.action} · {h.entity_type}{h.entity_code ? ` ${h.entity_code}` : ''}{h.changed_fields?.length ? ` (${h.changed_fields.join(', ')})` : ''}</Text>
          <Text style={{ color: th.muted, fontSize: 12 }}>{h.actor_name ?? 'System'} · {h.occurred_at ? new Date(h.occurred_at).toLocaleString() : ''}{h.reason ? ` · ${h.reason}` : ''}</Text>
        </View>
      ))}
    </Card>
  );
}
