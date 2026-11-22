import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { passwordOk } from '@/lib/password';
import { useTheme } from '@/lib/theme';
import { PasswordChecklist } from '../PasswordChecklist';
import { Button, Chips, ErrorBox, Field, Sheet } from '../ui';
import { FontFields, PictureEditor, pictureUri } from './Branding';
import { BANNER_H, CompanyBanner, FrameBackground } from './CompanyBanner';

export interface Company {
  id: string; code: string; name: string; address: string | null; gstin: string | null; fssai: string | null; email: string | null; status: string;
  businessName: string; businessType: string; businessLogo?: string | null; businessFrame?: string | null; businessFont?: string; businessFontSize?: string;
  branchCount: number; admin: { name: string; mobile: string; status: string } | null;
}

const EMAIL = /^\S+@\S+\.\S+$/;
const BIZ_TYPES = [
  { value: 'TEA_SHOP', label: 'Tea shop' }, { value: 'HOTEL', label: 'Hotel' }, { value: 'RESTAURANT', label: 'Restaurant' }, { value: 'BAKERY', label: 'Bakery' },
  { value: 'FRUIT_STALL', label: 'Fruit stall' }, { value: 'VEGETABLE_SHOP', label: 'Vegetable shop' }, { value: 'GROCERY', label: 'Grocery' }, { value: 'OTHER', label: 'Other' },
];

/** A section card laid over the frame picture. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const th = useTheme();
  return (
    <View style={{ gap: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,252,247,0.93)', borderWidth: 1, borderColor: 'rgba(113,56,23,0.08)' }}>
      <Text style={{ color: th.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

/**
 * Add a company (with its first Admin) or edit one, as a full-height sheet. The title carries the company code; under it the
 * banner stays pinned and shows live how the app will look for the company's people (pencils change the logo and the frame);
 * the fields scroll below it on the same frame picture.
 */
export function CompanySheet({ open, onClose, company, onSaved }: { open: boolean; onClose: () => void; company?: Company | null; onSaved: () => void }) {
  if (!open) return null;
  return <CompanySheetBody key={company?.id ?? 'new'} onClose={onClose} company={company ?? undefined} onSaved={onSaved} />;
}

