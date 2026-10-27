import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { Loading } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** Sends the user to the right area: sign-in, Super Admin, branch (phone) or office. */
export default function Index() {
  const { me, loading, isBranchUser } = useSession();
  const th = useTheme();
  if (loading) return <View style={{ flex: 1, backgroundColor: th.bg, justifyContent: 'center' }}><Loading /></View>;
  if (!me) return <Redirect href="/login" />;
  if (me.isSuper) return <Redirect href="/companies" />;
  return <Redirect href={isBranchUser ? '/home' : '/dashboard'} />;
}
