import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { tAlert } from '@/lib/i18n';
import { Text } from '@/components/Text';
import { CreateCompanyForm, EditCompanyForm, type Company } from '@/components/super/CompanyForms';
import { CompanyUsers } from '@/components/super/CompanyUsers';
import { Button, Card, Chip, ErrorBox, Heading, Loading, Muted, Screen, Sheet } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useTheme } from '@/lib/theme';

/** Super Admin: every company on the platform. Add one, edit its details, manage its users, activate / deactivate. */
export default function CompaniesScreen() {
  const th = useTheme();
  const [rows, setRows] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [usersOf, setUsersOf] = useState<Company | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get('/super/companies')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function toggle(c: Company) {
    const next = c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    tAlert(
      `${next === 'INACTIVE' ? 'Deactivate' : 'Activate'} ${c.name}?`,
      next === 'INACTIVE' ? 'Nobody in this company will be able to sign in until it is activated again. Their data is kept.' : 'Its users will be able to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next === 'INACTIVE' ? 'Deactivate' : 'Activate', style: next === 'INACTIVE' ? 'destructive' : 'default',
          onPress: async () => {
            setBusy(c.id);
            try { await api.patch(`/super/companies/${c.id}`, { status: next }); await load(); }
            catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); }
            finally { setBusy(null); }
          },
        },
      ],
    );
  }

  return (
    <Screen onRefresh={load}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <Heading title="Companies" sub={rows ? `${rows.length} total` : undefined} />
        <Button small icon="plus" title="New company" onPress={() => setAdding(true)} />
      </View>
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No companies yet. Add the first one.</Muted> : rows.map((c) => (
        <Card key={c.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: th.faint, fontSize: 12 }}>{c.code}</Text>
              <Text style={{ color: th.ink, fontSize: 18, fontWeight: '700' }}>{c.name}</Text>
            </View>
            <Chip text={c.status === 'ACTIVE' ? 'Active' : 'Inactive'} tone={c.status === 'ACTIVE' ? 'ok' : 'neutral'} icon={c.status === 'ACTIVE' ? '●' : '○'} />
          </View>
          <Detail label="Admin" value={c.admin ? `${c.admin.name} · ${c.admin.mobile}` : '—'} />
          <Detail label="Email" value={c.email ?? '—'} />
          <Detail label="GSTIN" value={c.gstin ?? '—'} />
          <Detail label="FSSAI" value={c.fssai ?? '—'} />
          <Detail label="Main shop / head office" value={c.address ?? '—'} />
          <Muted>{c.branchCount} {c.branchCount === 1 ? 'branch' : 'branches'}</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button small variant="secondary" title="Users" onPress={() => setUsersOf(c)} />
            <Button small variant="secondary" title="Edit" onPress={() => setEditing(c)} />
            <Button small variant="secondary" title={c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} loading={busy === c.id} onPress={() => toggle(c)} />
          </View>
        </Card>
      ))}

      <Sheet open={adding} onClose={() => setAdding(false)} title="New company">
        <CreateCompanyForm onSaved={() => { setAdding(false); void load(); }} />
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? 'company'}`}>
        {editing && <EditCompanyForm company={editing} onSaved={() => { setEditing(null); void load(); }} />}
      </Sheet>
      <Sheet open={!!usersOf} onClose={() => setUsersOf(null)} title={`Users · ${usersOf?.name ?? ''}`}>
        {usersOf && <CompanyUsers company={usersOf} onChanged={() => void load()} />}
      </Sheet>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const th = useTheme();
  return (
    <View>
      <Text style={{ color: th.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: th.ink, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}
