import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from './session';
import { useTheme } from './theme';

/** Bottom tab bar look shared by every layout: rounded top, roomy touch targets, clear of the phone's navigation buttons. */
export function useTabBarOptions() {
  const th = useTheme();
  const teaShop = useSession().me?.company?.businessType === 'TEA_SHOP';
  const insets = useSafeAreaInsets(); // already floored on Android by AndroidBottomInset
  const bottom = Math.max(insets.bottom, 6); // a little room under the labels where there is no system bar (web preview, iOS without a home bar ...)
  // Tea Shop theme: same dark-brown bar as the office bar (OfficeTabBar)
  const tea = teaShop
    ? { tabBarActiveTintColor: '#ffe9c2', tabBarInactiveTintColor: '#f4dfc8', tabBarActiveBackgroundColor: 'rgba(255,233,194,0.16)' }
    : {};
  return {
    ...tea,
    tabBarStyle: {
      backgroundColor: teaShop ? '#3c1708' : th.surface, borderTopWidth: 0, elevation: 16, shadowColor: teaShop ? '#3c1708' : '#1e2a8a', shadowOpacity: 0.1, shadowRadius: 14,
      borderTopLeftRadius: 22, borderTopRightRadius: 22, height: 62 + bottom, paddingTop: 8, paddingBottom: bottom + 2,
    },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const, marginTop: 2, marginBottom: 0 },
    tabBarItemStyle: { paddingVertical: 0, ...(teaShop ? { borderRadius: 14, marginHorizontal: 3 } : {}) },
    tabBarAllowFontScaling: false,
  };
}
