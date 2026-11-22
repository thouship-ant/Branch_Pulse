import { Redirect, Tabs } from 'expo-router';
import { HeaderProvider } from '@/components/HeaderContext';
import { OfficeTabBar } from '@/components/OfficeTabBar';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

const ROUTES = ['dashboard', 'approvals', 'reports', 'more', 'account'];

/** Back-office layout for Admin, Accountant and Stock Manager. */
export default function OfficeLayout() {
  const th = useTheme();
  const { me, loading, isBranchUser } = useSession();
  if (loading) return null;
  if (!me) return <Redirect href="/login" />;
  if (me.isSuper || isBranchUser) return <Redirect href="/" />;
  const teaShop = me.company?.businessType === 'TEA_SHOP';

  return (
    <HeaderProvider value={{
      title: teaShop ? me.company?.businessName || me.company?.name || me.fullName : me.fullName,
      subtitle: teaShop ? 'Multi-Branch Operations' : me.company?.businessName || me.company?.name,
      teaShop, logo: me.company?.businessLogo || undefined,
    }}>
    <Tabs
      tabBar={() => <OfficeTabBar />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: teaShop ? 'transparent' : th.bg },
        tabBarActiveTintColor: th.brand,
        tabBarInactiveTintColor: th.faint,
      }}
    >
      {ROUTES.map((name) => <Tabs.Screen key={name} name={name} />)}
    </Tabs>
    </HeaderProvider>
  );
}
