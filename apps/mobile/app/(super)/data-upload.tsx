import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Banner, Button, Card, ErrorBox, Field, Heading, Loading, Muted, Screen, SelectField } from '@/components/ui';
import { api, ApiError, downloadAndShare } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useTheme } from '@/lib/theme';

interface Company { id: string; code: string; name: string; status: string }
interface Branch { id: string; code: string; name: string }
interface Issue { sheet: string; row: number; message: string }
interface Result {
  dryRun: boolean;
  company: { name: string };
  branch: { id: string | null; code: string | null; name: string; isNew: boolean };
  ledgerDate: string | null;
  expenses: { count: number; total: string; skipped: number; rows: Array<{ row: number; date: string; category: string; subCategory: string; amount: string; mode: string; description: string; note?: string }> };
  staff: { count: number; total: string; skipped: number; newEmployees: string[] };
  opening: { cash: string | null; applied: boolean };
  sales: { date: string; total: string } | null;
  errors: Issue[];
  warnings: Issue[];
}

const NEW = 'NEW';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Super Admin: load a ledger workbook into one company's branch (check the file first, then import). */
export default function DataUploadScreen() {
  const th = useTheme();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(NEW);
  const [nb, setNb] = useState({ name: '', address: '', manager: '', mobile: '' });
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | 'sample' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api.get<Company[]>('/super/companies').then(setCompanies).catch((e) => setError(e.message));
  }, []);

  // the branch list follows the company; "New Branch" is always the first choice
  useEffect(() => {
    setBranchId(NEW); setBranches([]); setResult(null); setDone(null);
    if (!companyId) return;
    api.get<Branch[]>(`/super/companies/${companyId}/branches`).then(setBranches).catch((e) => setError(e.message));
  }, [companyId]);

  const isNew = branchId === NEW;
  const branchReady = !isNew || (nb.name.trim() && nb.address.trim() && nb.manager.trim() && /^\d{10}$/.test(nb.mobile));
  const ready = !!companyId && !!file && !!branchReady;
  const touch = () => { setResult(null); setDone(null); };

  async function chooseFile() {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: [XLSX, 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets[0]) return;
      if (!/\.xlsx$/i.test(r.assets[0].name)) { setError('Choose an Excel (.xlsx) file'); return; }
      setError(null); setFile(r.assets[0]); touch();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open the file'); }
  }

  async function form(dryRun: boolean) {
    const f = new FormData();
    if (Platform.OS === 'web') f.append('file', (file as any).file ?? (await (await fetch(file!.uri)).blob()), file!.name);
    else f.append('file', { uri: file!.uri, name: file!.name, type: file!.mimeType ?? XLSX } as any);
    f.append('companyId', companyId);
    f.append('branchId', branchId);
    f.append('dryRun', String(dryRun));
    if (isNew) {
      f.append('newBranchName', nb.name.trim());
      f.append('newBranchAddress', nb.address.trim());
      f.append('managerName', nb.manager.trim());
      f.append('managerMobile', nb.mobile);
    }
    return f;
  }

  async function run(dryRun: boolean) {
    if (!ready || busy) return;
    setBusy(dryRun ? 'preview' : 'import'); setError(null); setDone(null);
    try {
      const r = await api.postForm<Result>('/super/data-upload', await form(dryRun));
      if (dryRun) setResult(r);
      else {
        setResult(null); setFile(null);
        setDone(`Imported ${r.expenses.count} expense${r.expenses.count === 1 ? '' : 's'} and ${r.staff.count} staff payment${r.staff.count === 1 ? '' : 's'} into ${r.branch.name} (${r.branch.code ?? 'new branch'}). They are waiting for approval in ${r.company.name}.`);
        if (isNew) api.get<Branch[]>(`/super/companies/${companyId}/branches`).then((b) => { setBranches(b); setBranchId(r.branch.id ?? NEW); });
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IMPORT_HAS_ERRORS' && Array.isArray(e.details)) setError(`${e.message}\n${(e.details as Issue[]).map((i) => `${i.sheet} row ${i.row}: ${i.message}`).join('\n')}`);
      else setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally { setBusy(null); }
  }

  async function sample() {
    setBusy('sample'); setError(null);
    try { await downloadAndShare('/super/sample-ledger', 'tea_shop_ledger_sample.xlsx', XLSX); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not download the sample'); }
    finally { setBusy(null); }
  }

  const blocked = !!result && result.errors.length > 0;
  const empty = !!result && result.expenses.count === 0 && result.staff.count === 0 && !result.sales;
  const branchOptions = [{ value: NEW, label: 'New Branch' }, ...branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))];

  return (
    <Screen>
      <Heading title="Company - Data Upload" sub="Rows arrive as pending records for the company to approve" />
      <Button small variant="secondary" icon="download" title="Download sample Excel" onPress={sample} loading={busy === 'sample'} />

      <ErrorBox error={error} />
      {done ? <Banner tone="ok">✓ {done}</Banner> : null}

      <Card>
        {!companies ? <Loading /> : (
          <>
            <SelectField
              label="Company" required value={companyId} onChange={setCompanyId} placeholder="Select company…"
              options={companies.filter((c) => c.status === 'ACTIVE').map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            />
            <SelectField label="Branch" required value={branchId} onChange={(v) => { setBranchId(v); touch(); }} options={branchOptions} disabled={!companyId} />
          </>
        )}

        {companyId && isNew ? (
          <View style={{ gap: 12, backgroundColor: th.neutral.bg, borderRadius: 14, padding: 12 }}>
            <Text style={{ color: th.ink, fontWeight: '700' }}>New branch details</Text>
            <Field label="Branch name" required value={nb.name} onChangeText={(v) => { setNb({ ...nb, name: v }); touch(); }} maxLength={100} />
            <Field label="Branch address" required value={nb.address} onChangeText={(v) => { setNb({ ...nb, address: v }); touch(); }} maxLength={500} />
            <Field label="Manager's name" required value={nb.manager} onChangeText={(v) => { setNb({ ...nb, manager: v }); touch(); }} maxLength={100} />
            <Field label="Manager's mobile number" required value={nb.mobile} onChangeText={(v) => { setNb({ ...nb, mobile: v.replace(/\D/g, '').slice(0, 10) }); touch(); }} keyboardType="number-pad" placeholder="10 digits" />
            <Muted small>The manager signs in with this number and an OTP. The default password is Manager@1234 (changed at the first sign-in).</Muted>
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <Text style={{ color: th.muted, fontSize: 13, fontWeight: '600' }}>Excel file (.xlsx) <Text style={{ color: th.bad.text }}>*</Text></Text>
          <Button small variant="secondary" icon="file" title={file ? file.name : 'Choose file'} onPress={chooseFile} />
          <Muted small>Uses the sheets Expenses, Staff_Payments and Daily_Closing, and the ledger date on README. The sample shows the layout.</Muted>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button title="Check file" variant="secondary" style={{ flex: 1 }} onPress={() => run(true)} loading={busy === 'preview'} disabled={!ready || !!busy} />
          <Button title="Import" style={{ flex: 1 }} onPress={() => run(false)} loading={busy === 'import'} disabled={!ready || !!busy || !result || blocked || empty} />
        </View>
      </Card>

      {result ? (
        <Card>
          <Text style={{ color: th.ink, fontWeight: '700', fontSize: 16 }}>
            Preview · {result.company.name} · {result.branch.isNew ? `New branch: ${result.branch.name}` : `${result.branch.code} · ${result.branch.name}`}
          </Text>
          <Muted>{result.ledgerDate ? `Ledger date ${prettyDate(result.ledgerDate)}` : 'No ledger date'}</Muted>

          <Stat label="Expenses" value={String(result.expenses.count)} sub={formatINR(result.expenses.total)} note={result.expenses.skipped ? `${result.expenses.skipped} already imported` : undefined} />
          <Stat label="Staff payments" value={String(result.staff.count)} sub={formatINR(result.staff.total)} note={result.staff.newEmployees.length ? `${result.staff.newEmployees.length} new staff record(s)` : undefined} />
          <Stat
            label="Opening cash" value={result.opening.cash ? formatINR(result.opening.cash) : '—'} sub={result.opening.applied ? 'will be set for the branch' : 'unchanged'}
            note={result.sales ? `Sales ${formatINR(result.sales.total)} on ${prettyDate(result.sales.date)}` : undefined}
          />

          {result.errors.length > 0 ? <Banner tone="bad">Fix these before importing:{'\n'}{result.errors.map((i) => `• ${i.sheet}${i.row ? ` row ${i.row}` : ''}: ${i.message}`).join('\n')}</Banner> : null}
          {result.warnings.length > 0 ? <Banner tone="warn">Check these (they will still import):{'\n'}{result.warnings.map((i) => `• ${i.sheet}${i.row ? ` row ${i.row}` : ''}: ${i.message}`).join('\n')}</Banner> : null}
          {empty && result.errors.length === 0 ? <Muted>Nothing new to import from this file.</Muted> : null}

          {result.expenses.rows.slice(0, 30).map((r) => (
            <View key={r.row} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: th.ink }}>{r.category}{r.subCategory ? ` › ${r.subCategory}` : ''}{r.note ? ' ⚠' : ''}</Text>
                <Text style={{ color: th.muted, fontSize: 12 }}>{prettyDate(r.date)} · {r.mode}{r.description ? ` · ${r.description}` : ''}</Text>
              </View>
              <Text style={{ color: th.ink, fontVariant: ['tabular-nums'] }}>{formatINR(r.amount)}</Text>
            </View>
          ))}
          {result.expenses.rows.length > 30 ? <Muted small>… and {result.expenses.rows.length - 30} more expense rows</Muted> : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value, sub, note }: { label: string; value: string; sub: string; note?: string }) {
  const th = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: th.border, borderRadius: 14, padding: 12 }}>
      <Text style={{ color: th.muted, fontSize: 12, fontWeight: '700' }}>{label.toUpperCase()}</Text>
      <Text style={{ color: th.ink, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: th.muted, fontSize: 13 }}>{sub}</Text>
      {note ? <Text style={{ color: th.faint, fontSize: 12, marginTop: 2 }}>{note}</Text> : null}
    </View>
  );
}
