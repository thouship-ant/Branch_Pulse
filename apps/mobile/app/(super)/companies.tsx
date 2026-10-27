import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Chip, ErrorBox, Heading, Loading, Muted, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useTheme } from '@/lib/theme';

/** The Super Admin's company list, with activate / deactivate. (Creating a company and uploading ledger data are done on the web.) */
export default function CompaniesScreen() {
  const th = useTheme();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get('/super/companies')); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function toggle(c: any) {
    const next = c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    Alert.alert(
      `${next === 'INACTIVE' ? 'Deactivate' : 'Activate'} ${c.name}?`,
      next === 'INACTIVE' ? 'Nobody in this company will be able to sign in until it is activated again.' : 'Its users will be able to sign in again.',
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
      <Heading title="Companies" sub={rows ? `${rows.length} total` : undefined} />
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No companies yet. Create the first one from the web app.</Muted> : rows.map((c) => (
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Muted>{c.branchCount} {c.branchCount === 1 ? 'branch' : 'branches'}</Muted>
            <Button small variant="secondary" title={c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} loading={busy === c.id} onPress={() => toggle(c)} />
          </View>
        </Card>
      ))}
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
