import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Text } from './Text';
import { Banner, Button, Card, Heading, LanguageSwitch, Muted, Row, Screen, ToggleRow } from '@/components/ui';
import { roleLabel } from '@/lib/labels';
import { pushEnabled, sendTestPush, setPushEnabled } from '@/lib/push';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** Who is signed in, which company, and the sign-out button. */
export function Account() {
  const th = useTheme();
  const { me, logout } = useSession();
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
  return (
    <Screen>
      <Heading onBlue title="Account" />
      <Card>
        <View style={{ gap: 2 }}>
          <Text style={{ color: th.ink, fontSize: 18, fontWeight: '700' }}>{me.fullName}</Text>
          <Muted>{me.roles.map(roleLabel).join(', ')}</Muted>
        </View>
        <Row label={me.isSuper ? 'Username' : 'Mobile'} value={me.isSuper ? me.username : me.mobile ?? me.username} />
        {me.company ? <Row label="Company" value={me.company.name} /> : null}
        {!me.isSuper && me.locations.length > 0 ? <Row label="Branches" value={me.allLocations ? 'All' : String(me.locations.length)} /> : null}
      </Card>
      {!me.isSuper && Platform.OS !== 'web' ? (
        <Card>
          <Text style={{ color: th.ink, fontWeight: '700' }}>Notifications</Text>
          <ToggleRow label="Push notifications" value={push} onChange={(v) => void toggle(v)} />
          <Muted small>Approvals waiting for you, results of what you submitted, and closing reminders.</Muted>
          {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
          {push ? <Button title="Send a test notification" variant="secondary" icon="bell" onPress={() => void test()} loading={busy} /> : null}
        </Card>
      ) : null}
      <Card><Text style={{ color: th.ink, fontWeight: '700' }}>Language</Text><LanguageSwitch /></Card>
      <Button title="Sign out" variant="danger" icon="log-out" onPress={() => void logout()} />
    </Screen>
  );
}
