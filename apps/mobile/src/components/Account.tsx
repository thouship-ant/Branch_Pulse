import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import { Text } from './Text';
import { ACCENT, type AccentName, Banner, Button, Card, Heading, PageTitle, Screen, SelectField, Sheet, ThemeColorSwitch, ThemeSwitch, ToggleRow } from '@/components/ui';
import { useAvatar } from '@/lib/avatar';
import { roleLabel } from '@/lib/labels';
import { pushEnabled, pushProblem, registerForPush, sendTestPush, setPushEnabled } from '@/lib/push';
import { useSession } from '@/lib/session';
import { useLang } from '@/lib/language';
import { useIsTeaShop, useTheme } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

/** Who is signed in, which company, the app settings, and the sign-out button. */
export function Account() {
  const th = useTheme();
  const { me, logout } = useSession();
  const { lang, setLang } = useLang();
  const [push, setPush] = useState(true);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const teaShop = useIsTeaShop();
  const avatar = useAvatar(me?.id);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  useEffect(() => { void pushEnabled().then(setPush); }, []);
  if (!me) return null;

  async function toggle(on: boolean) {
    setPush(on); setNote(null);
    const token = await setPushEnabled(on);
    if (on && !token) setNote({ tone: 'warn', text: `Notifications could not be turned on. ${pushProblem() ?? 'Allow them for Branch Pulse in the phone settings.'}` });
  }
  async function test() {
    setBusy(true); setNote(null);
    try {
      let r = await sendTestPush();
      if (r.sent === 0) {
        // nothing registered yet: try to register this phone now, and say why if it cannot be done
        const token = await registerForPush();
        if (token) r = await sendTestPush();
        else { setNote({ tone: 'warn', text: `No phone is registered for notifications yet. ${pushProblem() ?? ''}`.trim() }); setBusy(false); return; }
      }
      setNote(r.sent > 0 ? { tone: 'ok', text: 'Test sent. It should arrive in a few seconds.' } : { tone: 'warn', text: 'The server has no active phone for you, or notifications are switched off on the server.' });
    } catch (e) { setNote({ tone: 'warn', text: e instanceof Error ? e.message : 'Could not send the test' }); }
    setBusy(false);
  }

  async function changePhoto(source: 'library' | 'camera') {
    setPhotoError(null);
    try { await avatar.pick(source); setPhotoOpen(false); } catch (e) { setPhotoError(e instanceof Error ? e.message : 'Could not change the photo'); }
  }

  const roles = me.roleNames?.length ? me.roleNames : me.roles.map(roleLabel);
  const initials = me.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  const info: Array<{ icon: IconName; accent: AccentName; label: string; value: string }> = [
    { icon: me.isSuper ? 'user' : 'smartphone', accent: 'blue', label: me.isSuper ? 'Username' : 'Mobile', value: me.isSuper ? me.username : me.mobile ?? me.username },
    ...(me.company ? [{ icon: 'briefcase' as IconName, accent: 'purple' as AccentName, label: 'Company', value: me.company.name }] : []),
    ...(!me.isSuper && me.locations.length > 0 ? [{ icon: 'map-pin' as IconName, accent: 'green' as AccentName, label: 'Branches', value: me.allLocations ? 'All branches' : `${me.locations.length} assigned` }] : []),
  ];

  return (
    <Screen>
      {teaShop
        ? <PageTitle icon="account-circle-outline" title="Account" subtitle="Your profile and app settings" />
        : <Heading onBlue title="Account" />}

      {/* who is signed in */}
      <Card style={{ padding: 0, overflow: 'hidden', gap: 0, ...(teaShop ? { borderRadius: 26 } : null) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 22, paddingHorizontal: 16, backgroundColor: teaShop ? (th.dark ? th.brandLight : '#f3e2cd') : th.brandLight }}>
          <Pressable onPress={() => { setPhotoError(null); setPhotoOpen(true); }} accessibilityRole="button" accessibilityLabel="Change profile photo" style={{ width: 88, height: 88 }}>
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: th.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: th.surface, overflow: 'hidden', shadowColor: '#45220f', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }}>
              {avatar.uri
                ? <Image source={{ uri: avatar.uri }} accessibilityLabel={`${me.fullName} photo`} style={{ width: '100%', height: '100%' }} />
                : <Text style={{ color: th.onBrand, fontSize: 30, fontWeight: '800' }}>{initials}</Text>}
            </View>
            <View style={{ position: 'absolute', right: -2, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: '#a4501f', borderWidth: 3, borderColor: th.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="camera" size={13} color="#fff" />
            </View>
          </Pressable>
          {/* the name, roles and photo link sit beside the photo, in one row */}
          <View style={{ flex: 1, minWidth: 0, gap: 8, alignItems: 'flex-start' }}>
            <Text numberOfLines={1} style={{ color: th.ink, fontSize: 22, fontWeight: '800' }}>{me.fullName}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {roles.map((r) => (
                <View key={r} style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: teaShop && !th.dark ? '#8f421b' : th.surface, borderWidth: teaShop ? 0 : 1, borderColor: th.border }}>
                  <Text style={{ color: teaShop && !th.dark ? '#fff4e8' : th.brandDark, fontSize: 12, fontWeight: '700' }}>{r}</Text>
                </View>
              ))}
            </View>
            <Pressable onPress={() => { setPhotoError(null); setPhotoOpen(true); }} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: th.brandDark, fontSize: 12, fontWeight: '700' }}>{avatar.uri ? 'Change photo' : 'Add a photo'}</Text>
            </Pressable>
          </View>
        </View>
        {info.map((r) => (
          <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: 1, borderTopColor: th.border }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: ACCENT[r.accent].bg, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={r.icon} size={18} color={ACCENT[r.accent].fg} />
            </View>
            <Text style={{ color: th.muted, fontSize: 14, flex: 1 }}>{r.label}</Text>
            <Text numberOfLines={1} style={{ color: th.ink, fontSize: 15, fontWeight: '700', maxWidth: '55%' }}>{r.value}</Text>
          </View>
        ))}
      </Card>

      {!me.isSuper && Platform.OS !== 'web' ? (
        <Card>
          <SectionTitle icon="bell" accent="amber" title="Notifications" sub="Approvals, results and closing reminders" />
          <ToggleRow label="Push notifications" value={push} onChange={(v) => void toggle(v)} />
          {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
          {push ? <Button title="Send a test notification" variant="secondary" icon="bell" onPress={() => void test()} loading={busy} /> : null}
        </Card>
      ) : null}

      <Card style={teaShop ? { borderRadius: 24 } : undefined}>
        <SectionTitle icon="globe" accent="sky" title="Language" sub="English or தமிழ்" />
        <SelectField label="Choose language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'ta', label: 'தமிழ்' }]} />
      </Card>

      <Card style={teaShop ? { borderRadius: 24 } : undefined}>
        <SectionTitle icon="sun" accent="rose" title="Appearance" sub="Light, dark, or follow your phone" />
        <ThemeSwitch />
        <View style={{ gap: 8 }}>
          <Text style={{ color: th.ink, fontSize: 14, fontWeight: '700' }}>Theme color</Text>
          {me.company?.businessType === 'TEA_SHOP'
            ? <Text style={{ color: th.muted, fontSize: 13 }}>Tea-shop colors follow your business type.</Text>
            : <ThemeColorSwitch />}
        </View>
      </Card>

      <Button title="Sign out" variant="danger" icon="log-out" onPress={() => void logout()} />

      <Sheet open={photoOpen} onClose={() => setPhotoOpen(false)} title="Profile photo">
        <Text style={{ color: th.muted, fontSize: 13 }}>Your photo is kept on this device only.</Text>
        {photoError ? <Banner tone="warn">{photoError}</Banner> : null}
        <Button title="Choose from gallery" icon="image" onPress={() => void changePhoto('library')} />
        {Platform.OS !== 'web' ? <Button title="Take a photo" variant="secondary" icon="camera" onPress={() => void changePhoto('camera')} /> : null}
        {avatar.uri ? <Button title="Remove photo" variant="danger" icon="trash-2" onPress={() => { void avatar.remove(); setPhotoOpen(false); }} /> : null}
      </Sheet>
    </Screen>
  );
}

/** A card heading: coloured icon tile, title and a one-line hint. */
function SectionTitle({ icon, accent, title, sub }: { icon: IconName; accent: AccentName; title: string; sub: string }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: ACCENT[accent].bg, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon} size={18} color={ACCENT[accent].fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: th.ink, fontSize: 16, fontWeight: '800' }}>{title}</Text>
        <Text style={{ color: th.muted, fontSize: 12 }}>{sub}</Text>
      </View>
    </View>
  );
}
