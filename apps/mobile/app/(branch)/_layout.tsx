import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { HeaderProvider } from '@/components/HeaderContext';
import { IconButton } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
const TABS: Array<{ name: string; title: string; icon: FeatherName }> = [
  { name: 'home', title: 'Today', icon: 'home' },
  { name: 'sales', title: 'Sales', icon: 'trending-up' },
  { name: 'expense', title: 'Expense', icon: 'credit-card' },
  { name: 'stock', title: 'Stock', icon: 'box' },
  { name: 'closing', title: 'Closing', icon: 'check-square' },
];

/** The branch manager's phone layout: one branch, five tabs. */
export default function BranchLayout() {
  const th = useTheme();
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
        tabBarStyle: { backgroundColor: th.surface, borderTopWidth: 0, elevation: 14, shadowColor: '#1e2a8a', shadowOpacity: 0.08, shadowRadius: 12 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name} name={t.name}
          options={{ title: t.title, tabBarIcon: ({ color, size }) => <Feather name={t.icon} size={size} color={color} /> }}
        />
      ))}
      {/* reachable from the Today checklist, not tabs of their own */}
      <Tabs.Screen name="cash" options={{ href: null }} />
      <Tabs.Screen name="staff" options={{ href: null }} />
    </Tabs>
    </HeaderProvider>
  );
}
