import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { passwordOk } from '@/lib/password';
import { useTheme } from '@/lib/theme';
import { PasswordChecklist } from '../PasswordChecklist';
import { Button, ErrorBox, Field } from '../ui';

export interface Company {
  id: string; code: string; name: string; address: string | null; gstin: string | null; fssai: string | null; email: string | null; status: string;
  branchCount: number; admin: { name: string; mobile: string; status: string } | null;
}

const EMAIL = /^\S+@\S+\.\S+$/;

/** New company with its first Admin. The password is optional: blank = the default Admin@1234, changed at the first sign-in. */
export function CreateCompanyForm({ onSaved }: { onSaved: () => void }) {
  const th = useTheme();
  const [f, setF] = useState({ companyName: '', adminName: '', mobile: '', email: '', address: '', gstin: '', fssai: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((s) => ({ ...s, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };

  const ready = f.companyName.trim() && f.adminName.trim() && /^\d{10}$/.test(f.mobile) && EMAIL.test(f.email) && f.address.trim().length >= 5 && (!f.password || passwordOk(f.password));

  async function submit() {
    setBusy(true); setError(null); setErrors({});
    try {
      await api.post('/super/companies', {
        companyName: f.companyName.trim(), adminName: f.adminName.trim(), mobile: f.mobile, email: f.email.trim(), address: f.address.trim(),
        gstin: f.gstin.trim().toUpperCase() || undefined, fssai: f.fssai.trim() || undefined, password: f.password || undefined,
      });
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(e instanceof ApiError ? e.message : 'Could not create the company');
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <Field label="Company name" required value={f.companyName} onChangeText={set('companyName')} maxLength={120} error={errors.companyName} />
      <Field label="Admin full name" required value={f.adminName} onChangeText={set('adminName')} maxLength={100} error={errors.adminName} />
      <Field label="Admin mobile number" required value={f.mobile} onChangeText={(v) => set('mobile')(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder="10 digits" error={errors.mobile} />
      <Field label="Email" required value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
      <Field label="Main shop / head office address" required value={f.address} onChangeText={set('address')} multiline error={errors.address} />
      <Field label="GSTIN (optional)" value={f.gstin} onChangeText={(v) => set('gstin')(v.toUpperCase().slice(0, 15))} autoCapitalize="characters" placeholder="33ABCDE1234F1Z5" error={errors.gstin} />
      <Field label="FSSAI licence no. (optional)" value={f.fssai} onChangeText={(v) => set('fssai')(v.replace(/\D/g, '').slice(0, 14))} keyboardType="number-pad" placeholder="14 digits" error={errors.fssai} />
      <View style={{ gap: 6 }}>
        <Field
          label="Admin password (optional: blank = Admin@1234)" value={f.password} onChangeText={set('password')} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
          error={errors.password}
        />
        {f.password ? <PasswordChecklist value={f.password} /> : null}
        <Pressable onPress={() => setShow((s) => !s)} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
          <Text style={{ color: th.brand, fontWeight: '600' }}>{show ? 'Hide password' : 'Show password'}</Text>
        </Pressable>
        <Text style={{ color: th.muted, fontSize: 12 }}>The Admin signs in with this and an OTP, and is asked to change it at the first sign-in.</Text>
      </View>
      <ErrorBox error={error} />
      <Button title="Create company" onPress={submit} loading={busy} disabled={!ready} />
    </View>
  );
}

/** Change a company's details (name, email, address, GSTIN, FSSAI). */
export function EditCompanyForm({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const th = useTheme();
  const [f, setF] = useState({ companyName: company.name, email: company.email ?? '', address: company.address ?? '', gstin: company.gstin ?? '', fssai: company.fssai ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((s) => ({ ...s, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };
  const ready = f.companyName.trim().length >= 2 && f.address.trim().length >= 5 && EMAIL.test(f.email);

  async function submit() {
    setBusy(true); setError(null); setErrors({});
    try {
      await api.patch(`/super/companies/${company.id}`, { companyName: f.companyName.trim(), email: f.email.trim(), address: f.address.trim(), gstin: f.gstin.trim().toUpperCase(), fssai: f.fssai.trim() });
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(e instanceof ApiError ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <Text style={{ color: th.muted, fontSize: 13 }}>Company code {company.code}. To change the Admin&apos;s mobile number or reset a password open Users.</Text>
      <Field label="Company name" required value={f.companyName} onChangeText={set('companyName')} maxLength={120} error={errors.companyName} />
      <Field label="Email" required value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
      <Field label="Main shop / head office address" required value={f.address} onChangeText={set('address')} multiline error={errors.address} />
      <Field label="GSTIN (optional)" value={f.gstin} onChangeText={(v) => set('gstin')(v.toUpperCase().slice(0, 15))} autoCapitalize="characters" error={errors.gstin} />
      <Field label="FSSAI licence no. (optional)" value={f.fssai} onChangeText={(v) => set('fssai')(v.replace(/\D/g, '').slice(0, 14))} keyboardType="number-pad" error={errors.fssai} />
      <ErrorBox error={error} />
      <Button title="Save changes" onPress={submit} loading={busy} disabled={!ready} />
    </View>
  );
}
