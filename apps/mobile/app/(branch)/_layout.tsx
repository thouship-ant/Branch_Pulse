import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { AppBar, IconButton } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
const TABS: Array<{ name: string; title: string; icon: FeatherName }> = [
  { name: 'home', title: 'Today', icon: 'home' },
  { name: 'sales', title: 'Sales', icon: 'trending-up' },
  { name: 'expense', title: 'Expense', icon: 'credit-card' },
  { name: 'cash', title: 'Cash', icon: 'dollar-sign' },
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
    <Tabs
      screenOptions={{
        header: () => (
          <AppBar
            title={branch?.name ?? 'Branch Pulse'}
            subtitle={`${me.company?.name ?? ''} · ${me.fullName}`}
            right={<IconButton icon="log-out" label="Sign out" onPress={() => void logout()} />}
          />
        ),
        tabBarActiveTintColor: th.brand,
        tabBarInactiveTintColor: th.faint,
        tabBarStyle: { backgroundColor: th.surface, borderTopColor: th.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name} name={t.name}
          options={{ title: t.title, tabBarIcon: ({ color, size }) => <Feather name={t.icon} size={size} color={color} /> }}
        />
      ))}
    </Tabs>
  );
}
