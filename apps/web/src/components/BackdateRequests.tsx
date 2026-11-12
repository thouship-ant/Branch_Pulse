'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorBox, Sheet } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { prettyDate } from '@/lib/dates';
import { useT } from '@/lib/i18n';

interface Day { date: string; request: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string; decisionNote?: string | null } | null }

/**
 * Days that were not closed by the cut-off (23:30) are locked. This card lists them for the branch and lets the Branch Admin / Admin
 * ask for one to be opened; an Admin approves (Approvals > Date requests) and the day can then be entered as usual.
 */
export function BackdateRequests({ locationId }: { locationId: string }) {
  const { t } = useT();
  const [days, setDays] = useState<Day[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) return;
    try { setDays(await api.get<Day[]>(`/backdate-requests/eligible?locationId=${locationId}`)); } catch { setDays([]); }
  }, [locationId]);
  useEffect(() => { void load(); }, [load]);

  async function send() {
    if (!asking) return;
    setBusy(true); setError(null);
    try { await api.post('/backdate-requests', { locationId, businessDate: asking, reason: reason.trim() }); setAsking(null); setReason(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not send'); }
    finally { setBusy(false); }
  }

  if (!days || days.length === 0) return null;
  return (
    <section className="card space-y-3 border-amber-300 bg-amber-50/60" aria-label={t('bdTitle')}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><Icon name="clock" size={20} /></span>
        <div>
          <h3 className="font-bold text-amber-900">{t('bdTitle')}</h3>
          <p className="text-sm text-amber-900/80">{t('bdLead')}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {days.map((d) => (
          <li key={d.date} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm">
            <span className="font-semibold">{prettyDate(d.date)}</span>
            {!d.request || d.request.status === 'REJECTED' ? (
              <span className="flex items-center gap-2">
                {d.request?.status === 'REJECTED' && <span className="text-xs text-red-700">{t('bdRejected')}{d.request.decisionNote ? `: ${d.request.decisionNote}` : ''}</span>}
                <button className="btn-secondary min-h-[38px] px-3 text-sm" onClick={() => { setError(null); setReason(''); setAsking(d.date); }}>{t('bdRequest')}</button>
              </span>
            ) : d.request.status === 'PENDING' ? (
              <span className="chip border-amber-300 bg-amber-100 text-amber-900"><span aria-hidden>◔</span>{t('bdWaiting')}</span>
            ) : (
              <span className="chip border-emerald-300 bg-emerald-50 text-emerald-800"><span aria-hidden>✓</span>{t('bdApproved')}</span>
            )}
          </li>
        ))}
      </ul>
      <Sheet open={!!asking} onClose={() => setAsking(null)} title={`${t('bdRequest')} · ${asking ? prettyDate(asking) : ''}`}>
        <div className="space-y-3">
          <label htmlFor="bdr" className="label">{t('reason')} *</label>
          <textarea id="bdr" className="field min-h-[96px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('bdReasonHint')} />
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setAsking(null)}>{t('cancel')}</button>
            <button className="btn-primary" disabled={busy || reason.trim().length < 3} onClick={send}>{busy ? t('loading') : t('bdSend')}</button>
          </div>
        </div>
      </Sheet>
    </section>
  );
}
