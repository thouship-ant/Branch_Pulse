'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { prettyDate, todayIST } from '@/lib/dates';
import { useT, type MessageKey } from '@/lib/i18n';
import { formatINR } from '@/lib/money';
import { useSession } from '@/lib/session';

const money = (v: unknown) => formatINR(String(v ?? 0), { decimals: false });
const PAY: Record<string, { key: MessageKey; cls: string; icon: string }> = {
  UNPAID: { key: 'oUnpaid', cls: 'border-red-300 bg-red-50 text-red-800', icon: '○' },
  PARTIAL: { key: 'oPartial', cls: 'border-amber-300 bg-amber-50 text-amber-900', icon: '◐' },
  PAID: { key: 'oPaidFull', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800', icon: '●' },
};

/** Dashboard block: outside-shop orders (meetings, functions ...) coming up, and how much of their value is still to be paid. */
export function DashboardOrders() {
  const { t, pick } = useT();
  const { can } = useSession();
  const [sum, setSum] = useState<any>(null);
  const [next, setNext] = useState<any[]>([]);
  useEffect(() => {
    if (!can('order:view')) return;
    api_load();
    async function api_load() {
      const { api } = await import('@/lib/api');
      try {
        const [s, rows] = await Promise.all([api.get('/orders/summary'), api.get<any[]>(`/orders?status=PLANNED&from=${todayIST()}`)]);
        setSum(s); setNext([...rows].sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate))).slice(0, 5));
      } catch { /* the block is optional */ }
    }
  }, [can]);
  if (!sum) return null;
  return (
    <section aria-label={t('ordersTitle')} className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold">{t('ordersTitle')}</h3>
          <p className="text-sm text-slate-600">{t('oOrdersLead')}</p>
        </div>
        <Link href="/orders" className="btn-secondary min-h-[40px] px-4 text-sm">{t('view')} →</Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{t('oUpcoming')}</p><p className="text-xl font-bold tabular-nums">{sum.upcoming}</p></div>
        {(['UNPAID', 'PARTIAL', 'PAID'] as const).map((k) => (
          <div key={k} className={`rounded-xl border p-3 ${PAY[k].cls}`}><p className="text-xs font-semibold"><span aria-hidden>{PAY[k].icon} </span>{t(PAY[k].key)}</p><p className="text-xl font-bold tabular-nums">{sum.counts[k]}</p></div>
        ))}
      </div>
      <p className="text-sm">{t('oOutstanding')}: <b className="tabular-nums text-red-700">{money(sum.outstanding)}</b> <span className="text-slate-500">/ {t('oTotalValue')} {money(sum.totalValue)}</span></p>
      {next.length > 0 && (
        <ul className="divide-y divide-slate-200">
          {next.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0"><b>{o.customerName}</b> <span className="text-slate-600">· {t(`et${o.eventType}` as MessageKey)} · {prettyDate(o.eventDate)} · {pick(o.locationName, o.locationNameTa)}</span></span>
              <span className="flex items-center gap-2"><b className="tabular-nums">{money(o.amount)}</b><span className={`chip ${PAY[o.paymentStatus].cls}`}><span aria-hidden>{PAY[o.paymentStatus].icon}</span>{t(PAY[o.paymentStatus].key)}</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
