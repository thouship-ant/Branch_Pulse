import { useEffect, type ReactNode } from 'react';
import * as NavigationBar from 'expo-navigation-bar';
import { Platform } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

// Some edge-to-edge Android phones under-report the bottom inset of the 3-button navigation bar (square, circle, back),
// which lets the tab bar and footer buttons sit underneath it. Floor the inset so everything clears the system bar.
const ANDROID_NAV_BAR_MIN = 20;

export function AndroidBottomInset({ children }: { children: ReactNode }) {
  const th = useTheme();
  // dark buttons on a light app, light buttons on a dark one, so the system icons stay visible
  useEffect(() => {
    if (Platform.OS === 'android') NavigationBar.setButtonStyleAsync(th.dark ? 'light' : 'dark').catch(() => {});
  }, [th.dark]);

  return (
    <SafeAreaInsetsContext.Consumer>
      {(insets) => {
        if (Platform.OS !== 'android' || !insets) return <>{children}</>;
        return <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: Math.max(insets.bottom, ANDROID_NAV_BAR_MIN) }}>{children}</SafeAreaInsetsContext.Provider>;
      }}
    </SafeAreaInsetsContext.Consumer>
  );
}
