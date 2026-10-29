import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { prettyDate, todayIST } from '@/lib/dates';
import { MODE_LABEL } from '@/lib/labels';
import { amt, dec, formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useBranches } from '@/lib/useLookups';
import { Banner, Button, Card, Chip, Chips, DateStepper, ErrorBox, Field, Heading, ListRow, Loading, Muted, MoneyField, SelectField, Sheet, ToggleRow } from './ui';
import { useDay } from '@/lib/useDate';

const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'] as const;
const money = (v: string | number | null | undefined) => formatINR(v == null ? null : String(v), { decimals: false });

/** Branch picker shared by the panels: fixed for a branch user, a dropdown for office users. */
function useBranchChoice(fixed?: string, allowAll = false) {
  const branches = useBranches();
  const [locationId, setLocationId] = useState(fixed ?? '');
  const picker = fixed ? null : (
    <SelectField label="Branch" value={locationId} onChange={setLocationId} placeholder={allowAll ? 'All branches' : 'Choose a branch…'} options={[...(allowAll ? [{ value: '', label: 'All branches' }] : []), ...branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))]} />
  );
  return { locationId, picker, branches };
}

// ------------------------------------------------------------------ staff list
interface EDraft {
  id?: string; fullName: string; locationId: string; jobRole: string; phone: string; joiningDate: string; exitDate: string;
  salaryType: 'MONTHLY' | 'DAILY'; baseSalary: string; overtimeRatePerHour: string; paymentMethod: string; active: boolean;
  bank: { accountHolder: string; accountNumber: string; ifsc: string; upiId: string };
}

