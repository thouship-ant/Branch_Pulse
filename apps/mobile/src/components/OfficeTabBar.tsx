import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { Sheet } from '@/components/ui';
import { tr } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useAttention } from '@/lib/useAttention';

type F = React.ComponentProps<typeof Feather>['name'];
interface Link { path: string; title: string; icon: F | 'wallet' | 'approval'; perm?: string; match: string }

/** The five primary sections are visible on the bar; the rest, then Account, are under More. */
const LINKS: Link[] = [
  { path: '/dashboard', title: 'Home', icon: 'home', perm: 'dashboard:view', match: '/dashboard' },
  { path: '/approvals', title: 'Approvals', icon: 'approval', perm: 'expense:approve', match: '/approvals' },
  { path: '/more/orders', title: 'Orders', icon: 'calendar', perm: 'order:view', match: '/more/orders' },
  { path: '/more/purchases', title: 'Purchases', icon: 'shopping-bag', perm: 'purchase:view', match: '/more/purchases' },
  { path: '/reports', title: 'Reports', icon: 'bar-chart-2', perm: 'dashboard:view', match: '/reports' },
  { path: '/more/closings', title: 'Closings', icon: 'clock', perm: 'closing:view', match: '/more/closing' },
  { path: '/more/cash', title: 'Cash', icon: 'wallet', perm: 'cash:view', match: '/more/cash' },
  { path: '/more/expenses', title: 'Expenses', icon: 'credit-card', perm: 'expense:view', match: '/more/expenses' },
  { path: '/more/pl', title: 'Management P&L', icon: 'trending-up', perm: 'pl:view', match: '/more/pl' },
  { path: '/more/inventory', title: 'Inventory', icon: 'box', perm: 'stock:view', match: '/more/inventory' },
  { path: '/more/recipes', title: 'Recipes', icon: 'menu', perm: 'recipe:view', match: '/more/recipes' },
  { path: '/more/branches', title: 'Branches', icon: 'map-pin', perm: 'location:manage', match: '/more/branches' },
  { path: '/more/employees', title: 'Employees', icon: 'users', perm: 'staff:view', match: '/more/employees' },
  { path: '/more/users', title: 'Users', icon: 'user-check', perm: 'user:manage', match: '/more/users' },
  { path: '/more/settings', title: 'Settings', icon: 'sliders', perm: 'settings:manage', match: '/more/settings' },
  { path: '/account', title: 'Account', icon: 'user', match: '/account' },
];
const SLOTS = 5;
/** Each section has a colour of its own in the More menu (no two share one): `fg` for the icon chip and edge, `bg` for the tile. */
const TILE: Record<string, { fg: string; bg: string }> = {
  '/more/closings': { fg: '#D97706', bg: '#FDEBC8' },
  '/more/cash': { fg: '#16A34A', bg: '#D8F3DF' },
  '/more/expenses': { fg: '#EA580C', bg: '#FFE1CF' },
  '/more/purchases': { fg: '#C026D3', bg: '#F8DEFB' },
  '/more/orders': { fg: '#2563EB', bg: '#DCE8FD' },
  '/more/pl': { fg: '#0D9488', bg: '#D3F2EE' },
  '/more/inventory': { fg: '#0284C7', bg: '#D6ECFA' },
  '/more/recipes': { fg: '#DB2777', bg: '#FCE0EE' },
  '/more/branches': { fg: '#DC2626', bg: '#FEE0E0' },
  '/more/employees': { fg: '#4F46E5', bg: '#E3E3FC' },
  '/more/users': { fg: '#7C3AED', bg: '#E9DDFB' },
  '/more/settings': { fg: '#475569', bg: '#E3E8EF' },
  '/account': { fg: '#65A30D', bg: '#E6F4CC' },
};

