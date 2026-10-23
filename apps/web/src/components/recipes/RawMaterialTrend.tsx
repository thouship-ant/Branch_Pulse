'use client';

import { Select } from '@/components/Select';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { prettyDate, shortDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { ChartCard, compact, LineChart } from '../charts';
import { PeriodPicker, usePeriod } from '../PeriodPicker';
import { ErrorBox } from '../ui';

/** What one raw material has actually cost to buy, over time — independent of any recipe. */
export function RawMaterialTrend() {
  const { t, pick } = useT();
  const [items, setItems] = useState<any[]>([]);
  const [itemId, setItemId] = useState('');
  const period = usePeriod('90');
  const { range, valid } = period;
  const [trend, setTrend] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get('/items').then(setItems).catch(() => undefined); }, []);
  useEffect(() => {
    if (!itemId || !valid) { setTrend(null); return; }
    api.get(`/recipes/raw-material-cost-trend?itemId=${itemId}&from=${range.from}&to=${range.to}`).then(setTrend).catch((e) => setError(e.message));
  }, [itemId, range.from, range.to, valid]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label htmlFor="rmi" className="label">{t('chooseRawMaterial')}</label>
          <Select id="rmi" className="field" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">{t('chooseItem')}</option>
            {items.filter((i) => i.status === 'ACTIVE').map((i) => <option key={i.id} value={i.id}>{pick(i.nameEn, i.nameTa)}</option>)}
          </Select>
        </div>
        <PeriodPicker period={period} label={t('rawMaterialTrendTitle')} />
      </div>
      <ErrorBox error={error} />
      {itemId && (
        <ChartCard
          title={t('rawMaterialTrendTitle')} empty={!trend || trend.points.length === 0} emptyText={t('noData')}
          subtitle={trend?.change ? `${t('costChangeLabel')}: ${trend.change.changePct}%` : undefined}
          table={trend ? { head: [t('dateLabel'), t('unitCostLabel')], rows: trend.points.map((p: any) => [prettyDate(p.date), formatINR(p.unitCost)]) } : undefined}
        >
          {trend && trend.points.length > 0 && (
            <LineChart
              ariaLabel={t('rawMaterialTrendTitle')} labels={trend.points.map((p: any) => p.date)}
              series={[{ key: 'cost', name: t('unitCostLabel'), color: 'var(--series-2)', values: trend.points.map((p: any) => Number(p.unitCost)) }]}
              fmt={(n) => formatINR(n)} axisFmt={(n) => compact(n, true)} xText={(d) => shortDate(d)} tipTitle={(d) => prettyDate(d)}
            />
          )}
        </ChartCard>
      )}
    </div>
  );
}