/** The employee roster: name, branch, role and pay terms (bank details are stored encrypted and shown only on request). */
export function EmployeeList({ fixedLocationId }: { fixedLocationId?: string }) {
  const th = useTheme();
  const { can } = useSession();
  const branches = useBranches();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bank, setBank] = useState<any | null | 'loading'>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get(`/employees?includeInactive=true${fixedLocationId ? `&locationId=${fixedLocationId}` : ''}`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [fixedLocationId]);
  useEffect(() => { void load(); }, [load]);

  const blank = (): EDraft => ({ fullName: '', locationId: fixedLocationId ?? '', jobRole: '', phone: '', joiningDate: todayIST(), exitDate: '', salaryType: 'MONTHLY', baseSalary: '', overtimeRatePerHour: '', paymentMethod: 'CASH', active: true, bank: { accountHolder: '', accountNumber: '', ifsc: '', upiId: '' } });
  const fromRow = (r: any): EDraft => ({ id: r.id, fullName: r.fullName, locationId: r.locationId, jobRole: r.jobRole, phone: r.phone ?? '', joiningDate: r.joiningDate.slice(0, 10), exitDate: r.exitDate ? r.exitDate.slice(0, 10) : '', salaryType: r.salaryType, baseSalary: String(r.baseSalary), overtimeRatePerHour: String(r.overtimeRatePerHour), paymentMethod: r.paymentMethod ?? 'CASH', active: r.status === 'ACTIVE', bank: { accountHolder: '', accountNumber: '', ifsc: '', upiId: '' } });

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      const filled = Object.values(draft.bank).some((v) => v.trim());
      const body: Record<string, unknown> = {
        fullName: draft.fullName.trim(), locationId: draft.locationId, jobRole: draft.jobRole.trim(), phone: draft.phone.trim() || undefined,
        salaryType: draft.salaryType, baseSalary: draft.baseSalary, overtimeRatePerHour: draft.overtimeRatePerHour || undefined, paymentMethod: draft.paymentMethod,
        bankDetails: filled ? draft.bank : undefined,
      };
      if (draft.id) await api.patch(`/employees/${draft.id}`, { ...body, exitDate: draft.exitDate || null, active: draft.active });
      else await api.post('/employees', { ...body, joiningDate: draft.joiningDate });
      setDraft(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: any) => d.message).join('; ') : e.message) : 'Could not save'); }
    finally { setBusy(false); }
  }

  async function viewBank(id: string) {
    setBank('loading');
    try { setBank(await api.get(`/employees/${id}/bank-details`)); } catch { setBank(null); }
  }

  const manage = can('staff:manage');
  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading title="Staff" />
        {manage ? <Button small icon="plus" title="Add" onPress={() => { setFormError(null); setDraft(blank()); }} /> : null}
      </View>
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No employees yet.</Muted> : rows.map((r) => (
        <ListRow
          key={r.id} title={r.fullName}
          lines={[`${r.code} · ${r.jobRole}`, branches.find((b) => b.id === r.locationId)?.name, `${r.salaryType === 'DAILY' ? 'Daily' : 'Monthly'} ${money(r.baseSalary)}${r.phone ? ` · ${r.phone}` : ''}`]}
          right={<Chip text={r.status === 'ACTIVE' ? 'Active' : 'Left'} tone={r.status === 'ACTIVE' ? 'ok' : 'neutral'} />}
          onPress={manage ? () => { setFormError(null); setBank(null); setDraft(fromRow(r)); } : undefined}
        />
      ))}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit employee' : 'Add employee'}>
        {draft ? (
          <>
            <Field label="Full name" required value={draft.fullName} onChangeText={(v) => setDraft({ ...draft, fullName: v })} maxLength={100} />
            {!fixedLocationId ? <SelectField label="Branch" required value={draft.locationId} onChange={(v) => setDraft({ ...draft, locationId: v })} options={branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} /> : null}
            <Field label="Job role" required value={draft.jobRole} onChangeText={(v) => setDraft({ ...draft, jobRole: v })} maxLength={50} placeholder="Tea master, Cashier ..." />
            <Field label="Phone" value={draft.phone} onChangeText={(v) => setDraft({ ...draft, phone: v.replace(/[^\d+ -]/g, '') })} keyboardType="phone-pad" />
            <Field label="Joining date (YYYY-MM-DD)" value={draft.joiningDate} editable={!draft.id} onChangeText={(v) => setDraft({ ...draft, joiningDate: v })} placeholder="2026-10-29" />
            <Chips label="Salary type" value={draft.salaryType} onChange={(v) => setDraft({ ...draft, salaryType: v })} options={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'DAILY', label: 'Daily' }]} />
            <MoneyField label={draft.salaryType === 'DAILY' ? 'Daily wage' : 'Monthly salary'} required value={draft.baseSalary} onChange={(v) => setDraft({ ...draft, baseSalary: v })} />
            <MoneyField label="Overtime rate per hour" value={draft.overtimeRatePerHour} onChange={(v) => setDraft({ ...draft, overtimeRatePerHour: v })} />
            <Chips label="Paid by" value={draft.paymentMethod} onChange={(v) => setDraft({ ...draft, paymentMethod: v })} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
            {draft.id ? <Field label="Exit date (blank = still working)" value={draft.exitDate} onChangeText={(v) => setDraft({ ...draft, exitDate: v })} placeholder="YYYY-MM-DD" /> : null}
            {draft.id ? <ToggleRow label="Active" value={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} /> : null}
            <Text style={{ color: th.ink, fontWeight: '700' }}>Bank details (stored encrypted)</Text>
            {draft.id && can('staff:bank_view') ? (
              <>
                {bank === 'loading' ? <Muted>Loading…</Muted> : bank ? <Muted>{[bank.accountHolder, bank.accountNumber, bank.ifsc, bank.upiId].filter(Boolean).join(' · ') || 'None saved'}</Muted> : <Button small variant="secondary" title="Show saved details" onPress={() => viewBank(draft.id!)} />}
              </>
            ) : null}
            <Field label="Account holder" value={draft.bank.accountHolder} onChangeText={(v) => setDraft({ ...draft, bank: { ...draft.bank, accountHolder: v } })} />
            <Field label="Account number" value={draft.bank.accountNumber} onChangeText={(v) => setDraft({ ...draft, bank: { ...draft.bank, accountNumber: v.replace(/\D/g, '') } })} keyboardType="number-pad" />
            <Field label="IFSC" value={draft.bank.ifsc} onChangeText={(v) => setDraft({ ...draft, bank: { ...draft.bank, ifsc: v.toUpperCase() } })} autoCapitalize="characters" />
            <Field label="UPI id" value={draft.bank.upiId} onChangeText={(v) => setDraft({ ...draft, bank: { ...draft.bank, upiId: v } })} autoCapitalize="none" />
            <ErrorBox error={formError} />
            <Button title="Save" onPress={save} loading={busy} disabled={!draft.fullName.trim() || !draft.locationId || !draft.jobRole.trim() || !draft.baseSalary || !/^\d{4}-\d{2}-\d{2}$/.test(draft.joiningDate)} />
          </>
        ) : null}
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ attendance
const STATUSES: Array<[string, string]> = [['PRESENT', 'Present'], ['ABSENT', 'Absent'], ['HALF_DAY', 'Half day'], ['LEAVE', 'Leave'], ['WEEK_OFF', 'Week off'], ['HOLIDAY', 'Holiday']];

