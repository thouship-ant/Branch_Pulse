import { Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AndroidBottomInset } from '@/components/AndroidBottomInset';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { PushProvider } from '@/components/PushProvider';
import { ToastHost } from '@/lib/toast';
import { LanguageProvider } from '@/lib/language';
import { SessionProvider } from '@/lib/session';
import { applySavedThemeMode, useIsTeaShop, useTheme } from '@/lib/theme';

function Shell() {
  const th = useTheme();
  const teaShop = useIsTeaShop();
  const isLoginPage = usePathname() === '/login';
  useEffect(() => { void applySavedThemeMode(); }, []);
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <StatusBar style={th.dark || teaShop || isLoginPage ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: teaShop ? 'transparent' : th.bg } }} />
      <ChangePasswordModal />
      <PushProvider />
      <ToastHost />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <LanguageProvider>
          <AndroidBottomInset>
            <Shell />
          </AndroidBottomInset>
        </LanguageProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
