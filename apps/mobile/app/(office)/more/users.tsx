import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { PasswordChecklist } from '@/components/PasswordChecklist';
import { Banner, Button, Chip, ErrorBox, Field, ListRow, Loading, Muted, MultiChips, Screen, Sheet, ToggleRow } from '@/components/ui';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { roleLabel } from '@/lib/labels';
import { passwordOk } from '@/lib/password';
import { useTheme } from '@/lib/theme';

interface User { id: string; username: string; fullName: string; mobile: string | null; email: string | null; status: string; lastLoginAt: string | null; roles: string[]; locationIds: string[] }
interface Draft { id?: string; fullName: string; mobile: string; email: string; password: string; roleCodes: string[]; locationIds: string[]; active: boolean }
const EMPTY: Draft = { fullName: '', mobile: '', email: '', password: '', roleCodes: [], locationIds: [], active: true };

/** Admin: create logins, assign roles and branches, reset a password, sign a user out everywhere. */
export default function UsersScreen() {
  const th = useTheme();
  const [users, setUsers] = useState<User[] | null>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, r, l] = await Promise.all([api.get('/users'), api.get('/roles'), api.get('/locations')]);
      setUsers(u); setRoles(r); setLocations(l); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (u?: User) => {
    setFormError(null); setErrors({});
    setDraft(u ? { id: u.id, fullName: u.fullName, mobile: u.mobile ?? '', email: u.email ?? '', password: '', roleCodes: u.roles, locationIds: u.locationIds, active: u.status === 'ACTIVE' } : { ...EMPTY });
  };

  async function save() {
    if (!draft) return;
    setBusy(true); setFormError(null); setErrors({});
    try {
      const common = { fullName: draft.fullName.trim(), mobile: draft.mobile.trim(), email: draft.email.trim() || undefined, roleCodes: draft.roleCodes, locationIds: draft.locationIds };
      const password = draft.password || undefined; // blank = the role's default password (Admin@1234 ...), changed at the first sign-in
      if (draft.id) await api.patch(`/users/${draft.id}`, { ...common, status: draft.active ? 'ACTIVE' : 'INACTIVE', password });
      else await api.post('/users', { ...common, password });
      setDraft(null); setNotice(draft.id ? 'User updated' : 'User created');
      await load();
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(e instanceof ApiError ? e.message : 'Could not save');
    } finally { setBusy(false); }
  }

  function signOutEverywhere() {
    if (!draft?.id) return;
    Alert.alert('Sign out everywhere?', `${draft.fullName} will have to sign in again on every device.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        try { await api.post(`/users/${draft.id}/sessions/revoke`); setNotice('Signed out everywhere'); setDraft(null); } catch (e) { setFormError(e instanceof ApiError ? e.message : 'Failed'); }
      } },
    ]);
  }

  const roleOptions = roles.filter((r) => r.status === 'ACTIVE').map((r) => ({ value: r.code, label: r.name ?? roleLabel(r.code) }));
  const locOptions = locations.filter((l) => l.status === 'ACTIVE').map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }));
  const locName = (id: string) => locations.find((l) => l.id === id)?.name;

  return (
    <Screen title="Users" onRefresh={load} headerRight={<Button small variant="secondary" icon="plus" title="Add" onPress={() => open()} />}>
      {notice ? <Banner tone="ok">✓ {notice}</Banner> : null}
      <ErrorBox error={error} />
      {!users ? <Loading /> : users.map((u) => (
        <ListRow
          key={u.id} title={u.fullName}
          lines={[`${u.roles.map((r) => roles.find((x) => x.code === r)?.name ?? roleLabel(r)).join(', ')} · ${u.mobile ?? u.username}`, u.locationIds.length ? u.locationIds.map(locName).filter(Boolean).join(', ') : null, u.lastLoginAt ? `Last sign-in ${new Date(u.lastLoginAt).toLocaleDateString()}` : 'Never signed in']}
          right={<Chip text={u.status === 'ACTIVE' ? 'Active' : 'Inactive'} tone={u.status === 'ACTIVE' ? 'ok' : 'neutral'} icon={u.status === 'ACTIVE' ? '●' : '○'} />}
          onPress={() => open(u)}
        />
      ))}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit user' : 'Add user'}>
        {draft ? (
          <>
            <Field label="Full name" required value={draft.fullName} onChangeText={(v) => setDraft({ ...draft, fullName: v })} maxLength={100} error={errors.fullName} />
            <View style={{ gap: 4 }}>
              <Field label="Mobile number" required value={draft.mobile} onChangeText={(v) => setDraft({ ...draft, mobile: v.replace(/\D/g, '').slice(0, 10) })} keyboardType="number-pad" placeholder="10 digits" error={errors.mobile} />
              <Muted small>This is the sign-in name; the OTP is sent to it.</Muted>
            </View>
            <Field label="Email" value={draft.email} onChangeText={(v) => setDraft({ ...draft, email: v })} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
            <View style={{ gap: 6 }}>
              <Field label={draft.id ? 'New password (leave blank to keep)' : 'Password (optional)'} value={draft.password} onChangeText={(v) => setDraft({ ...draft, password: v })} secureTextEntry autoCapitalize="none" error={errors.password} />
              <Muted small>{draft.id ? 'A new password makes the user change it at the next sign-in.' : 'Blank = the role default. The user must change it at the first sign-in.'}</Muted>
              {draft.password ? <PasswordChecklist value={draft.password} /> : null}
            </View>
            <MultiChips label="Roles" values={draft.roleCodes} onChange={(v) => setDraft({ ...draft, roleCodes: v })} options={roleOptions} />
            <MultiChips label="Branches" values={draft.locationIds} onChange={(v) => setDraft({ ...draft, locationIds: v })} options={locOptions} />
            <Text style={{ color: th.faint, fontSize: 12 }}>Branch managers and staff need exactly one branch.</Text>
            {draft.id ? <ToggleRow label="Active (can sign in)" value={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} /> : null}
            <ErrorBox error={formError} />
            <Button title="Save" onPress={save} loading={busy} disabled={!draft.fullName.trim() || !/^\d{10}$/.test(draft.mobile) || draft.roleCodes.length === 0 || (draft.password !== '' && !passwordOk(draft.password))} />
            {draft.id ? <Button title="Sign out everywhere" variant="secondary" onPress={signOutEverywhere} /> : null}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
