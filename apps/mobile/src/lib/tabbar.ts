import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';

/** Bottom tab bar look shared by every layout: rounded top, roomy touch targets, clear of the phone's navigation buttons. */
export function useTabBarOptions() {
  const th = useTheme();
  const insets = useSafeAreaInsets(); // already floored on Android by AndroidBottomInset
  const bottom = Math.max(insets.bottom, 14); // always some room under the labels (web preview, iOS without a home bar ...)
  return {
    tabBarStyle: {
      backgroundColor: th.surface, borderTopWidth: 0, elevation: 16, shadowColor: '#1e2a8a', shadowOpacity: 0.1, shadowRadius: 14,
      borderTopLeftRadius: 22, borderTopRightRadius: 22, height: 62 + bottom, paddingTop: 8, paddingBottom: bottom,
    },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '600' as const, marginTop: 2, marginBottom: 0 },
    tabBarItemStyle: { paddingVertical: 0 },
    tabBarAllowFontScaling: false,
  };
}
