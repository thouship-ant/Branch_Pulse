import { PurchaseList } from '@/components/Purchasing';
import { Heading, Loading, Screen } from '@/components/ui';
import { prettyDate } from '@/lib/dates';
import { useBranch } from '@/lib/session';
import { useWorkDate } from '@/lib/workDate';

/** The day's purchases from suppliers, with the new-purchase form (between Sales and Expense in the day's entry). */
export default function PurchasesScreen() {
  const { locationId } = useBranch();
  const date = useWorkDate();
  if (!locationId) return <Screen><Loading page /></Screen>;
  return (
    <Screen top={<Heading onBlue sub={prettyDate(date)} title="Purchases" />}>
      <PurchaseList fixedLocationId={locationId} period={{ id: 'custom', from: date, to: date }} />
    </Screen>
  );
}