/** Mark who was present on a day. Overtime hours can be added for Present / Half day. */
export function AttendancePanel({ fixedLocationId }: { fixedLocationId?: string }) {
  const th = useTheme();
  const { can } = useSession();
  const day = useDay();
  const { locationId, picker } = useBranchChoice(fixedLocationId);
  const [roster, setRoster] = useState<any[] | null>(null);
  const [draft, setDraft] = useState<Record<string, { status: string | null; overtimeHours: string }>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) { setRoster(null); return; }
    try {
      const data = (await api.get(`/attendance/roster?locationId=${locationId}&date=${day.date}`)) as any[];
      setRoster(data); setDraft(Object.fromEntries(data.map((r) => [r.employeeId, { status: r.status, overtimeHours: r.overtimeHours ?? '' }]))); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId, day.date]);
  useEffect(() => { setSaved(false); void load(); }, [load]);

  async function save() {
    if (!roster) return;
    const items = roster.filter((r) => draft[r.employeeId]?.status).map((r) => ({ employeeId: r.employeeId, status: draft[r.employeeId].status, overtimeHours: draft[r.employeeId].overtimeHours || '0' }));
    if (!items.length) return;
    setBusy(true); setError(null);
    try { await api.put('/attendance', { locationId, businessDate: day.date, items }); setSaved(true); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  }

  const canMark = can('attendance:mark');
  return (
    <>
      {picker}
      <DateStepper label={day.label} onPrev={day.prev} onNext={day.next} nextDisabled={day.isToday} />
      <ErrorBox error={error} />
      {!locationId ? <Muted>Choose a branch first.</Muted> : !roster ? <Loading /> : roster.length === 0 ? <Muted>No employees at this branch.</Muted> : (
        <>
          {canMark ? <Button small variant="secondary" title={`✓ Mark all present (${roster.length})`} onPress={() => setDraft((d) => Object.fromEntries(Object.keys(d).map((id) => [id, { ...d[id], status: 'PRESENT' }])))} /> : null}
          {roster.map((r) => {
            const d = draft[r.employeeId] ?? { status: null, overtimeHours: '' };
            return (
              <Card key={r.employeeId} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ color: th.ink, fontWeight: '700' }}>{r.fullName}</Text>
                    <Text style={{ color: th.muted, fontSize: 12 }}>{r.code} · {r.jobRole}</Text>
                  </View>
                  {!d.status ? <Chip text="Not marked" /> : null}
                </View>
                {canMark ? (
                  <Chips value={d.status ?? ''} onChange={(s) => setDraft((x) => ({ ...x, [r.employeeId]: { ...d, status: s } }))} options={STATUSES.map(([v, l]) => ({ value: v, label: l }))} />
                ) : d.status ? <Chip text={STATUSES.find(([v]) => v === d.status)?.[1] ?? d.status} /> : null}
                {canMark && (d.status === 'PRESENT' || d.status === 'HALF_DAY') ? (
                  <Field label="Overtime hours" value={d.overtimeHours} keyboardType="decimal-pad" onChangeText={(v) => setDraft((x) => ({ ...x, [r.employeeId]: { ...d, overtimeHours: v.replace(/[^\d.]/g, '') } }))} placeholder="0" />
                ) : null}
              </Card>
            );
          })}
          {saved ? <Banner tone="ok">✓ Attendance saved</Banner> : null}
          {canMark ? <Button title="Save attendance" onPress={save} loading={busy} /> : null}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ salary
const lastMonths = (n = 6) => {
  const t = todayIST();
  let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m -= 1; if (m === 0) { m = 12; y -= 1; } }
  return out;
};

/** Monthly payroll: calculate, approve and pay. */
export function SalaryPanel() {
  const th = useTheme();
  const { can } = useSession();
  const { locationId, picker } = useBranchChoice(undefined, true);
  const months = lastMonths();
  const [month, setMonth] = useState(months[0]);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paying, setPaying] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState<string>('BANK_TRANSFER');

  const load = useCallback(async () => {
    try { setRows(await api.get(`/salary?month=${month}${locationId ? `&locationId=${locationId}` : ''}`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [month, locationId]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setError(null);
    try { await fn(); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  return (
    <>
      {picker}
      <Chips label="Month" value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: m }))} />
      {locationId && can('salary:manage') ? <Button small variant="secondary" title="Calculate salary for this branch" loading={busy === 'compute'} onPress={() => run('compute', () => api.post('/salary/compute-location', { locationId, month }))} /> : null}
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No salary calculated for this month yet.</Muted> : rows.map((s) => (
        <Card key={s.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: th.ink, fontWeight: '700' }}>{s.employeeName}</Text>
              <Text style={{ color: th.muted, fontSize: 12 }}>{s.employeeCode} · {dec(s.presentDays).toString()} days present</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={{ color: th.ink, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatINR(s.payable)}</Text>
              <Chip text={s.approvalStatus === 'DRAFT' ? 'Draft' : s.approvalStatus === 'APPROVED' ? 'Approved' : s.approvalStatus} tone={s.approvalStatus === 'APPROVED' ? 'ok' : 'neutral'} />
            </View>
          </View>
          <Text style={{ color: th.muted, fontSize: 12 }}>Basic {formatINR(s.basicEarned)} · OT {formatINR(s.overtimeAmount)}{dec(s.advanceRecovery).greaterThan(0) ? ` · advance −${formatINR(s.advanceRecovery)}` : ''}{s.paymentStatus !== 'UNPAID' ? ` · paid ${formatINR(s.paidAmount)}` : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {s.approvalStatus === 'DRAFT' && can('salary:approve') ? <Button small title="Approve" loading={busy === s.id} onPress={() => run(s.id, () => api.post(`/salary/${s.id}/approve`))} /> : null}
            {s.approvalStatus === 'APPROVED' && s.paymentStatus !== 'PAID' && can('salary:pay') ? <Button small title="Pay" onPress={() => { setPayAmount(String(dec(s.payable).minus(s.paidAmount))); setPayMode('BANK_TRANSFER'); setPaying(s); }} /> : null}
          </View>
        </Card>
      ))}

      <Sheet open={!!paying} onClose={() => setPaying(null)} title={`Pay ${paying?.employeeName ?? ''}`}>
        <MoneyField label="Amount" value={payAmount} onChange={setPayAmount} />
        <Chips label="Paid by" value={payMode} onChange={setPayMode} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
        <Button title="Confirm payment" loading={!!busy} disabled={!dec(payAmount || '0').greaterThan(0)} onPress={async () => { await run(paying.id, () => api.post(`/salary/${paying.id}/pay`, { amount: amt(payAmount), paymentMode: payMode })); setPaying(null); }} />
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ advances
const ADV: Record<string, string> = { REQUESTED: 'Requested', MANAGER_APPROVED: 'Manager approved', APPROVED: 'Approved', REJECTED: 'Rejected', PAID: 'Paid', CLOSED: 'Closed', CANCELLED: 'Cancelled' };

/** Advance workflow: request, manager approval, final approval, payment, repayment. */
export function AdvancesPanel({ fixedLocationId }: { fixedLocationId?: string }) {
  const th = useTheme();
  const { can } = useSession();
  const { locationId, picker } = useBranchChoice(fixedLocationId, true);
  const [rows, setRows] = useState<any[] | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [form, setForm] = useState({ employeeId: '', amount: '', reason: '', monthlyRecovery: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [paying, setPaying] = useState<any | null>(null);
  const [payMode, setPayMode] = useState<string>('CASH');
  const [repaying, setRepaying] = useState<any | null>(null);
  const [repayAmount, setRepayAmount] = useState('');

  const load = useCallback(async () => {
    try { setRows(await api.get(`/advances${locationId ? `?locationId=${locationId}` : ''}`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [locationId]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  useEffect(() => {
    if (!locationId) { setEmployees([]); return; }
    api.get(`/employees?locationId=${locationId}`).then((e) => setEmployees(e as any[])).catch(() => setEmployees([]));
  }, [locationId]);

  async function act(id: string, action: string, body?: unknown) {
    setBusy(id); setError(null);
    try { await api.post(`/advances/${id}/${action}`, body); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(null); }
  }
  async function request() {
    setFormError(null); setBusy('new');
    try {
      await api.post('/advances', { employeeId: form.employeeId, amount: amt(form.amount), reason: form.reason.trim(), monthlyRecovery: form.monthlyRecovery ? amt(form.monthlyRecovery) : undefined });
      setRequesting(false); setForm({ employeeId: '', amount: '', reason: '', monthlyRecovery: '' }); await load();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(null); }
  }

  return (
    <>
      {picker}
      {locationId && can('advance:request') ? <Button small icon="plus" title="Request advance" onPress={() => { setFormError(null); setRequesting(true); }} /> : null}
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No advances.</Muted> : rows.map((a) => (
        <Card key={a.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: th.ink, fontWeight: '700' }}>{a.employeeName} <Text style={{ color: th.faint, fontWeight: '400', fontSize: 12 }}>{a.code}</Text></Text>
              <Text style={{ color: th.muted, fontSize: 12 }}>{prettyDate(a.requestDate.slice(0, 10))} · {a.reason}</Text>
            </View>
            <Chip text={ADV[a.status] ?? a.status} tone={a.status === 'REJECTED' || a.status === 'CANCELLED' ? 'bad' : a.status === 'PAID' || a.status === 'CLOSED' || a.status === 'APPROVED' ? 'ok' : 'warn'} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Muted small>Amount {formatINR(a.amount)}</Muted><Muted small>Paid {formatINR(a.paidAmount)}</Muted><Muted small>Left {formatINR(a.remainingAmount)}</Muted>
          </View>
          {a.rejectionReason ? <Text style={{ color: th.bad.text, fontSize: 12 }}>✕ {a.rejectionReason}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {a.status === 'REQUESTED' && can('advance:manager_approve') ? <Button small title="Manager approve" loading={busy === a.id} onPress={() => act(a.id, 'manager-approve')} /> : null}
            {a.status === 'MANAGER_APPROVED' && can('advance:approve') ? <Button small title="Final approve" loading={busy === a.id} onPress={() => act(a.id, 'approve')} /> : null}
            {(a.status === 'REQUESTED' || a.status === 'MANAGER_APPROVED') && (can('advance:manager_approve') || can('advance:approve')) ? <Button small variant="danger" title="Reject" onPress={() => { setReason(''); setRejecting(a); }} /> : null}
            {a.status === 'REQUESTED' && can('advance:request') ? <Button small variant="secondary" title="Cancel" onPress={() => act(a.id, 'cancel', {})} /> : null}
            {a.status === 'APPROVED' && can('advance:pay') ? <Button small title="Pay" onPress={() => { setPayMode('CASH'); setPaying(a); }} /> : null}
            {a.status === 'PAID' && dec(a.remainingAmount).greaterThan(0) && can('advance:pay') ? <Button small variant="secondary" title="Repay" onPress={() => { setRepayAmount(String(a.remainingAmount)); setRepaying(a); }} /> : null}
          </View>
        </Card>
      ))}

      <Sheet open={requesting} onClose={() => setRequesting(false)} title="Request advance">
        <SelectField label="Employee" required value={form.employeeId} onChange={(v) => setForm({ ...form, employeeId: v })} options={employees.map((e) => ({ value: e.id, label: `${e.fullName} (${e.code})` }))} />
        <MoneyField label="Amount" required value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
        <Field label="Reason" required value={form.reason} onChangeText={(v) => setForm({ ...form, reason: v })} multiline />
        <MoneyField label="Monthly recovery (optional)" value={form.monthlyRecovery} onChange={(v) => setForm({ ...form, monthlyRecovery: v })} />
        <ErrorBox error={formError} />
        <Button title="Submit request" loading={busy === 'new'} disabled={!form.employeeId || !form.amount || !form.reason.trim()} onPress={request} />
      </Sheet>
      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title="Reject advance">
        <Field label="Reason" required value={reason} onChangeText={setReason} multiline />
        <Button title="Confirm reject" variant="danger" disabled={!reason.trim()} onPress={async () => { await act(rejecting.id, 'reject', { reason }); setRejecting(null); }} />
      </Sheet>
      <Sheet open={!!paying} onClose={() => setPaying(null)} title="Pay advance">
        <Muted>{paying ? formatINR(paying.amount) : ''}</Muted>
        <Chips label="Paid by" value={payMode} onChange={setPayMode} options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
        <Button title="Confirm" onPress={async () => { await act(paying.id, 'pay', { paymentMode: payMode }); setPaying(null); }} />
      </Sheet>
      <Sheet open={!!repaying} onClose={() => setRepaying(null)} title="Record repayment">
        <MoneyField label="Amount" value={repayAmount} onChange={setRepayAmount} />
        <Button title="Confirm" disabled={!dec(repayAmount || '0').greaterThan(0)} onPress={async () => { await act(repaying.id, 'repay', { amount: amt(repayAmount) }); setRepaying(null); }} />
      </Sheet>
    </>
  );
}
