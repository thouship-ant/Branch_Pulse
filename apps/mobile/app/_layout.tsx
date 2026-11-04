import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AndroidBottomInset } from '@/components/AndroidBottomInset';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { LanguageProvider } from '@/lib/language';
import { SessionProvider } from '@/lib/session';
import { useTheme } from '@/lib/theme';

function Shell() {
  const th = useTheme();
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: th.bg } }} />
      <ChangePasswordModal />
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
