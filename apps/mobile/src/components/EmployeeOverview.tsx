import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text } from './Text';
import { api } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';
import { Button, Card, Chip, ErrorBox, Field, ListRow, Loading, Muted, SelectField, StatCard } from './ui';

const PAGE = 10;
const money = (v: unknown) => formatINR(String(v ?? 0), { decimals: false });
const monthlyCost = (r: any) => (r.salaryType === 'MONTHLY' ? Number(r.baseSalary) : Number(r.baseSalary) * 26); // a daily wage is costed at 26 days

/** Staff overview: headline numbers, split by role and branch, and the employee list 10 to a page. The branch filter starts on All. */
export function EmployeeOverview() {
  const th = useTheme();
  const branches = useBranches();
  const [branch, setBranch] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    setRows(null);
    api.get<any[]>(`/employees?includeInactive=true${branch ? `&locationId=${branch}` : ''}`)
      .then((r) => { if (alive) { setRows(r); setError(null); } })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load'));
    return () => { alive = false; };
  }, [branch]);
  useEffect(() => setPage(1), [branch, q]);

  const active = useMemo(() => (rows ?? []).filter((r) => r.status === 'ACTIVE'), [rows]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !s || `${r.fullName} ${r.code} ${r.jobRole} ${r.phone ?? ''}`.toLowerCase().includes(s));
  }, [rows, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const slice = filtered.slice((page - 1) * PAGE, page * PAGE);

  const byRole = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of active) m.set(r.jobRole, (m.get(r.jobRole) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);
  const byBranch = useMemo(() => {
    const m = new Map<string, { name: string; n: number; payroll: number }>();
    for (const r of active) {
      const cur = m.get(r.locationId) ?? { name: r.locationName ?? '', n: 0, payroll: 0 };
      cur.n++; cur.payroll += monthlyCost(r);
      m.set(r.locationId, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [active]);
  const payroll = active.reduce((a, r) => a + monthlyCost(r), 0);
  const monthly = active.filter((r) => r.salaryType === 'MONTHLY').length;

  return (
    <>
      <SelectField label="Branch" value={branch} onChange={setBranch} options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name, role, code or phone" autoCapitalize="none" />
      <ErrorBox error={error} />
      {!rows ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            <StatCard icon="users" value={String(rows.length)} label="Employees" sub={`${active.length} active`} />
            <StatCard icon="user-check" tone="violet" value={`${monthly} / ${active.length - monthly}`} label="Monthly / daily" />
            <StatCard icon="dollar-sign" mdi="account-cash-outline" tone="ok" value={money(payroll)} label="Monthly payroll" sub="A daily wage counts 26 days" />
          </View>

          <Card style={{ gap: 10 }}>
            <Text style={{ color: th.ink, fontWeight: '800', fontSize: 16 }}>By role</Text>
            {byRole.map(([role, n]) => (
              <View key={role} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: th.ink, fontWeight: '600' }}>{role}</Text><Text style={{ color: th.muted }}>{n}</Text></View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: th.brandLight, overflow: 'hidden' }}><View style={{ width: `${Math.max(4, (n / byRole[0][1]) * 100)}%`, height: '100%', backgroundColor: th.brand, borderRadius: 4 }} /></View>
              </View>
            ))}
          </Card>
          <Card style={{ gap: 8 }}>
            <Text style={{ color: th.ink, fontWeight: '800', fontSize: 16 }}>By branch</Text>
            {byBranch.map((b) => (
              <View key={b.name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text numberOfLines={1} style={{ color: th.ink, flex: 1 }}>{b.name}</Text>
                <Text style={{ color: th.muted, fontVariant: ['tabular-nums'] }}>{b.n} · {money(b.payroll)}</Text>
              </View>
            ))}
          </Card>

          <Text style={{ color: th.ink, fontWeight: '800', fontSize: 16 }}>Staff ({filtered.length})</Text>
          {filtered.length === 0 ? <Muted>No employees found.</Muted> : slice.map((r) => (
            <ListRow
              key={r.id} title={r.fullName}
              lines={[`${r.jobRole} · ${r.code}`, `${r.locationName ?? ''}${r.phone ? ` · ${r.phone}` : ''}`, `Joined ${prettyDate(String(r.joiningDate).slice(0, 10))} · ${r.salaryType === 'MONTHLY' ? 'Monthly' : 'Daily'} ${money(r.baseSalary)}`]}
              right={<Chip text={r.status === 'ACTIVE' ? 'Active' : 'Inactive'} tone={r.status === 'ACTIVE' ? 'ok' : 'neutral'} icon={r.status === 'ACTIVE' ? '●' : '○'} />}
            />
          ))}
          {pages > 1 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Button title="Previous" variant="secondary" style={{ flex: 1 }} disabled={page <= 1} onPress={() => setPage((p) => p - 1)} />
              <Text style={{ color: th.muted, fontVariant: ['tabular-nums'] }}>{page} / {pages}</Text>
              <Button title="Next" variant="secondary" style={{ flex: 1 }} disabled={page >= pages} onPress={() => setPage((p) => p + 1)} />
            </View>
          ) : null}
        </>
      )}
    </>
  );
}
