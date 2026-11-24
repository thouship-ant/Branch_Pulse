import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui';
import { useCashDetail } from '@/components/CashDetailBody';

/** One branch's cash for one day as the Admin / Accountant sees it: workings, count, difference, explanation, decision. */
export default function CashDetail() {
  const { locationId, date } = useLocalSearchParams<{ locationId: string; date: string }>();
  const { load, body } = useCashDetail(locationId, date);
  return <Screen title="Cash" onRefresh={load}>{body}</Screen>;
}
