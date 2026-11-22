import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { Image, Pressable, View } from 'react-native';
import { tAlert } from '@/lib/i18n';
import { Text } from '@/components/Text';
import { CompanyBanner, BIZ_TYPES } from '@/components/super/CompanyBanner';
import { CompanySheet, type Company } from '@/components/super/CompanyForms';
import { CompanyUsers } from '@/components/super/CompanyUsers';
import { Button, ErrorBox, Heading, Loading, Muted, Screen, Sheet } from '@/components/ui';
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
      {/* below the blue header (not under its curve): readable dark title, count, and the add button */}
      <View style={{ marginTop: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Heading title="Companies" sub={rows ? `${rows.length} total` : undefined} />
        </View>
        <Button small icon="plus" title="New company" onPress={() => setAdding(true)} />
      </View>
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Muted>No companies yet. Add the first one.</Muted> : rows.map((c) => (
        <View key={c.id} style={{ borderRadius: 22, overflow: 'hidden', backgroundColor: th.surface, borderWidth: 1, borderColor: th.border, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
          <CompanyBanner c={c} />
          <View style={{ padding: 16, gap: 10 }}>
            <Detail label="Admin" value={c.admin ? `${c.admin.name} · ${c.admin.mobile}` : '—'} />
            <Detail label="Email" value={c.email ?? '—'} />
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <View style={{ flex: 1 }}><Detail label="GSTIN" value={c.gstin ?? '—'} /></View>
              <View style={{ flex: 1 }}><Detail label="FSSAI" value={c.fssai ?? '—'} /></View>
            </View>
            <Detail label="Main shop / head office" value={c.address ?? '—'} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: th.border, paddingTop: 12 }}>
              <Muted>{c.branchCount} {c.branchCount === 1 ? 'branch' : 'branches'}</Muted>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <IconAction label="Users" icon="users" onPress={() => setUsersOf(c)} />
                <IconAction label="Edit company" icon="edit-2" onPress={() => setEditing(c)} />
                <IconAction label={c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} icon={c.status === 'ACTIVE' ? 'slash' : 'check-circle'} tone={c.status === 'ACTIVE' ? 'danger' : 'ok'} busy={busy === c.id} onPress={() => toggle(c)} />
              </View>
            </View>
          </View>
        </View>
      ))}

      <CompanySheet open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />
      <CompanySheet open={!!editing} company={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      <Sheet open={!!usersOf} onClose={() => setUsersOf(null)} title={`Users · ${usersOf?.name ?? ''}`}>
        {usersOf && <CompanyUsers company={usersOf} onChanged={() => void load()} />}
      </Sheet>
    </Screen>
  );
}

/** A round icon button on a company card. */
function IconAction({ label, icon, onPress, tone = 'brand', busy }: { label: string; icon: 'users' | 'edit-2' | 'slash' | 'check-circle'; onPress: () => void; tone?: 'brand' | 'danger' | 'ok'; busy?: boolean }) {
  const th = useTheme();
  const color = tone === 'danger' ? '#b91c1c' : tone === 'ok' ? '#047857' : th.brand;
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={label} style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: th.border, backgroundColor: th.surface, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
      <Feather name={icon} size={18} color={color} />
    </Pressable>
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
