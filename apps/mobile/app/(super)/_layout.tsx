import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { HeaderProvider } from '@/components/HeaderContext';
import { tr } from '@/lib/i18n';
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
    <HeaderProvider value={{ title: tr('Super Admin'), subtitle: 'Branch Pulse' }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: th.bg },
        tabBarActiveTintColor: th.brand,
        tabBarInactiveTintColor: th.faint,
        tabBarStyle: { backgroundColor: th.surface, borderTopWidth: 0, elevation: 14, shadowColor: '#1e2a8a', shadowOpacity: 0.08, shadowRadius: 12 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="companies" options={{ title: tr('Companies'), tabBarIcon: ({ color, size }) => <Feather name="briefcase" size={size} color={color} /> }} />
      <Tabs.Screen name="data-upload" options={{ title: tr('Data Upload'), tabBarIcon: ({ color, size }) => <Feather name="upload" size={size} color={color} /> }} />
      <Tabs.Screen name="super-account" options={{ title: tr('Account'), tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} /> }} />
    </Tabs>
    </HeaderProvider>
  );
}
