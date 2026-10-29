import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

/** Every back-office section other than the dashboard and approvals lives here, one screen per section. */
export default function MoreLayout() {
  const th = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: th.bg } }} />;
}
