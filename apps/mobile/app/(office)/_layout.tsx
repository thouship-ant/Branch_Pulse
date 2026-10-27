import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { AppBar } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
const TABS: Array<{ name: string; title: string; icon: FeatherName; perm?: string }> = [
  { name: 'dashboard', title: 'Dashboard', icon: 'bar-chart-2', perm: 'dashboard:view' },
  { name: 'approvals', title: 'Approvals', icon: 'check-circle', perm: 'expense:approve' },
  { name: 'account', title: 'Account', icon: 'user' },
];

/** Back-office layout for Admin, Accountant and Stock Manager. */
export default function OfficeLayout() {
  const th = useTheme();
  const { me, loading, isBranchUser, can } = useSession();
  if (loading) return null;
  if (!me) return <Redirect href="/login" />;
  if (me.isSuper || isBranchUser) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        header: () => <AppBar title={me.company?.name ?? 'Branch Pulse'} subtitle={me.fullName} />,
        tabBarActiveTintColor: th.brand,
        tabBarInactiveTintColor: th.faint,
        tabBarStyle: { backgroundColor: th.surface, borderTopColor: th.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name} name={t.name}
          options={{ title: t.title, href: !t.perm || can(t.perm) ? undefined : null, tabBarIcon: ({ color, size }) => <Feather name={t.icon} size={size} color={color} /> }}
        />
      ))}
    </Tabs>
  );
}
