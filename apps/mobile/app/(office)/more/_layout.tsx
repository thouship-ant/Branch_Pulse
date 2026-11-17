import { Stack } from 'expo-router';
import { useIsTeaShop, useTheme } from '@/lib/theme';

/** Every back-office section other than the dashboard and approvals lives here, one screen per section. */
export default function MoreLayout() {
  const th = useTheme();
  const teaShop = useIsTeaShop();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: teaShop ? 'transparent' : th.bg } }} />;
}
