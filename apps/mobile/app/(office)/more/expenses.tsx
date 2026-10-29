import { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { PeriodPill } from '@/components/PeriodPill';
import {
  BarList, Button, Card, Chip, Chips, ErrorBox, Field, Heading, ListRow, Loading, Muted, MoneyField, Screen, SectionTitle, SegTabs, SelectField, Sheet, StatCard,
} from '@/components/ui';
import { api, ApiError, API_ORIGIN } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { approvalTone, MODE_LABEL, STATUS_LABEL } from '@/lib/labels';
import { amt, formatINR } from '@/lib/money';
import { resolvePeriod, type Period } from '@/lib/period';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useBranches, useCategories } from '@/lib/useLookups';

type Tab = 'overview' | 'ledger' | 'categories';
const money = (n: number | string) => formatINR(n, { decimals: false });

/** Expenses for the whole business: analytics, the ledger (with approve / reject) and the category list. */
export default function ExpensesScreen() {
  const today = todayIST();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<Period>(() => resolvePeriod('month', today));
  const tabs: Array<{ key: Tab; label: string }> = [{ key: 'overview', label: 'Overview' }, { key: 'ledger', label: 'Ledger' }];
  if (can('settings:manage')) tabs.push({ key: 'categories', label: 'Categories' });
  return (
    <Screen title="Expenses" headerRight={tab === 'categories' ? undefined : <PeriodPill period={period} today={today} onChange={setPeriod} />}>
      <SegTabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'overview' ? <Overview period={period} /> : tab === 'ledger' ? <Ledger period={period} /> : <Categories />}
    </Screen>
  );
}

function Overview({ period }: { period: Period }) {
  const th = useTheme();
  const branches = useBranches();
  const categories = useCategories();
  const [group, setGroup] = useState<'day' | 'week' | 'month'>('day');
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    const qs = new URLSearchParams({ from: period.from, to: period.to, groupBy: group });
    if (branchId) qs.set('locationId', branchId);
    if (categoryId) qs.set('categoryId', categoryId);
    api.get(`/expenses/summary?${qs}`).then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [period, group, branchId, categoryId]);

  const tot = data?.totals;
  const change: number | null = tot?.changePct ?? null;
  return (
    <>
      <Chips label="Trend" value={group} onChange={setGroup} options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />
      <SelectField label="Branch" value={branchId} onChange={setBranchId} placeholder="All branches" options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      <SelectField label="Category" value={categoryId} onChange={setCategoryId} placeholder="All categories" options={[{ value: '', label: 'All categories' }, ...categories.filter((c) => !c.parentId).map((c) => ({ value: c.id, label: c.nameEn }))]} />
      <ErrorBox error={error} />
      {!data ? (error ? null : <Loading />) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            <StatCard icon="credit-card" value={money(tot.total)} label="Total" sub={`${tot.count} entries`} />
            <StatCard icon="trending-up" tone="sky" value={money(tot.averagePerDay)} label="Avg per day" sub={`${data.days} days`} />
            <StatCard icon="bar-chart-2" tone={change != null && change > 0 ? 'warn' : 'ok'} value={change === null ? '—' : `${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${Math.abs(change)}%`} label="vs previous period" sub={`Before: ${money(tot.previousTotal)}`} />
            <StatCard icon="clock" tone={tot.pendingApproval.count > 0 ? 'warn' : 'ok'} value={String(tot.pendingApproval.count)} label="Pending approval" sub={money(tot.pendingApproval.amount)} />
          </View>
          <Card>
            <SectionTitle>{group === 'month' ? 'Monthly' : group === 'week' ? 'Weekly' : 'Daily'} expenses</SectionTitle>
            <BarList color={th.series[1]} format={money} rows={(data.buckets as any[]).filter((b) => Number(b.amount) > 0).slice(-31).map((b) => ({ key: b.start, label: group === 'month' ? String(b.start).slice(0, 7) : group === 'week' ? `Week of ${prettyDate(b.start)}` : prettyDate(b.start), value: Number(b.amount), detail: `${b.count} entries` }))} />
          </Card>
          <Card>
            <SectionTitle>Branch-wise</SectionTitle>
            <BarList color={th.series[1]} format={money} rows={(data.branches as any[]).map((b) => ({ key: b.locationId, label: b.name, value: Number(b.amount), detail: `${b.count} entries${b.sharePct === null ? '' : ` · ${b.sharePct}%`}` }))} />
          </Card>
          <Card>
            <SectionTitle>Category-wise</SectionTitle>
            <BarList color={th.series[1]} format={money} rows={(data.categories as any[]).map((c) => ({
              key: c.categoryId, label: c.name, value: Number(c.amount),
              detail: [`${c.count} entries`, c.sharePct === null ? null : `${c.sharePct}%`, ...(c.subs as any[]).filter((s) => s.name).slice(0, 3).map((s) => `${s.name} ${money(s.amount)}`)].filter(Boolean).join(' · '),
            }))} />
          </Card>
        </>
      )}
    </>
  );
}

