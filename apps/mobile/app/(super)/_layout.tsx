import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { HeaderProvider } from '@/components/HeaderContext';
import { tr } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useTabBarOptions } from '@/lib/tabbar';
import { useTheme } from '@/lib/theme';

/** Super Admin: companies and account. */
export default function SuperLayout() {
  const th = useTheme();
  const tabBar = useTabBarOptions();
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
        ...tabBar,
      }}
    >
      <Tabs.Screen name="companies" options={{ title: tr('Companies'), tabBarIcon: ({ color }) => <Feather name="briefcase" size={22} color={color} /> }} />
      <Tabs.Screen name="data-upload" options={{ title: tr('Data Upload'), tabBarIcon: ({ color }) => <Feather name="upload" size={22} color={color} /> }} />
      <Tabs.Screen name="super-account" options={{ title: tr('Account'), tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color} /> }} />
    </Tabs>
    </HeaderProvider>
  );
}
