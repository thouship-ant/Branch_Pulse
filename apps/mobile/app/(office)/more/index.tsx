import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';
import { Empty, LinkCard, Screen } from '@/components/ui';
import { MENU } from '@/lib/menu';
import { useSession } from '@/lib/session';
import { useIsTeaShop, useTheme } from '@/lib/theme';

type Mdi = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Tea-shop "More" grid: the sections that are not already a tab, in the order and colours of the design. */
const TILES: Array<{ path: string; title: string; icon: Mdi; bg: string; fg: string }> = [
  { path: '/more/orders', title: 'Orders', icon: 'calendar-month-outline', bg: '#fbe3c2', fg: '#8a3b12' },
  { path: '/more/expenses', title: 'Expenses', icon: 'credit-card-outline', bg: '#fbe3c2', fg: '#a4501f' },
  { path: '/more/purchases', title: 'Purchases', icon: 'shopping-outline', bg: '#fadada', fg: '#9b2c3a' },
  { path: '/more/pl', title: 'Management P&L', icon: 'chart-line', bg: '#ddf0d4', fg: '#2f8f3a' },
  { path: '/more/inventory', title: 'Inventory', icon: 'cube-outline', bg: '#dce6fb', fg: '#1d4fb8' },
  { path: '/more/recipes', title: 'Recipes', icon: 'menu', bg: '#fadada', fg: '#8c1d3a' },
  { path: '/more/branches', title: 'Branches', icon: 'storefront-outline', bg: '#fbdcd2', fg: '#a8321e' },
  { path: '/more/employees', title: 'Employees', icon: 'account-outline', bg: '#dce6fb', fg: '#1d4fb8' },
  { path: '/more/users', title: 'Users', icon: 'account-multiple-outline', bg: '#ebd9f7', fg: '#6b2a98' },
  { path: '/more/settings', title: 'Settings', icon: 'tune-variant', bg: '#fbe3c2', fg: '#8a3b12' },
  { path: '/account', title: 'Account', icon: 'account-circle-outline', bg: '#f3e6d6', fg: '#6a351c' },
];

/** All back-office sections the signed-in user may open. */
export default function MoreScreen() {
  const th = useTheme();
  const router = useRouter();
  const teaShop = useIsTeaShop();
  const { can } = useSession();
  const perm = (path: string) => MENU.flatMap((g) => g.items).find((i) => i.path === path)?.perm;
  const tiles = TILES.filter((t) => { const p = perm(t.path); return !p || can(p); });
  const close = (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="x" size={28} color="#fff" />
    </Pressable>
  );

  if (teaShop) {
    return (
      <Screen headerSubtitle="More" headerRight={close}>
        {tiles.length === 0 ? <Empty text="Nothing else to show for your role." /> : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {tiles.map((t) => (
              <Pressable
                key={t.path} accessibilityRole="button" accessibilityLabel={t.title} onPress={() => router.push(t.path as any)}
                style={({ pressed }) => ({ width: '31.5%', minHeight: 116, paddingHorizontal: 6, paddingVertical: 12, gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: th.border, backgroundColor: th.dark ? th.surface : 'rgba(255,250,244,0.96)', opacity: pressed ? 0.85 : 1, shadowColor: '#45220f', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 })}
              >
                <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name={t.icon} size={30} color={t.fg} />
                </View>
                <Text numberOfLines={2} style={{ color: th.ink, fontSize: 14, fontWeight: '800', textAlign: 'center', lineHeight: 18 }}>{t.title}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Screen>
    );
  }

  const groups = MENU.map((g) => ({ ...g, items: g.items.filter((i) => can(i.perm)) })).filter((g) => g.items.length);
  return (
    <Screen>
      {groups.length === 0 ? <Empty text="Nothing else to show for your role." /> : groups.map((g) => (
        <View key={g.title} style={{ gap: 10 }}>
          <Text style={{ color: th.muted, fontSize: 13, fontWeight: '800', letterSpacing: 0.6 }}>{g.title.toUpperCase()}</Text>
          {g.items.map((i) => <LinkCard key={i.path} icon={i.icon} title={i.title} detail={undefined} onPress={() => router.push(i.path as any)} right={<Text style={{ color: th.faint, fontSize: 12, maxWidth: 140 }} numberOfLines={2}>{i.hint}</Text>} />)}
        </View>
      ))}
    </Screen>
  );
}
