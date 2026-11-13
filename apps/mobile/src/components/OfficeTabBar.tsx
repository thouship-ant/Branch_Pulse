import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { ACCENT, Sheet, type AccentName } from '@/components/ui';
import { tr } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useAttention } from '@/lib/useAttention';

type F = React.ComponentProps<typeof Feather>['name'];
interface Link { path: string; title: string; icon: F | 'wallet'; perm?: string; match: string }

/** Same order as the web app: the first four a person may open sit on the bar; the rest, then Account, are under More. */
const LINKS: Link[] = [
  { path: '/dashboard', title: 'Home', icon: 'home', perm: 'dashboard:view', match: '/dashboard' },
  { path: '/approvals', title: 'Approvals', icon: 'check', perm: 'expense:approve', match: '/approvals' },
  { path: '/more/closings', title: 'Closings', icon: 'clock', perm: 'closing:view', match: '/more/closing' },
  { path: '/more/cash', title: 'Cash', icon: 'wallet', perm: 'cash:view', match: '/more/cash' },
  { path: '/more/orders', title: 'Orders', icon: 'calendar', perm: 'order:view', match: '/more/orders' },
  { path: '/more/expenses', title: 'Expenses', icon: 'credit-card', perm: 'expense:view', match: '/more/expenses' },
  { path: '/more/purchases', title: 'Purchases', icon: 'shopping-bag', perm: 'purchase:view', match: '/more/purchases' },
  { path: '/more/pl', title: 'Management P&L', icon: 'trending-up', perm: 'pl:view', match: '/more/pl' },
  { path: '/more/inventory', title: 'Inventory', icon: 'box', perm: 'stock:view', match: '/more/inventory' },
  { path: '/more/recipes', title: 'Recipes', icon: 'menu', perm: 'recipe:view', match: '/more/recipes' },
  { path: '/more/branches', title: 'Branches', icon: 'map-pin', perm: 'location:manage', match: '/more/branches' },
  { path: '/more/employees', title: 'Employees', icon: 'users', perm: 'staff:view', match: '/more/employees' },
  { path: '/more/users', title: 'Users', icon: 'user-check', perm: 'user:manage', match: '/more/users' },
  { path: '/more/settings', title: 'Settings', icon: 'sliders', perm: 'settings:manage', match: '/more/settings' },
  { path: '/account', title: 'Account', icon: 'user', match: '/account' },
];
const SLOTS = 4;
/** Each section keeps its own colour in the More menu (the Daily Meat admin palette). */
const TINT: Record<string, AccentName> = {
  '/more/orders': 'blue', '/more/expenses': 'amber', '/more/purchases': 'purple', '/more/pl': 'green', '/more/inventory': 'sky', '/more/recipes': 'rose',
  '/more/branches': 'red', '/more/employees': 'blue', '/more/users': 'purple', '/more/settings': 'amber', '/account': 'green',
  '/more/cash': 'green', '/more/closings': 'amber',
};

function Ico({ icon, size, color }: { icon: Link['icon']; size: number; color: string }) {
  return icon === 'wallet' ? <MaterialCommunityIcons name="wallet-outline" size={size + 1} color={color} /> : <Feather name={icon} size={size} color={color} />;
}

export function OfficeTabBar() {
  const th = useTheme();
  const router = useRouter();
  const path = usePathname();
  const { can } = useSession();
  const att = useAttention();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const cell = Math.floor((winW - 32 - 20) / 3); // sheet padding 16+16, two 10px gaps: always three per row
  const [more, setMore] = useState(false);
  const links = LINKS.filter((l) => !l.perm || can(l.perm));
  const rest = links.filter((l) => l.path !== '/account');
  let main = rest.length > SLOTS + 1 ? rest.slice(0, SLOTS) : rest;
  let overflow = links.filter((l) => !main.includes(l));
  // a "More" that would hold a single entry (Account for a Stock Manager) is pointless: show that entry on the bar itself
  if (overflow.length === 1 && main.length <= SLOTS) { main = [...main, overflow[0]]; overflow = []; }
  const isActive = (l: Link) => path === l.match || path.startsWith(l.match + '/') || (l.match === '/more/closing' && path.startsWith('/more/closing'));
  const badge = (l: Link) => (l.path === '/approvals' ? { n: att.waiting, bg: '#dc2626' } : l.path === '/more/closings' ? { n: att.unclosedBranches, bg: '#f59e0b' } : { n: 0, bg: '' });
  const bottom = Math.max(insets.bottom, 14);
  const moreActive = overflow.some(isActive);

  const Slot = ({ active, label, onPress, children, n, bg }: { active: boolean; label: string; onPress: () => void; children: React.ReactNode; n?: number; bg?: string }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <View style={{ width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? th.brandLight : 'transparent' }}>
        {children}
        {n && n > 0 ? (
          <View style={{ position: 'absolute', top: -2, right: 6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            <Text allowFontScaling={false} style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{n}</Text>
          </View>
        ) : null}
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: 11, fontWeight: '600', color: active ? th.brand : th.muted }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <View style={{ flexDirection: 'row', paddingHorizontal: 6, paddingTop: 6, paddingBottom: bottom, backgroundColor: th.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, elevation: 16, shadowColor: '#1e2a8a', shadowOpacity: 0.1, shadowRadius: 14 }}>
        {main.map((l) => {
          const b = badge(l);
          const a = isActive(l);
          return (
            <Slot key={l.path} active={a} label={tr(l.title)} n={b.n} bg={b.bg} onPress={() => router.navigate(l.path as any)}>
              <Ico icon={l.icon} size={21} color={a ? th.brand : th.muted} />
            </Slot>
          );
        })}
        {overflow.length > 0 ? (
          <Slot active={moreActive} label={tr('More')} onPress={() => setMore(true)}>
            <Feather name="more-horizontal" size={23} color={moreActive ? th.brand : th.muted} />
          </Slot>
        ) : null}
      </View>
      <Sheet open={more} onClose={() => setMore(false)} title={tr('More')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {overflow.map((l) => {
            const a = isActive(l);
            return (
              <Pressable
                key={l.path} accessibilityRole="button" onPress={() => { setMore(false); router.navigate(l.path as any); }}
                style={{ width: cell, minHeight: 96, borderRadius: 14, borderWidth: 1, borderColor: a ? th.brand : th.border, backgroundColor: a ? th.brandLight : th.surface, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: ACCENT[TINT[l.path] ?? 'blue'].bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Ico icon={l.icon} size={22} color={ACCENT[TINT[l.path] ?? 'blue'].fg} />
                </View>
                <Text style={{ color: a ? th.brand : th.ink, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{tr(l.title)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}
