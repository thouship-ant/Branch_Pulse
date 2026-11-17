import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AndroidBottomInset } from '@/components/AndroidBottomInset';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { PushProvider } from '@/components/PushProvider';
import { ToastHost } from '@/lib/toast';
import { LanguageProvider } from '@/lib/language';
import { SessionProvider } from '@/lib/session';
import { applySavedThemeMode, useTheme } from '@/lib/theme';

function Shell() {
  const th = useTheme();
  useEffect(() => { void applySavedThemeMode(); }, []);
  return (
    <>
      <StatusBar style={th.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: th.bg } }} />
      <ChangePasswordModal />
      <PushProvider />
      <ToastHost />
    </>
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
