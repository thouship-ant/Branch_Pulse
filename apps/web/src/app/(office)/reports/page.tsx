'use client';

import { mdiChartBoxOutline } from '@mdi/js';
import { DashboardCharts } from '@/components/DashboardCharts';
import { SalesClosingCards } from '@/components/SalesClosingCards';
import { PageTitle } from '@/components/TeaParts';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Reports: last week's sales, the branches that have not closed, and all the charts. */
export default function ReportsPage() {
  const { t } = useT();
  const { can } = useSession();
  if (!can('dashboard:view')) return <p className="card">{t('noAccess')}</p>;
  return (
    <div className="space-y-4">
      <PageTitle mdi={mdiChartBoxOutline} title={t('reportsTitle')} subtitle={t('reportsSub')} />
      <SalesClosingCards />
      <DashboardCharts />
    </div>
  );
}
