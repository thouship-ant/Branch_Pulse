import { Text, View } from 'react-native';
import { Button, Card, Heading, Muted, Row, Screen } from '@/components/ui';
import { API_ORIGIN } from '@/lib/api';
import { roleLabel } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** Who is signed in, which company, and the sign-out button. */
export function Account() {
  const th = useTheme();
  const { me, logout } = useSession();
  if (!me) return null;
  return (
    <Screen>
      <Heading title="Account" />
      <Card>
        <View style={{ gap: 2 }}>
          <Text style={{ color: th.ink, fontSize: 18, fontWeight: '700' }}>{me.fullName}</Text>
          <Muted>{me.roles.map(roleLabel).join(', ')}</Muted>
        </View>
        <Row label={me.isSuper ? 'Username' : 'Mobile'} value={me.isSuper ? me.username : me.mobile ?? me.username} />
        {me.company ? <Row label="Company" value={`${me.company.name} (${me.company.code})`} /> : null}
        {!me.isSuper && me.locations.length > 0 ? <Row label="Branches" value={me.allLocations ? 'All' : String(me.locations.length)} /> : null}
      </Card>
      <Button title="Sign out" variant="danger" icon="log-out" onPress={() => void logout()} />
      <Text style={{ color: th.faint, fontSize: 11, textAlign: 'center' }}>Server: {API_ORIGIN}</Text>
    </Screen>
  );
}
