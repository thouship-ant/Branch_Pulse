import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui';
import { useClosingDetail } from '@/components/ClosingDetailBody';

/** One branch's closing for one day: sales and cash summary, history, approve / reject / reopen. */
export default function ClosingDetail() {
  const { locationId, date } = useLocalSearchParams<{ locationId: string; date: string }>();
  const { load, body } = useClosingDetail(locationId, date);
  return <Screen title="Closing" onRefresh={load}>{body}</Screen>;
}
