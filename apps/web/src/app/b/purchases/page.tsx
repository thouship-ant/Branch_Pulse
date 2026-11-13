'use client';

import { BackdateRequests } from '@/components/BackdateRequests';
import { PurchasesTab } from '@/components/branch/PurchasesTab';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { useBranch } from '@/lib/useBranch';

/** The day's purchases from suppliers, with the new-purchase form (between Sales and Expense in the day's entry). */
export default function PurchasesPage() {
  const { t } = useT();
  const { locationId, date } = useBranch();
  if (!locationId) return null;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">{prettyDate(date)}</p>
        <h2 className="text-xl font-bold">{t('purchases')}</h2>
      </div>
      <BackdateRequests locationId={locationId} />
      <PurchasesTab locationId={locationId} day={date} />
    </div>
  );
}
