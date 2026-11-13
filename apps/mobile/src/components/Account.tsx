import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Text } from './Text';
import { ACCENT, type AccentName, Banner, Button, Card, Heading, Screen, SelectField, ThemeSwitch, ToggleRow } from '@/components/ui';
import { roleLabel } from '@/lib/labels';
import { pushEnabled, sendTestPush, setPushEnabled } from '@/lib/push';
import { useSession } from '@/lib/session';
import { useLang } from '@/lib/language';
import { useTheme } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

/** Who is signed in, which company, the app settings, and the sign-out button. */
export function Account() {
  const th = useTheme();
  const { me, logout } = useSession();
  const { lang, setLang } = useLang();
  const [push, setPush] = useState(true);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushEnabled().then(setPush); }, []);
  if (!me) return null;

  async function toggle(on: boolean) {
    setPush(on); setNote(null);
    const token = await setPushEnabled(on);
    if (on && !token) setNote({ tone: 'warn', text: 'Notifications could not be turned on. Allow them for Branch Pulse in the phone settings.' });
  }
  async function test() {
    setBusy(true); setNote(null);
    try {
      const r = await sendTestPush();
      setNote(r.sent > 0 ? { tone: 'ok', text: 'Test sent. It should arrive in a few seconds.' } : { tone: 'warn', text: 'No phone is registered for notifications yet.' });
    } catch (e) { setNote({ tone: 'warn', text: e instanceof Error ? e.message : 'Could not send the test' }); }
    setBusy(false);
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
      <Heading onBlue title="Account" />

      {/* who is signed in */}
      <Card style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 22, paddingHorizontal: 16, backgroundColor: th.brandLight }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: th.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: th.surface }}>
            <Text style={{ color: th.onBrand, fontSize: 26, fontWeight: '800' }}>{initials}</Text>
          </View>
          <Text style={{ color: th.ink, fontSize: 20, fontWeight: '800' }}>{me.fullName}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {roles.map((r) => (
              <View key={r} style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: th.surface, borderWidth: 1, borderColor: th.border }}>
                <Text style={{ color: th.brandDark, fontSize: 12, fontWeight: '700' }}>{r}</Text>
              </View>
            ))}
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

      <Card>
        <SectionTitle icon="globe" accent="sky" title="Language" sub="English or தமிழ்" />
        <SelectField label="Choose language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'ta', label: 'தமிழ்' }]} />
      </Card>

      <Card>
        <SectionTitle icon="sun" accent="rose" title="Appearance" sub="Light, dark, or follow your phone" />
        <ThemeSwitch />
      </Card>

      <Button title="Sign out" variant="danger" icon="log-out" onPress={() => void logout()} />
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
