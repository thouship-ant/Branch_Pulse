'use client';

import { api } from '@/lib/api';
import { useT, type MessageKey } from '@/lib/i18n';

const STATES: Record<string, { icon: string; cls: string; key: MessageKey }> = {
  DRAFT: { icon: '○', cls: 'border-slate-300 bg-slate-100 text-slate-700', key: 'vsDraft' },
  SUBMITTED: { icon: '◔', cls: 'border-amber-300 bg-amber-50 text-amber-800', key: 'vsSent' },
  APPROVED: { icon: '✓', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800', key: 'approved' },
  REJECTED: { icon: '✕', cls: 'border-red-300 bg-red-50 text-red-800', key: 'rejected' },
};

/** Where a cash difference stands. Icon + word, never colour alone. */
export function VarianceChip({ status }: { status: string | null | undefined }) {
  const { t } = useT();
  if (!status) return null;
  const s = STATES[status] ?? STATES.DRAFT;
  return <span className={`chip ${s.cls}`}><span aria-hidden>{s.icon}</span>{t(s.key)}</span>;
}

/** Shortage / surplus / tallied banner text + colour classes for a signed difference. */
export function varianceTone(variance: { isNegative(): boolean; isZero(): boolean }) {
  if (variance.isZero()) return { icon: '✓', key: 'tallied' as MessageKey, cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' };
  return variance.isNegative()
    ? { icon: '▼', key: 'shortage' as MessageKey, cls: 'border-red-300 bg-red-50 text-red-800' }
    : { icon: '▲', key: 'surplus' as MessageKey, cls: 'border-amber-300 bg-amber-50 text-amber-900' };
}

/** Open an attachment through a short-lived signed URL. */
export async function openPhoto(id: string) {
  const { url } = await api.get(`/attachments/${id}/url`);
  window.open(url, '_blank', 'noopener');
}
