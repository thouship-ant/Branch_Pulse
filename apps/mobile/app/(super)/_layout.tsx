import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { AppBar } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** Super Admin: companies and account. */
export default function SuperLayout() {
  const th = useTheme();
  const { me, loading } = useSession();
  if (loading) return null;
  if (!me) return <Redirect href="/login" />;
  if (!me.isSuper) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        header: () => <AppBar title="Branch Pulse" subtitle="Super Admin" />,
        tabBarActiveTintColor: th.brand,
        tabBarInactiveTintColor: th.faint,
        tabBarStyle: { backgroundColor: th.surface, borderTopColor: th.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="companies" options={{ title: 'Companies', tabBarIcon: ({ color, size }) => <Feather name="briefcase" size={size} color={color} /> }} />
      <Tabs.Screen name="super-account" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} /> }} />
    </Tabs>
  );
}
