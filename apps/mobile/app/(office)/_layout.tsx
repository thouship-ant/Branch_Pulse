import { Redirect, Tabs } from 'expo-router';
import { HeaderProvider } from '@/components/HeaderContext';
import { OfficeTabBar } from '@/components/OfficeTabBar';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

const ROUTES = ['dashboard', 'approvals', 'more', 'account'];

/** Back-office layout for Admin, Accountant and Stock Manager. */
export default function OfficeLayout() {
  const th = useTheme();
  const { me, loading, isBranchUser } = useSession();
  if (loading) return null;
  if (!me) return <Redirect href="/login" />;
  if (me.isSuper || isBranchUser) return <Redirect href="/" />;

  return (
    <HeaderProvider value={{ title: me.fullName, subtitle: me.company?.name }}>
    <Tabs
      tabBar={() => <OfficeTabBar />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: th.bg },
        tabBarActiveTintColor: th.brand,
        tabBarInactiveTintColor: th.faint,
      }}
    >
      {ROUTES.map((name) => <Tabs.Screen key={name} name={name} />)}
    </Tabs>
    </HeaderProvider>
  );
}
