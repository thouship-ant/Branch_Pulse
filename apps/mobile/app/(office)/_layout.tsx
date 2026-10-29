import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { HeaderProvider } from '@/components/HeaderContext';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
const TABS: Array<{ name: string; title: string; icon: FeatherName; perm?: string }> = [
  { name: 'dashboard', title: 'Dashboard', icon: 'bar-chart-2', perm: 'dashboard:view' },
  { name: 'approvals', title: 'Approvals', icon: 'check-circle', perm: 'expense:approve' },
  { name: 'more', title: 'More', icon: 'grid' },
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
    <HeaderProvider value={{ title: me.fullName, subtitle: me.company?.name }}>
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
          options={{ title: t.title, href: !t.perm || can(t.perm) ? undefined : null, tabBarIcon: ({ color, size }) => <Feather name={t.icon} size={size} color={color} /> }}
        />
      ))}
    </Tabs>
    </HeaderProvider>
  );
}
