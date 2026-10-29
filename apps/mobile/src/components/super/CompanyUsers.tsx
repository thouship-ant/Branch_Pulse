import { useCallback, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { Banner, Button, Chip, ErrorBox, Field, Loading, Muted } from '../ui';
import type { Company } from './CompanyForms';

interface CUser {
  id: string; fullName: string; username: string; mobile: string | null; email: string | null; status: string; roles: string[];
  lastLoginAt: string | null; mustChangePassword: boolean; locations: string[];
}
const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', ACCOUNTANT: 'Accountant', STOCK_MANAGER: 'Stock Manager', BRANCH_MANAGER: 'Branch Manager', STAFF: 'Staff' };
const roleText = (roles: string[]) => roles.map((r) => ROLE_LABEL[r] ?? r).join(', ');

/** Every user of one company: change name / mobile / email, reset the password (a temporary one is sent by SMS). */
export function CompanyUsers({ company, onChanged }: { company: Company; onChanged: () => void }) {
  const th = useTheme();
  const [users, setUsers] = useState<CUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<CUser | null>(null);
  const [reset, setReset] = useState<CUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setUsers(await api.get(`/super/companies/${company.id}/users`)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
  }, [company.id]);
  useEffect(() => { void load(); }, [load]);

  if (edit) return <EditUser user={edit} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); setNotice('User updated'); void load(); onChanged(); }} />;
  if (reset) return <ResetPassword user={reset} onCancel={() => setReset(null)} onDone={(msg) => { setReset(null); setNotice(msg); void load(); }} />;

  return (
    <View style={{ gap: 12 }}>
      <ErrorBox error={error} />
      {notice ? <Banner tone="ok">✓ {notice}</Banner> : null}
      {!users ? <Loading /> : users.length === 0 ? <Muted>No users yet.</Muted> : users.map((u) => (
        <View key={u.id} style={{ borderWidth: 1, borderColor: th.border, borderRadius: 14, padding: 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: th.ink, fontWeight: '700', fontSize: 16 }}>{u.fullName}</Text>
              <Text style={{ color: th.muted, fontSize: 13 }}>{roleText(u.roles)} · {u.mobile ?? 'no mobile'}</Text>
              {u.locations.length > 0 ? <Text style={{ color: th.faint, fontSize: 12 }}>{u.locations.join(', ')}</Text> : null}
            </View>
            {u.status !== 'ACTIVE' ? <Chip text="Inactive" /> : null}
          </View>
          {u.mustChangePassword ? <Text style={{ color: th.warn.text, fontSize: 12 }}>⚠ still on the default / temporary password</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button small variant="secondary" title="Edit" style={{ flex: 1 }} onPress={() => { setNotice(null); setEdit(u); }} />
            <Button small variant="secondary" title="Reset password" style={{ flex: 1 }} onPress={() => { setNotice(null); setReset(u); }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function EditUser({ user, onCancel, onSaved }: { user: CUser; onCancel: () => void; onSaved: () => void }) {
  const th = useTheme();
  const [f, setF] = useState({ fullName: user.fullName, mobile: user.mobile ?? '', email: user.email ?? '', active: user.status === 'ACTIVE' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mobileChanged = f.mobile !== (user.mobile ?? '');

  async function save() {
    setBusy(true); setError(null); setErrors({});
    try {
      await api.patch(`/super/users/${user.id}`, { fullName: f.fullName.trim(), mobile: f.mobile || undefined, email: f.email.trim() || undefined, status: f.active ? 'ACTIVE' : 'INACTIVE' });
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(e instanceof ApiError ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <Muted>{roleText(user.roles)}</Muted>
      <Field label="Full name" value={f.fullName} onChangeText={(v) => setF({ ...f, fullName: v })} maxLength={100} error={errors.fullName} />
      <View style={{ gap: 4 }}>
        <Field label="Mobile number" value={f.mobile} onChangeText={(v) => setF({ ...f, mobile: v.replace(/\D/g, '').slice(0, 10) })} keyboardType="number-pad" placeholder="10 digits" error={errors.mobile} />
        {mobileChanged ? <Text style={{ color: th.warn.text, fontSize: 12 }}>This is the sign-in name. The user will be signed out and must use the new number from now on.</Text> : null}
      </View>
      <Field label="Email" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: th.ink, fontSize: 16 }}>Active (can sign in)</Text>
        <Switch value={f.active} onValueChange={(v) => setF({ ...f, active: v })} trackColor={{ true: th.brand }} />
      </View>
      <ErrorBox error={error} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button title="Back" variant="secondary" style={{ flex: 1 }} onPress={onCancel} disabled={busy} />
        <Button title="Save" style={{ flex: 1 }} onPress={save} loading={busy} disabled={f.fullName.trim().length < 2 || (f.mobile !== '' && !/^\d{10}$/.test(f.mobile))} />
      </View>
    </View>
  );
}

function ResetPassword({ user, onDone, onCancel }: { user: CUser; onDone: (msg: string) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dev, setDev] = useState<{ password: string; mobile: string } | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/super/users/${user.id}/reset-password`);
      if (r.tempPassword) setDev({ password: r.tempPassword, mobile: r.mobile }); // SMS gateway not configured (development)
      else onDone(`A temporary password was sent by SMS to ${r.mobile} (${user.fullName}).`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reset the password'); }
    finally { setBusy(false); }
  }

  if (dev) {
    return (
      <View style={{ gap: 14 }}>
        <Banner tone="warn">The SMS gateway is not configured on this server, so no SMS was sent to {dev.mobile}. Temporary password (development only): {dev.password}</Banner>
        <Button title="Done" onPress={() => onDone(`Password reset for ${user.fullName} (SMS not configured).`)} />
      </View>
    );
  }
  return (
    <View style={{ gap: 14 }}>
      <Muted>
        Reset the password of {user.fullName} ({roleText(user.roles)})? A temporary password is sent by SMS to {user.mobile ?? '—'} and they must change it at the next sign-in. They are signed out everywhere now.
      </Muted>
      <ErrorBox error={error} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onCancel} disabled={busy} />
        <Button title="Reset and send SMS" variant="danger" style={{ flex: 1 }} onPress={run} loading={busy} disabled={!user.mobile} />
      </View>
    </View>
  );
}
