'use client';

import { useCallback, useEffect, useState } from 'react';
import { PurchaseForm } from '@/components/purchases/PurchaseForm';
import { StockLevels } from '@/components/purchases/StockLevels';
import { Sheet, Warnings } from '@/components/ui';
import { api, type Warning } from '@/lib/api';
import { addDays, prettyDate, todayIST } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { STATUS_KEY } from '@/lib/labels';
import { dec, formatINR } from '@/lib/money';
import { useOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { useBranch } from '@/lib/useBranch';

/** Branch manager: buy stock (cash, credit or part payment), see the recent purchases, and what is on the shelf. */
export default function StockPage() {
  const { t, pick } = useT();
  const { can } = useSession();
  const { locationId } = useBranch();
  const { ops, waiting } = useOutbox(locationId);
  const [list, setList] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ queued: boolean; warnings: Warning[] } | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    if (!locationId) return;
    try { setList(await api.get(`/purchases?locationId=${locationId}&from=${addDays(todayIST(), -6)}&to=${todayIST()}&pageSize=20`)); } catch { /* offline: only queued entries */ }
  }, [locationId]);
  useEffect(() => { void load(); }, [load, waiting]);

  const queued = ops.filter((o) => o.entityType === 'PURCHASE' && o.state !== 'DONE');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{t('stock')}</h2>
        {can('purchase:create') && <button className="btn-primary" onClick={() => { setNotice(null); setAdding(true); }}>+ {t('newPurchase')}</button>}
      </div>
      {notice && (
        <div role="status" className="space-y-2 rounded-card border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p>✓ {notice.queued ? t('offline') : t('purchaseSaved')}</p>
          <Warnings items={notice.warnings} />
        </div>
      )}

      <section aria-label={t('purchases')} className="space-y-2">
        <h3 className="font-semibold">{t('purchases')}</h3>
        {queued.length === 0 && list.length === 0 && <p className="card text-sm text-slate-600">{t('noPurchases')}</p>}
        <ul className="space-y-2">
          {queued.map((o) => (
            <li key={o.clientUuid} className="card flex items-center justify-between opacity-80">
              <span>{prettyDate(o.businessDate)}</span>
              <span className="tabular-nums">⟳ {(o.payload.items as any[]).length} {t('itemsLabel')}</span>
            </li>
          ))}
          {list.map((p) => {
            const st = p.status !== 'ACTIVE' ? p.status : p.approvalStatus;
            return (
              <li key={p.id} className="card space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{p.supplierName}</p>
                    <p className="text-xs text-slate-500">{prettyDate(String(p.businessDate).slice(0, 10))} · {p.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{formatINR(p.totalAmount)}</p>
                    <p className="text-xs text-slate-500">{STATUS_KEY[st] ? t(STATUS_KEY[st]) : st}</p>
                  </div>
                </div>
                <p className="truncate text-xs text-slate-600">{(p.items as any[]).map((i) => `${pick(i.itemName, i.itemNameTa)} ${dec(i.quantity).toString()} ${i.unitCode}`).join(', ')}</p>
                {dec(p.creditAmount).greaterThan(0) && <p className="text-xs text-amber-800">◔ {t('creditLeft')}: {formatINR(p.creditAmount)}{p.dueDate ? ` · ${t('dueDate')} ${prettyDate(String(p.dueDate).slice(0, 10))}` : ''}</p>}
                {p.approvalStatus === 'REJECTED' && p.rejectionReason && <p className="text-xs text-red-700">✕ {p.rejectionReason}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label={t('stockOnHand')} className="space-y-2">
        <h3 className="font-semibold">{t('stockOnHand')}</h3>
        {locationId && <StockLevels locations={[]} fixedLocationId={locationId} refreshKey={refresh} />}
      </section>

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('newPurchase')}>
        <PurchaseForm locations={[]} fixedLocationId={locationId} onSaved={(r) => { setAdding(false); setNotice(r); setRefresh((n) => n + 1); void load(); }} />
      </Sheet>
    </div>
  );
}
