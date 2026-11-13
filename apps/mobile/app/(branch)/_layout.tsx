import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { BackdateEntry } from '@/components/BackdateEntry';
import { HeaderProvider } from '@/components/HeaderContext';
import { IconButton } from '@/components/ui';
import { tr } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useTabBarOptions } from '@/lib/tabbar';
import { useTheme } from '@/lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
const TABS: Array<{ name: string; title: string; icon: FeatherName }> = [
  { name: 'home', title: 'Today', icon: 'home' },
  { name: 'stock', title: 'Stock', icon: 'box' },
  { name: 'sales', title: 'Sales', icon: 'trending-up' },
  { name: 'purchases', title: 'Purchases', icon: 'shopping-bag' },
  { name: 'expense', title: 'Expense', icon: 'credit-card' },
  { name: 'closing', title: 'Closing', icon: 'check-square' },
  { name: 'account', title: 'Account', icon: 'user' },
];

/** The branch manager's phone layout: one branch, seven tabs. */
export default function BranchLayout() {
  const th = useTheme();
  const tabBar = useTabBarOptions();
  const { me, loading, isBranchUser, logout } = useSession();
  if (loading) return null;
  if (!me) return <Redirect href="/login" />;
  if (!isBranchUser) return <Redirect href="/" />;
  const branch = me.locations[0];

  return (
    <HeaderProvider
      value={{
        title: me.fullName,
        subtitle: [me.company?.name, branch?.name].filter(Boolean).join(' · '),
        right: <IconButton icon="log-out" label="Sign out" onPress={() => void logout()} />,
      }}
    >
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: th.bg },
        tabBarActiveTintColor: th.brand,
        tabBarInactiveTintColor: th.faint,
        ...tabBar,
        // seven tabs share the width: a slightly smaller label and no side padding, so "Purchases" is not cut
        tabBarLabelStyle: { ...tabBar.tabBarLabelStyle, fontSize: 10 },
        tabBarItemStyle: { paddingVertical: 0, paddingHorizontal: 0 },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name} name={t.name}
          options={{ title: tr(t.title), tabBarIcon: ({ color }) => <Feather name={t.icon} size={22} color={color} /> }}
        />
      ))}
      {/* reachable from the Today checklist, not tabs of their own */}
      <Tabs.Screen name="cash" options={{ href: null }} />
      <Tabs.Screen name="staff" options={{ href: null }} />
    </Tabs>
    {/* the step-by-step entry sheet (today, or a missed day) sits over whichever tab is open */}
    {branch ? <BackdateEntry locationId={branch.id} /> : null}
    </HeaderProvider>
  );
}
