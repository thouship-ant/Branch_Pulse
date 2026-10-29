import { useEffect, useState } from 'react';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { amt } from '@/lib/money';
import { Button, Chips, ErrorBox, Field, MoneyField, ToggleRow } from './ui';

export const TYPES = [{ value: 'BRANCH', label: 'Branch' }, { value: 'GODOWN', label: 'Godown' }, { value: 'CENTRAL_OFFICE', label: 'Office' }] as const;

/** Add a branch / godown / office, or edit one. The code is issued by the server. */
export function BranchForm({ branch, onDone }: { branch?: any; onDone: (b: any) => void }) {
  const [v, setV] = useState({
    type: (branch?.type ?? 'BRANCH') as string, code: branch?.code ?? '', name: branch?.name ?? '', address: branch?.address ?? '', phone: branch?.phone ?? '',
    notes: branch?.notes ?? '', openingCash: branch?.defaultOpeningCash ?? '', monthlyRent: branch?.monthlyRent ?? '', cardEnabled: branch?.cardEnabled ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (x: any) => setV((s) => ({ ...s, [k]: x }));

  useEffect(() => {
    if (branch) return;
    api.get(`/locations/next-code?type=${v.type}`).then((r) => set('code')(r.code)).catch(() => undefined);
  }, [branch, v.type]);

  async function save() {
    setBusy(true); setError(null); setErrors({});
    try {
      const body = { name: v.name.trim(), address: v.address, phone: v.phone, notes: v.notes, defaultOpeningCash: amt(String(v.openingCash)), monthlyRent: amt(String(v.monthlyRent)), cardEnabled: v.cardEnabled };
      const out = branch ? await api.patch(`/locations/${branch.id}`, body) : await api.post('/locations', { ...body, code: v.code, type: v.type });
      onDone(out);
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(e instanceof ApiError ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  const isBranch = v.type === 'BRANCH';
  return (
    <>
      {!branch ? <Chips label="Type" value={v.type} onChange={set('type')} options={TYPES.map((t) => ({ ...t }))} /> : null}
      <Field label="Code" value={v.code} editable={false} />
      <Field label="Name" required value={v.name} onChangeText={set('name')} maxLength={100} error={errors.name} />
      <Field label="Address" value={v.address} onChangeText={set('address')} multiline error={errors.address} />
      <Field label="Phone" value={v.phone} onChangeText={(x) => set('phone')(x.replace(/[^\d+ -]/g, ''))} keyboardType="phone-pad" error={errors.phone} />
      {isBranch ? <MoneyField label="Default opening cash" value={String(v.openingCash)} onChange={set('openingCash')} /> : null}
      <MoneyField label="Monthly rent" value={String(v.monthlyRent)} onChange={set('monthlyRent')} />
      {isBranch ? <ToggleRow label="Accepts card payments" value={v.cardEnabled} onChange={set('cardEnabled')} /> : null}
      <Field label="Notes" value={v.notes} onChangeText={set('notes')} multiline />
      <ErrorBox error={error} />
      <Button title={branch ? 'Save changes' : 'Add'} onPress={save} loading={busy} disabled={!v.name.trim() || !v.code} />
    </>
  );
}
