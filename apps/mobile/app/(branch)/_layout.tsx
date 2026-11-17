import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { BackdateEntry } from '@/components/BackdateEntry';
import { HeaderProvider } from '@/components/HeaderContext';
import { IconButton } from '@/components/ui';
import { todayIST } from '@/lib/dates';
import { tr } from '@/lib/i18n';
import { startEntry } from '@/lib/workDate';
import { useSession } from '@/lib/session';
import { useTabBarOptions } from '@/lib/tabbar';
import { useTheme } from '@/lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
const TABS: Array<{ name: string; title: string; icon: FeatherName }> = [
  { name: 'home', title: 'Today', icon: 'home' },
  { name: 'stock', title: 'Stock', icon: 'box' },
  { name: 'entry', title: 'Entry', icon: 'edit-3' },
  { name: 'staff', title: 'Employee', icon: 'users' },
  { name: 'account', title: 'Account', icon: 'user' },
];

/** The branch manager's phone layout: one branch: Today, Stock, Entry (the step-by-step day), Account. */
export default function BranchLayout() {
  const th = useTheme();
  const tabBar = useTabBarOptions();
  const { me, loading, isBranchUser, logout, can } = useSession();
  if (loading) return null;
  if (!me) return <Redirect href="/login" />;
  if (!isBranchUser) return <Redirect href="/" />;
  const branch = me.locations[0];
  const teaShop = me.company?.businessType === 'TEA_SHOP';

  return (
    <HeaderProvider
      value={{
        title: teaShop ? me.company?.businessName || me.company?.name || me.fullName : me.fullName,
        subtitle: teaShop ? [me.fullName, branch?.name].filter(Boolean).join(' · ') : [me.company?.name, branch?.name].filter(Boolean).join(' · '),
        teaShop, logo: teaShop ? me.company?.businessLogo : undefined,
        right: <IconButton icon="log-out" label="Sign out" onPress={() => void logout()} />,
      }}
    >
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: teaShop ? 'transparent' : th.bg },
        tabBarActiveTintColor: th.brand,
        tabBarInactiveTintColor: th.faint,
        ...tabBar,
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name} name={t.name}
          options={{ title: tr(t.title), href: t.name === 'staff' && !can('staff:view') ? null : undefined, tabBarIcon: ({ color }) => <Feather name={t.icon} size={22} color={color} /> }}
          // Entry opens the step-by-step sheet for today instead of a page of its own
          listeners={t.name === 'entry' ? { tabPress: (e: any) => { e.preventDefault(); void startEntry(todayIST()); } } : undefined}
        />
      ))}
      {/* reachable from the Today checklist, not tabs of their own */}
      {/* the pages of the day's entry are shown inside the Entry sheet */}
      <Tabs.Screen name="sales" options={{ href: null }} />
      <Tabs.Screen name="purchases" options={{ href: null }} />
      <Tabs.Screen name="expense" options={{ href: null }} />
      <Tabs.Screen name="closing" options={{ href: null }} />
      <Tabs.Screen name="cash" options={{ href: null }} />
    </Tabs>
    {/* the step-by-step entry sheet (today, or a missed day) sits over whichever tab is open */}
    {branch ? <BackdateEntry locationId={branch.id} /> : null}
    </HeaderProvider>
  );
}
