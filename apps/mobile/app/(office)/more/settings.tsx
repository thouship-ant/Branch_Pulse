import { useCallback, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Banner, Button, Card, Chips, ErrorBox, Field, Heading, ListRow, Loading, Muted, MultiChips, MoneyField, Screen, SectionTitle, SegTabs, Sheet, ToggleRow } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { amt } from '@/lib/money';
import { useTheme } from '@/lib/theme';

type Tab = 'general' | 'limits' | 'roles' | 'units';

/** Admin: shop-wide rules, approval limits, roles and permissions, units of measure. */
export default function SettingsScreen() {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <Screen title="Settings">
      <SegTabs value={tab} onChange={setTab} tabs={[{ key: 'general', label: 'General' }, { key: 'limits', label: 'Approval limits' }, { key: 'roles', label: 'Roles' }, { key: 'units', label: 'Units' }]} />
      {tab === 'general' ? <General /> : tab === 'limits' ? <Limits /> : tab === 'roles' ? <Roles /> : <Units />}
    </Screen>
  );
}

// ------------------------------------------------------------------ general
type Kind = 'string' | 'number' | 'boolean' | 'business_type' | 'time';
interface F { key: string; label: string; kind: Kind }
const GROUPS: Array<{ title: string; fields: F[] }> = [
  { title: 'Business', fields: [
    { key: 'business.name', label: 'Business name', kind: 'string' }, { key: 'business.type', label: 'Business type', kind: 'business_type' },
    { key: 'fy.start_month', label: 'Financial year starts in month (1-12)', kind: 'number' }, { key: 'branch.code_prefix', label: 'Branch code prefix', kind: 'string' },
    { key: 'entry.backdate_days', label: 'Back-dating allowed (days)', kind: 'number' }, { key: 'transliteration.external', label: 'Use online Tamil transliteration', kind: 'boolean' },
  ] },
  { title: 'Variance and wastage', fields: [
    { key: 'cash.variance_threshold', label: 'Cash difference needing approval (₹)', kind: 'number' }, { key: 'stock.variance_pct_default', label: 'Stock variance alert (%)', kind: 'number' },
    { key: 'wastage.high_pct_of_sales', label: 'High wastage (% of sales)', kind: 'number' }, { key: 'wastage.high_single_entry', label: 'High single wastage entry (₹)', kind: 'number' },
    { key: 'wastage.photo_above', label: 'Wastage photo required above (₹)', kind: 'number' },
  ] },
  { title: 'Closing and entries', fields: [
    { key: 'closing.cutoff_time', label: 'Closing cut-off time (HH:MM)', kind: 'time' }, { key: 'sales.mismatch_tolerance', label: 'Sales split mismatch tolerance (₹)', kind: 'number' },
    { key: 'sales.unusual_pct', label: 'Unusual sales change (%)', kind: 'number' }, { key: 'expense.receipt_above', label: 'Expense receipt required above (₹)', kind: 'number' },
    { key: 'expense.unusual_multiple', label: 'Unusual expense (× category average)', kind: 'number' }, { key: 'purchase.rate_deviation_pct', label: 'Purchase rate deviation (%)', kind: 'number' },
    { key: 'advance.max_multiple', label: 'Advance limit (× monthly salary)', kind: 'number' },
  ] },
  { title: 'Alerts', fields: [
    { key: 'alerts.supplier_due_days_before', label: 'Supplier due reminder (days before)', kind: 'number' }, { key: 'alerts.approval_pending_hours', label: 'Approval pending alert (hours)', kind: 'number' },
    { key: 'alerts.advance_pending_hours', label: 'Advance pending alert (hours)', kind: 'number' },
  ] },
];
const BIZ = [{ value: 'TEA_SHOP', label: 'Tea shop' }, { value: 'HOTEL', label: 'Hotel' }, { value: 'BAKERY', label: 'Bakery' }, { value: 'OTHER', label: 'Other' }];
// GET camel-cases each key part (fy.start_month -> fy.startMonth); PUT takes the raw key
const responseKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function General() {
  const th = useTheme();
  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => { try { setValues(await api.get('/settings')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); } }, []);
  useEffect(() => { void load(); }, [load]);

  /** Saves one field when the user leaves it. A bad value stays with its error beneath. */
  async function save(f: F, raw: string | undefined = edits[f.key]) {
    if (!values || raw === undefined || busyKey === f.key) return;
    const current = values[responseKey(f.key)];
    const drop = () => setEdits((e) => { const n = { ...e }; delete n[f.key]; return n; });
    if (raw === String(typeof current === 'boolean' ? current : current ?? '')) { drop(); return; }
    if (f.kind !== 'boolean' && raw.trim() === '') { setErrors((e) => ({ ...e, [f.key]: 'Required' })); return; }
    if (f.kind === 'number' && Number.isNaN(Number(raw))) { setErrors((e) => ({ ...e, [f.key]: 'Enter a number' })); return; }
    const value: unknown = f.kind === 'number' ? Number(raw) : f.kind === 'boolean' ? raw === 'true' : f.kind === 'string' ? raw.trim() : raw;
    setBusyKey(f.key);
    try {
      await api.put(`/settings/${f.key}`, { value });
      drop(); setErrors((e) => { const n = { ...e }; delete n[f.key]; return n; });
      setNotice('Saved'); setTimeout(() => setNotice(null), 2000);
      await load();
    } catch (e) { setErrors((x) => ({ ...x, [f.key]: e instanceof ApiError ? e.message : 'Could not save' })); }
    finally { setBusyKey(null); }
  }

  if (!values) return error ? <ErrorBox error={error} /> : <Loading />;
  return (
    <>
      {notice ? <Banner tone="ok">✓ {notice}</Banner> : null}
      <ErrorBox error={error} />
      {GROUPS.map((g) => (
        <Card key={g.title}>
          <SectionTitle>{g.title}</SectionTitle>
          {g.fields.map((f) => {
            const cur = values[responseKey(f.key)];
            const shown = edits[f.key] ?? (cur == null ? '' : String(cur));
            if (f.kind === 'boolean') {
              return (
                <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: th.ink, flex: 1 }}>{f.label}</Text>
                  <Switch value={cur === true} onValueChange={(v) => save(f, String(v))} trackColor={{ true: th.brand }} />
                </View>
              );
            }
            if (f.kind === 'business_type') {
              return <Chips key={f.key} label={f.label} value={shown} onChange={(v) => save(f, v)} options={BIZ} />;
            }
            return (
              <Field
                key={f.key} label={f.label} value={shown} error={errors[f.key]} keyboardType={f.kind === 'number' ? 'decimal-pad' : 'default'}
                onChangeText={(v) => { setEdits((e) => ({ ...e, [f.key]: v })); setErrors((e) => { const n = { ...e }; delete n[f.key]; return n; }); }}
                onBlur={() => void save(f)} onSubmitEditing={() => void save(f)}
              />
            );
          })}
        </Card>
      ))}
      <Muted small>Each value saves when you leave the field.</Muted>
    </>
  );
}

