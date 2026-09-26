'use client';

import Link from 'next/link';
import { CashReconciliation } from '@/components/cash/CashReconciliation';
import { Skeleton } from '@/components/ui';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { useBranch } from '@/lib/useBranch';

/** The branch manager's own cash reconciliation for today (also reachable as step 1 of the closing). */
export default function BranchCashPage() {
  const { t } = useT();
  const { locationId, date } = useBranch();
  if (!locationId) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">{prettyDate(date)}</p>
        <h2 className="text-xl font-bold">{t('cashRecon')}</h2>
      </div>
      <CashReconciliation locationId={locationId} date={date} />
      <Link href="/b/closing" className="btn-secondary w-full">{t('closing')} →</Link>
    </div>
  );
}
