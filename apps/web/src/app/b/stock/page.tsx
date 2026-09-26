'use client';

import { useT } from '@/lib/i18n';

export default function StockPage() {
  const { t } = useT();
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{t('stock')}</h2>
      <div className="card text-slate-600">
        <p>{t('comingSoon')}</p>
        <p className="mt-2 text-sm">Transfers, stock counts and wastage entry arrive with the Stock &amp; Purchase phase of the release plan.</p>
      </div>
    </div>
  );
}
