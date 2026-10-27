import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/lib/session';
import { useTheme } from '@/lib/theme';

function Shell() {
  const th = useTheme();
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: th.bg } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