const PAGE = 30;

function Ledger({ period }: { period: Period }) {
  const th = useTheme();
  const { can } = useSession();
  const branches = useBranches();
  const categories = useCategories();
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [period, branchId, categoryId, status, query]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ from: period.from, to: period.to, page: '1', pageSize: String(PAGE * page) });
    if (branchId) p.set('locationId', branchId);
    if (categoryId) p.set('categoryId', categoryId);
    if (status) p.set('status', status);
    if (query) p.set('q', query);
    try {
      const { data, meta } = await api.full.get<any[]>(`/expenses?${p}`);
      setRows(data); setTotal(meta?.total ?? data.length); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [period, branchId, categoryId, status, query, page]);
  useEffect(() => { void load(); }, [load]);

  async function approve(id: string) {
    setBusy(id); setError(null);
    try { await api.post(`/expenses/${id}/approve`); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(null); }
  }
  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id); setError(null);
    try { await api.post(`/expenses/${rejecting.id}/reject`, { reason }); setRejecting(null); setReason(''); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(null); }
  }
  async function receipt(id: string) {
    try {
      const detail = await api.get(`/expenses/${id}`);
      const att = detail.attachments?.[0];
      if (!att) { setError('No receipt attached'); return; }
      const { url } = await api.get(`/attachments/${att.id}/url`);
      await Linking.openURL(url.startsWith('/') ? `${API_ORIGIN}${url}` : url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the receipt'); }
  }

  return (
    <>
      <SelectField label="Branch" value={branchId} onChange={setBranchId} placeholder="All branches" options={[{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      <SelectField label="Category" value={categoryId} onChange={setCategoryId} placeholder="All categories" options={[{ value: '', label: 'All categories' }, ...categories.filter((c) => !c.parentId).map((c) => ({ value: c.id, label: c.nameEn }))]} />
      <Chips label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, { value: 'SUBMITTED', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Paid to / description / code" autoCapitalize="none" />
      <ErrorBox error={error} />
      {!rows ? (error ? null : <Loading />) : rows.length === 0 ? <Muted>No expenses for these filters.</Muted> : (
        <>
          <Muted small>{rows.length} of {total} shown</Muted>
          {rows.map((e) => {
            const st = e.status !== 'ACTIVE' ? e.status : e.approvalStatus;
            const line = [e.supplierName, e.payeeName, e.description].filter(Boolean).join(' · ');
            return (
              <Card key={e.id} style={{ gap: 6, opacity: e.status !== 'ACTIVE' ? 0.6 : 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: th.ink, fontWeight: '700' }}>{e.categoryName}{e.subCategoryName ? <Text style={{ color: th.muted, fontWeight: '400' }}> › {e.subCategoryName}</Text> : null}</Text>
                    <Text style={{ color: th.muted, fontSize: 12 }}>{prettyDate(String(e.businessDate).slice(0, 10))} · {e.locationName} · {e.code}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ color: th.ink, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatINR(e.amount)}</Text>
                    <Chip text={STATUS_LABEL[st] ?? st} tone={approvalTone(st)} />
                  </View>
                </View>
                <Text style={{ color: th.muted, fontSize: 12 }}>{MODE_LABEL[e.paymentMode] ?? e.paymentMode}{line ? ` · ${line}` : ''}</Text>
                <Text style={{ color: th.faint, fontSize: 12 }}>By {e.enteredByName ?? '—'}{e.approvedByName ? ` · approved by ${e.approvedByName}` : ''}</Text>
                {e.approvalStatus === 'REJECTED' && e.rejectionReason ? <Text style={{ color: th.bad.text, fontSize: 12 }}>{e.rejectionReason}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {e.receiptCount > 0 ? <Button small variant="secondary" icon="file-text" title="Receipt" onPress={() => receipt(e.id)} /> : null}
                  {e.approvalStatus === 'SUBMITTED' && e.status === 'ACTIVE' && can('expense:approve') ? (
                    <>
                      <Button small title="✓ Approve" loading={busy === e.id} onPress={() => approve(e.id)} />
                      <Button small variant="danger" title="✕ Reject" disabled={busy !== null} onPress={() => setRejecting(e)} />
                    </>
                  ) : null}
                </View>
              </Card>
            );
          })}
          {rows.length < total ? <Button title="Load more" variant="secondary" onPress={() => setPage((p) => p + 1)} /> : null}
        </>
      )}
      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject · ${rejecting?.code ?? ''}`}>
        <Field label="Reason" required value={reason} onChangeText={setReason} multiline />
        <Button title="Confirm reject" variant="danger" onPress={reject} loading={busy !== null} disabled={!reason.trim()} />
      </Sheet>
    </>
  );
}

const BUCKETS = ['RAW_MATERIAL', 'SALARY', 'RENT', 'ELECTRICITY', 'TRANSPORT', 'MAINTENANCE', 'OTHER', 'NON_PL'];
interface Draft { id?: string; parentId: string; nameEn: string; plBucket: string; receipt: string; requiresSupplier: boolean; active: boolean }

function Categories() {
  const th = useTheme();
  const [cats, setCats] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setCats(await api.get('/expense-categories?includeInactive=true')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const common = { nameEn: draft.nameEn.trim(), plBucket: draft.plBucket, requiresSupplier: draft.parentId ? undefined : draft.requiresSupplier };
      if (draft.id) await api.patch(`/expense-categories/${draft.id}`, { ...common, active: draft.active, requiresReceiptAbove: draft.receipt ? amt(draft.receipt) : null });
      else await api.post('/expense-categories', { ...common, parentId: draft.parentId || undefined, requiresReceiptAbove: draft.receipt ? amt(draft.receipt) : undefined });
      setDraft(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save'); }
    finally { setBusy(false); }
  }

  const top = (cats ?? []).filter((c) => !c.parentId);
  const edit = (c: any) => setDraft({ id: c.id, parentId: c.parentId ?? '', nameEn: c.nameEn, plBucket: c.plBucket, receipt: c.requiresReceiptAbove ?? '', requiresSupplier: c.requiresSupplier, active: c.status === 'ACTIVE' });

  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading title="Categories" />
        <Button small icon="plus" title="Add" onPress={() => { setFormError(null); setDraft({ parentId: '', nameEn: '', plBucket: 'OTHER', receipt: '', requiresSupplier: false, active: true }); }} />
      </View>
      <ErrorBox error={error} />
      {!cats ? <Loading /> : top.map((c) => (
        <Card key={c.id} style={{ gap: 6, opacity: c.status === 'ACTIVE' ? 1 : 0.6 }}>
          <ListRow title={`${c.nameEn}${c.status !== 'ACTIVE' ? ' (inactive)' : ''}`} lines={[`P&L: ${c.plBucket}`, c.requiresReceiptAbove ? `Receipt above ${money(c.requiresReceiptAbove)}` : null, c.requiresSupplier ? 'Supplier required' : null]} onPress={() => { setFormError(null); edit(c); }} />
          {cats.filter((s) => s.parentId === c.id).map((s) => (
            <Text key={s.id} onPress={() => { setFormError(null); edit(s); }} style={{ color: s.status === 'ACTIVE' ? th.ink : th.faint, paddingLeft: 12, paddingVertical: 6 }}>› {s.nameEn}{s.status !== 'ACTIVE' ? ' (inactive)' : ''}</Text>
          ))}
          <Button small variant="secondary" title="+ Sub-category" onPress={() => { setFormError(null); setDraft({ parentId: c.id, nameEn: '', plBucket: c.plBucket, receipt: '', requiresSupplier: false, active: true }); }} />
        </Card>
      ))}
      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit category' : draft?.parentId ? 'New sub-category' : 'New category'}>
        {draft ? (
          <>
            <Field label="Name" required value={draft.nameEn} onChangeText={(v) => setDraft({ ...draft, nameEn: v })} maxLength={80} />
            <Chips label="P&L bucket" value={draft.plBucket} onChange={(v) => setDraft({ ...draft, plBucket: v })} options={BUCKETS.map((b) => ({ value: b, label: b.replace('_', ' ') }))} />
            <MoneyField label="Receipt required above (blank = shop default)" value={draft.receipt} onChange={(v) => setDraft({ ...draft, receipt: v })} />
            {!draft.parentId ? <Chips label="Supplier" value={draft.requiresSupplier ? 'yes' : 'no'} onChange={(v) => setDraft({ ...draft, requiresSupplier: v === 'yes' })} options={[{ value: 'no', label: 'Optional' }, { value: 'yes', label: 'Required' }]} /> : null}
            {draft.id ? <Chips label="Status" value={draft.active ? 'on' : 'off'} onChange={(v) => setDraft({ ...draft, active: v === 'on' })} options={[{ value: 'on', label: 'Active' }, { value: 'off', label: 'Inactive' }]} /> : null}
            <ErrorBox error={formError} />
            <Button title="Save" onPress={save} loading={busy} disabled={!draft.nameEn.trim()} />
          </>
        ) : null}
      </Sheet>
    </>
  );
}