/** Relative brightness 0..1 of a #RRGGBB colour. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function Ico({ icon, size, color }: { icon: Link['icon']; size: number; color: string }) {
  if (icon === 'approval') return <MaterialCommunityIcons name="check-decagram-outline" size={size + 3} color={color} />; // the same seal as the Approvals page title
  return icon === 'wallet' ? <MaterialCommunityIcons name="wallet-outline" size={size + 1} color={color} /> : <Feather name={icon} size={size} color={color} />;
}

export function OfficeTabBar() {
  const th = useTheme();
  const router = useRouter();
  const path = usePathname();
  const { can, me } = useSession();
  const teaShop = me?.company?.businessType === 'TEA_SHOP';
  // a colour chosen for the company by the Super Admin wins over the theme's own bar colour; text and icons follow its brightness
  const custom = /^#[0-9A-Fa-f]{6}$/.test(me?.company?.businessNavColor ?? '') ? me!.company!.businessNavColor! : null;
  const lightBar = custom ? luminance(custom) > 0.6 : false;
  const barBg = custom ?? (teaShop ? '#3c1708' : th.surface);
  const activeColor = custom ? (lightBar ? '#1f1209' : '#ffffff') : teaShop ? '#3c1708' : th.brand;
  const inactiveColor = custom ? (lightBar ? 'rgba(31,18,9,0.65)' : 'rgba(255,255,255,0.75)') : teaShop ? '#f4dfc8' : th.muted;
  const pillBg = custom ? (lightBar ? 'rgba(31,18,9,0.12)' : 'rgba(255,255,255,0.22)') : teaShop ? '#ffe9c2' : th.brandLight;
  const pillText = custom ? activeColor : teaShop ? '#ffe9c2' : th.brand;
  const att = useAttention();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const cell = Math.floor((winW - 32 - 20) / 3); // sheet padding 16+16, two 10px gaps: always three per row
  const [more, setMore] = useState(false);
  const links = LINKS.filter((l) => !l.perm || can(l.perm));
  const rest = links.filter((l) => l.path !== '/account');
  let main = rest.length > SLOTS ? rest.slice(0, SLOTS) : rest;
  let overflow = links.filter((l) => !main.includes(l));
  // a "More" that would hold a single entry (Account for a Stock Manager) is pointless: show that entry on the bar itself
  if (overflow.length === 1 && main.length <= SLOTS) { main = [...main, overflow[0]]; overflow = []; }
  const isActive = (l: Link) => path === l.match || path.startsWith(l.match + '/') || (l.match === '/more/closing' && path.startsWith('/more/closing'));
  const badge = (l: Link) => (l.path === '/approvals' ? { n: att.waiting, bg: '#dc2626' } : l.path === '/more/closings' ? { n: att.unclosedBranches, bg: '#f59e0b' } : { n: 0, bg: '' });
  const bottom = Math.max(insets.bottom, 4); // a little room under the labels where there is no system bar (web preview, iOS without a home bar ...)
  const moreActive = overflow.some(isActive);

  const Slot = ({ active, label, onPress, children, n, bg }: { active: boolean; label: string; onPress: () => void; children: React.ReactNode; n?: number; bg?: string }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <View style={{ width: teaShop ? 58 : 56, height: teaShop ? 34 : 32, borderRadius: teaShop ? 12 : 16, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? pillBg : 'transparent' }}>
        {children}
        {n && n > 0 ? (
          <View style={{ position: 'absolute', top: -2, right: 6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            <Text allowFontScaling={false} style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{n}</Text>
          </View>
        ) : null}
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: 11, fontWeight: '600', color: active ? pillText : inactiveColor }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <View style={{ flexDirection: 'row', paddingHorizontal: 6, paddingTop: 6, paddingBottom: bottom, backgroundColor: barBg, borderTopLeftRadius: 22, borderTopRightRadius: 22, elevation: 16, shadowColor: custom ?? (teaShop ? '#3c1708' : th.brand), shadowOpacity: 0.16, shadowRadius: 14 }}>
        {main.map((l) => {
          const b = badge(l);
          const a = isActive(l);
          return (
            <Slot key={l.path} active={a} label={tr(l.title)} n={b.n} bg={b.bg} onPress={() => router.navigate(l.path as any)}>
              <Ico icon={l.icon} size={21} color={a ? activeColor : inactiveColor} />
            </Slot>
          );
        })}
        {overflow.length > 0 ? (
          <Slot active={moreActive} label={tr('More')} onPress={() => setMore(true)}>
            <Feather name="more-horizontal" size={23} color={moreActive ? activeColor : inactiveColor} />
          </Slot>
        ) : null}
      </View>
      <Sheet open={more} onClose={() => setMore(false)} title={tr('More')} themed={teaShop}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {overflow.map((l) => {
            const a = isActive(l);
            const tint = TILE[l.path] ?? { fg: '#6d2f12', bg: '#f3e6d6' };
            return (
              <Pressable
                key={l.path} accessibilityRole="button" onPress={() => { setMore(false); router.navigate(l.path as any); }}
                style={({ pressed }) => ({ width: cell, minHeight: 100, borderRadius: 18, borderWidth: a ? 2 : 1, borderColor: a ? tint.fg : '#ffffff', backgroundColor: tint.bg, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8, opacity: pressed ? 0.85 : 1, shadowColor: tint.fg, shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 })}
              >
                <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: tint.fg, alignItems: 'center', justifyContent: 'center', shadowColor: tint.fg, shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
                  <Ico icon={l.icon} size={23} color="#fff" />
                </View>
                <Text style={{ color: '#3b2418', fontSize: 12, fontWeight: '800', textAlign: 'center' }}>{tr(l.title)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}
