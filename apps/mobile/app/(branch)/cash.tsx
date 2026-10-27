import { useRouter } from 'expo-router';
import { CashRecon } from '@/components/CashRecon';
import { Button, Heading, Loading, Screen } from '@/components/ui';
import { prettyDate, todayIST } from '@/lib/dates';
import { useBranch } from '@/lib/session';

/** The branch manager's own cash reconciliation for today (also step 1 of the closing). */
export default function CashScreen() {
  const router = useRouter();
  const { locationId } = useBranch();
  const date = todayIST();
  if (!locationId) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      <Heading sub={prettyDate(date)} title="Cash reconciliation" />
      <CashRecon locationId={locationId} date={date} />
      <Button title="Go to closing →" variant="secondary" onPress={() => router.push('/closing')} />
    </Screen>
  );
}