// ------------------------------------------------------------------ approval limits
const ENTITY_TYPES = [['EXPENSE', 'Expense'], ['PURCHASE', 'Purchase'], ['ADVANCE', 'Advance'], ['WASTAGE', 'Wastage'], ['CASH_VARIANCE', 'Cash variance']] as const;

function Limits() {
  const [limits, setLimits] = useState<any[] | null>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [l, r] = await Promise.all([api.get('/approval-limits'), api.get('/roles')]); setLimits(l); setRoles(r); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(roleCode: string, entityType: string) {
    const key = `${roleCode}:${entityType}`;
    const value = edits[key];
    if (value === undefined) return;
    const existing = limits?.find((l) => l.roleCode === roleCode && l.entityType === entityType)?.maxAmount;
    const clear = () => setEdits((e) => { const n = { ...e }; delete n[key]; return n; });
    if (value !== '' && existing != null && Number(value) === Number(existing)) { clear(); return; }
    const maxAmount = value === '' ? undefined : amt(value);
    if (maxAmount === undefined) { setErrors((e) => ({ ...e, [key]: 'Enter an amount' })); return; }
    try {
      await api.put('/approval-limits', { roleCode, entityType, maxAmount });
      clear(); setNotice('Saved'); setTimeout(() => setNotice(null), 2000); await load();
    } catch (e) { setErrors((x) => ({ ...x, [key]: e instanceof ApiError ? e.message : 'Could not save' })); }
  }

  if (!limits) return error ? <ErrorBox error={error} /> : <Loading />;
  return (
    <>
      <Muted>The most a role can approve on its own for each type. Anything above needs the next approver.</Muted>
      {notice ? <Banner tone="ok">✓ {notice}</Banner> : null}
      {roles.filter((r) => r.status === 'ACTIVE' && r.code !== 'SUPER_ADMIN').map((r) => (
        <Card key={r.id}>
          <SectionTitle>{r.name}</SectionTitle>
          {ENTITY_TYPES.map(([type, label]) => {
            const key = `${r.code}:${type}`;
            const cur = limits.find((l) => l.roleCode === r.code && l.entityType === type)?.maxAmount;
            return (
              <MoneyField
                key={key} label={label} value={edits[key] ?? (cur == null ? '' : String(Number(cur)))}
                onChange={(v) => { setEdits((e) => ({ ...e, [key]: v })); setErrors((e) => { const n = { ...e }; delete n[key]; return n; }); }}
                hint={errors[key]}
              />
            );
          })}
          <Button small variant="secondary" title="Save limits" onPress={async () => { for (const [type] of ENTITY_TYPES) await save(r.code, type); }} />
        </Card>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ roles
function Roles() {
  const th = useTheme();
  const [roles, setRoles] = useState<any[] | null>(null);
  const [perms, setPerms] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<{ code: string; name: string; scopeMode: 'ALL' | 'ASSIGNED' } | null>(null);

  const load = useCallback(async () => {
    try { const [r, p] = await Promise.all([api.get('/roles'), api.get('/permissions')]); setRoles(r); setPerms(p); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byModule = perms.reduce<Record<string, any[]>>((acc, p) => { (acc[p.module] ??= []).push(p); return acc; }, {});
  const openRole = roles?.find((r) => r.id === openId);

  async function savePerms() {
    if (!openId) return;
    setBusy(true); setFormError(null);
    try { await api.put(`/roles/${openId}/permissions`, { permissionCodes: selected }); setOpenId(null); await load(); } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }
  async function toggleActive(r: any) {
    setBusy(true);
    try { await api.patch(`/roles/${r.id}`, { status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }
  async function createRole() {
    if (!newRole) return;
    setBusy(true); setFormError(null);
    try { await api.post('/roles', { code: newRole.code.trim().toUpperCase(), name: newRole.name.trim(), scopeMode: newRole.scopeMode }); setNewRole(null); await load(); } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }

  if (!roles) return error ? <ErrorBox error={error} /> : <Loading />;
  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading title="Roles" />
        <Button small icon="plus" title="Add role" onPress={() => { setFormError(null); setNewRole({ code: '', name: '', scopeMode: 'ASSIGNED' }); }} />
      </View>
      <ErrorBox error={error} />
      {roles.map((r) => (
        <ListRow
          key={r.id} title={`${r.name}${r.status !== 'ACTIVE' ? ' (inactive)' : ''}`}
          lines={[`${r.code}${r.isSystem ? ' · system role' : ''}`, `${r.permissions.length} permissions · ${r.userCount} users · ${r.scopeMode === 'ALL' ? 'all branches' : 'assigned branches'}`]}
          onPress={() => { setFormError(null); setOpenId(r.id); setSelected(r.permissions); }}
        />
      ))}

      <Sheet open={!!openRole} onClose={() => setOpenId(null)} title={openRole?.name ?? 'Role'}>
        {openRole ? (
          <>
            {Object.entries(byModule).map(([mod, list]) => (
              <View key={mod} style={{ gap: 4 }}>
                <Text style={{ color: th.ink, fontWeight: '800' }}>{mod[0].toUpperCase() + mod.slice(1)}</Text>
                {list.map((p) => <ToggleRow key={p.code} label={p.description ?? p.code} value={selected.includes(p.code)} onChange={(on) => setSelected((s) => (on ? [...s, p.code] : s.filter((c) => c !== p.code)))} />)}
              </View>
            ))}
            <ErrorBox error={formError} />
            <Button title="Save permissions" onPress={savePerms} loading={busy} />
            {!openRole.isSystem ? <Button title={openRole.status === 'ACTIVE' ? 'Deactivate role' : 'Activate role'} variant="secondary" onPress={() => toggleActive(openRole)} /> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet open={!!newRole} onClose={() => setNewRole(null)} title="New role">
        {newRole ? (
          <>
            <Field label="Code" required value={newRole.code} onChangeText={(v) => setNewRole({ ...newRole, code: v.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 30) })} autoCapitalize="characters" />
            <Field label="Name" required value={newRole.name} onChangeText={(v) => setNewRole({ ...newRole, name: v })} maxLength={60} />
            <Chips label="Branch access" value={newRole.scopeMode} onChange={(v) => setNewRole({ ...newRole, scopeMode: v })} options={[{ value: 'ASSIGNED', label: 'Assigned branches' }, { value: 'ALL', label: 'All branches' }]} />
            <ErrorBox error={formError} />
            <Button title="Create" onPress={createRole} loading={busy} disabled={!newRole.code.trim() || !newRole.name.trim()} />
          </>
        ) : null}
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------------ units
interface Draft { id?: string; code: string; name: string; baseUnitId: string; factorToBase: string }

function Units() {
  const [units, setUnits] = useState<any[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setUnits(await api.get('/units')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null);
    try {
      if (draft.id) await api.patch(`/units/${draft.id}`, { name: draft.name.trim(), factorToBase: draft.baseUnitId ? draft.factorToBase : undefined });
      else await api.post('/units', { code: draft.code.trim().toUpperCase(), name: draft.name.trim(), baseUnitId: draft.baseUnitId || undefined, factorToBase: draft.baseUnitId ? draft.factorToBase : undefined });
      setDraft(null); await load();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Could not save'); } finally { setBusy(false); }
  }

  if (!units) return error ? <ErrorBox error={error} /> : <Loading />;
  const bases = units.filter((u) => !u.baseUnitId);
  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading title="Units" />
        <Button small icon="plus" title="Add" onPress={() => { setFormError(null); setDraft({ code: '', name: '', baseUnitId: '', factorToBase: '1' }); }} />
      </View>
      <Muted small>Units are shared by every company on the platform.</Muted>
      {units.map((u) => {
        const base = units.find((b) => b.id === u.baseUnitId);
        return <ListRow key={u.id} title={`${u.code} · ${u.name}`} lines={[base ? `1 ${u.code} = ${u.factorToBase} ${base.code}` : 'Base unit']} onPress={() => { setFormError(null); setDraft({ id: u.id, code: u.code, name: u.name, baseUnitId: u.baseUnitId ?? '', factorToBase: u.factorToBase }); }} />;
      })}
      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit unit' : 'Add unit'}>
        {draft ? (
          <>
            <Field label="Code" value={draft.code} editable={!draft.id} onChangeText={(v) => setDraft({ ...draft, code: v.toUpperCase().slice(0, 10) })} autoCapitalize="characters" />
            <Field label="Name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} maxLength={30} />
            {!draft.id ? <Chips label="Base unit (blank = this is a base unit)" value={draft.baseUnitId} onChange={(v) => setDraft({ ...draft, baseUnitId: v })} options={[{ value: '', label: 'None' }, ...bases.map((b) => ({ value: b.id, label: `${b.code}` }))]} /> : null}
            {draft.baseUnitId ? <Field label="Factor to base" value={draft.factorToBase} onChangeText={(v) => setDraft({ ...draft, factorToBase: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" /> : null}
            <ErrorBox error={formError} />
            <Button title="Save" onPress={save} loading={busy} disabled={!draft.code.trim() || !draft.name.trim()} />
          </>
        ) : null}
      </Sheet>
    </>
  );
}