function CompanySheetBody({ onClose, company, onSaved }: { onClose: () => void; company?: Company; onSaved: () => void }) {
  const th = useTheme();
  const editing = !!company;
  const [f, setF] = useState({
    companyName: company?.name ?? '', businessType: company?.businessType ?? 'TEA_SHOP', adminName: '', mobile: '', email: company?.email ?? '',
    address: company?.address ?? '', gstin: company?.gstin ?? '', fssai: company?.fssai ?? '', password: '',
  });
  const [logo, setLogo] = useState(company?.businessLogo ?? '');
  const [frame, setFrame] = useState<string | null>(null); // null = unchanged (edit) / none (add), '' = back to the default
  const [font, setFont] = useState(company?.businessFont ?? 'INTER');
  const [fontSize, setFontSize] = useState(company?.businessFontSize ?? 'MEDIUM');
  const [panel, setPanel] = useState<'logo' | 'frame' | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((s) => ({ ...s, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };

  const framePreview = frame === null ? company?.businessFrame ?? '' : frame;
  const baseOk = f.companyName.trim().length >= 2 && EMAIL.test(f.email) && f.address.trim().length >= 5;
  const ready = editing ? baseOk : baseOk && f.adminName.trim() && /^\d{10}$/.test(f.mobile) && (!f.password || passwordOk(f.password));

  async function submit() {
    setBusy(true); setError(null); setErrors({});
    try {
      if (company) {
        await api.patch(`/super/companies/${company.id}`, {
          companyName: f.companyName.trim(), businessType: f.businessType, email: f.email.trim(), address: f.address.trim(), gstin: f.gstin.trim().toUpperCase(), fssai: f.fssai.trim(),
          ...(logo !== (company.businessLogo ?? '') ? { businessLogo: logo } : {}),
          ...(frame !== null ? { businessFrame: frame } : {}),
          ...(font !== (company.businessFont ?? 'INTER') ? { businessFont: font } : {}),
          ...(fontSize !== (company.businessFontSize ?? 'MEDIUM') ? { businessFontSize: fontSize } : {}),
        });
      } else {
        await api.post('/super/companies', {
          companyName: f.companyName.trim(), businessType: f.businessType, adminName: f.adminName.trim(), mobile: f.mobile, email: f.email.trim(), address: f.address.trim(),
          gstin: f.gstin.trim().toUpperCase() || undefined, fssai: f.fssai.trim() || undefined, password: f.password || undefined,
          businessLogo: logo || undefined, businessFrame: frame || undefined, businessFont: font, businessFontSize: fontSize,
        });
      }
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(e instanceof ApiError ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  const preview = {
    code: company?.code ?? 'NEW', name: f.companyName.trim() || 'Company name', status: company?.status ?? 'ACTIVE',
    businessType: f.businessType, businessLogo: logo || null, businessFrame: framePreview || null,
  };

  return (
    <Sheet
      open tall bare onClose={onClose} title={editing ? `Edit ${company!.name} (${company!.code})` : 'New company'}
      pinned={<View style={{ borderTopWidth: 1, borderTopColor: th.border }}><CompanyBanner c={preview} onEditLogo={() => setPanel('logo')} onEditFrame={() => setPanel('frame')} /></View>}
    >
      <FrameBackground frame={framePreview}>
        <View style={{ padding: 14, gap: 14, minHeight: 360 }}>
          {panel ? (
            <Section title={panel === 'logo' ? 'Business logo' : 'Application frame'}>
              <PictureEditor
                kind={panel} value={panel === 'logo' ? logo : pictureUri(framePreview)} onDone={() => setPanel(null)}
                onChange={(v) => (panel === 'logo' ? setLogo(v) : setFrame(v))}
              />
            </Section>
          ) : (
            <>
              <Section title="Business">
                <Field label="Company name" required value={f.companyName} onChangeText={set('companyName')} maxLength={120} error={errors.companyName} />
                <Chips label="Shop type" value={f.businessType} onChange={(v) => setF((s) => ({ ...s, businessType: v }))} options={BIZ_TYPES} />
              </Section>
              <Section title="Font">
                <Text style={{ color: th.muted, fontSize: 12.5 }}>The typeface and text size the Admin, Branch Admin, Accountant and Stock Manager of this company see in the app.</Text>
                <FontFields font={font} fontSize={fontSize} onFont={setFont} onSize={setFontSize} />
              </Section>
              <Section title="Contact">
                <Field label="Email" required value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
                <Field label="Main shop / head office address" required value={f.address} onChangeText={set('address')} multiline error={errors.address} />
              </Section>
              <Section title="Registration">
                <Field label="GSTIN (optional)" value={f.gstin} onChangeText={(v) => set('gstin')(v.toUpperCase().slice(0, 15))} autoCapitalize="characters" placeholder="33ABCDE1234F1Z5" error={errors.gstin} />
                <Field label="FSSAI licence no. (optional)" value={f.fssai} onChangeText={(v) => set('fssai')(v.replace(/\D/g, '').slice(0, 14))} keyboardType="number-pad" placeholder="14 digits" error={errors.fssai} />
              </Section>
              {!editing && (
                <Section title="Admin">
                  <Field label="Admin full name" required value={f.adminName} onChangeText={set('adminName')} maxLength={100} error={errors.adminName} />
                  <Field label="Admin mobile number" required value={f.mobile} onChangeText={(v) => set('mobile')(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" placeholder="10 digits" error={errors.mobile} />
                  <Field label="Admin password (optional: blank = Admin@1234)" value={f.password} onChangeText={set('password')} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} error={errors.password} />
                  {f.password ? <PasswordChecklist value={f.password} /> : null}
                  <Pressable onPress={() => setShow((s) => !s)} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
                    <Text style={{ color: th.brand, fontWeight: '600' }}>{show ? 'Hide password' : 'Show password'}</Text>
                  </Pressable>
                  <Text style={{ color: th.muted, fontSize: 12 }}>The Admin signs in with this and an OTP, and is asked to change it at the first sign-in.</Text>
                </Section>
              )}
              <ErrorBox error={error} />
              <Button title={editing ? 'Save changes' : 'Create company'} onPress={submit} loading={busy} disabled={!ready} />
            </>
          )}
        </View>
      </FrameBackground>
    </Sheet>
  );
}

export { BANNER_H };
