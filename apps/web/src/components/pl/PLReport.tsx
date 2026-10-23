'use client';

import { useT } from '@/lib/i18n';
import { dec, formatINR } from '@/lib/money';

export interface PLLines {
  label: string; from: string; to: string; totalSales: string; rawMaterial: string; salary: string; rent: string; electricity: string;
  transport: string; maintenance: string; otherExpenses: string; wastage: string; operatingProfit: string; marginPct: string | null;
  salesDays: number; avgDailySales: string;
}

/** One management P&L statement: Sales - Raw material - Salary - Rent - Electricity - Transport - Maintenance - Other - Wastage = Operating profit. */
export function PLReport({ data, subtitle }: { data: PLLines; subtitle: string }) {
  const { t } = useT();
  const lines: Array<[string, string, boolean?]> = [
    [t('rawMaterialLabel'), data.rawMaterial],
    [t('salaryLabel'), data.salary],
    [t('rentLabel'), data.rent],
    [t('electricityLabel'), data.electricity],
    [t('transportLabel'), data.transport],
    [t('maintenanceLabel'), data.maintenance],
    [t('otherExpensesLabel'), data.otherExpenses],
    [t('wastageValue'), data.wastage],
  ];
  const profit = dec(data.operatingProfit);

  return (
    <div className="space-y-4">
      <div className="card space-y-1 border-0 bg-gradient-to-br from-[#eef1ff] to-[#f6f7ff] dark:from-[#1a2747] dark:to-[#24204a]">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-dark">{data.label}</p>
        <p className="text-sm text-slate-600">{subtitle} · {t('notASale')}</p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card"><p className="text-sm text-slate-600">{t('totalSalesLabel')}</p><p className="text-xl font-bold tabular-nums">{formatINR(data.totalSales)}</p></div>
        <div className="card"><p className="text-sm text-slate-600">{t('operatingProfitLabel')}</p><p className={`text-xl font-bold tabular-nums ${profit.isNegative() ? 'text-red-700' : 'text-emerald-700'}`}>{formatINR(data.operatingProfit)}</p></div>
        <div className="card"><p className="text-sm text-slate-600">{t('marginLabel')}</p><p className="text-xl font-bold tabular-nums">{data.marginPct !== null ? `${data.marginPct}%` : '—'}</p></div>
        <div className="card"><p className="text-sm text-slate-600">{t('avgDailySalesLabel')}</p><p className="text-xl font-bold tabular-nums">{formatINR(data.avgDailySales)}</p><p className="text-xs text-slate-500">{data.salesDays} {t('salesDaysLabel').toLowerCase()}</p></div>
      </section>

      <section className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            <tr className="bg-slate-50 font-semibold"><td className="px-4 py-2.5">{t('totalSalesLabel')}</td><td className="px-4 py-2.5 text-right tabular-nums">{formatINR(data.totalSales)}</td></tr>
            {lines.map(([label, value]) => (
              <tr key={label}>
                <td className="px-4 py-2 text-slate-700">− {label}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatINR(value)}</td>
              </tr>
            ))}
            <tr className={`border-t-2 font-bold ${profit.isNegative() ? 'text-red-700' : 'text-emerald-700'}`}>
              <td className="px-4 py-3">= {t('operatingProfitLabel')}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatINR(data.operatingProfit)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
