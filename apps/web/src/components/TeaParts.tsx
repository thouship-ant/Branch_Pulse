'use client';

import type { ReactNode } from 'react';
import { MdiIcon } from '@/components/Icon';
import { useTheme } from '@/lib/theme';

/** True for a tea-shop company: these pages get the warm, tile-based look of the mobile app. */
export function useIsTea() {
  return useTheme().businessType === 'TEA_SHOP';
}

/**
 * Page heading. Tea shop: a brown icon tile, a large title and a one-line description (the same block on every page).
 * Other businesses keep the plain heading. `action` sits on the right.
 */
export function PageTitle({ mdi, title, subtitle, action }: { mdi: string; title: string; subtitle?: string; action?: ReactNode }) {
  const tea = useIsTea();
  if (!tea) {
    return (
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        {action}
      </div>
    );
  }
  // tea shop: the same block as the Home greeting ("Good morning, Admin"): big bold title, a quiet line under it, cream that fades out
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="page-hero min-w-0 flex-1">
        <h2 className="text-[clamp(24px,3vw,34px)] font-extrabold leading-tight tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-1.5 text-[15px]" style={{ color: '#684f3e' }}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export type Tone = 'brand' | 'ok' | 'warn' | 'bad' | 'sky' | 'violet' | 'neutral';
export const TEA_TONE: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: '#fdecc4', fg: '#a4501f' }, ok: { bg: '#d6f0d9', fg: '#2e9c5b' }, warn: { bg: '#fdecc4', fg: '#d88a08' }, bad: { bg: '#fbd9d6', fg: '#d9443d' },
  sky: { bg: '#dce6fb', fg: '#1d4fb8' }, violet: { bg: '#ebd9f7', fg: '#6b2a98' }, neutral: { bg: '#f3e6d6', fg: '#6a351c' },
};

/**
 * A summary tile. Tea shop: a tinted tile with a solid round icon, the label beside it and the number below with the whole
 * tile width (never cut with "…"). Other businesses: the plain card.
 */
export function StatTile({ mdi, tone = 'brand', value, label, sub, alert, className = '' }: { mdi: string; tone?: Tone; value: string; label: string; sub?: string; alert?: boolean; className?: string }) {
  const tea = useIsTea();
  const { theme } = useTheme();
  if (!tea) {
    return (
      <div className={`card ${alert ? 'border-red-300' : ''} ${className}`}>
        <p className="text-sm text-slate-600">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
      </div>
    );
  }
  const c = TEA_TONE[tone];
  const dark = theme === 'dark';
  return (
    <div
      className={`flex min-h-[96px] flex-col justify-between gap-2 rounded-[18px] border p-3.5 ${className}`}
      style={{ background: dark ? 'rgb(var(--slate-100))' : c.bg, borderColor: dark ? 'rgb(var(--slate-200))' : 'rgb(255 255 255 / 0.8)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ background: c.fg }} aria-hidden>
          <MdiIcon path={mdi} size={18} />
        </span>
        <span className="text-sm font-semibold leading-tight" style={{ color: dark ? undefined : '#2d211b' }}>{label}</span>
      </div>
      <div>
        <p className={`whitespace-nowrap text-2xl font-extrabold tabular-nums ${alert ? 'text-red-700' : ''}`} style={{ color: alert || dark ? undefined : '#2d211b' }}>{value}</p>
        {sub ? <p className="text-xs" style={{ color: dark ? undefined : '#6b5444' }}>{sub}</p> : null}
      </div>
    </div>
  );
}

/** The red count badge on a tab's top-right corner (the tab must be `relative`). */
export function TabBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="pointer-events-none absolute -right-1 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#dc2626] px-1 text-[10px] font-extrabold leading-none text-white" aria-label={`${n}`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}
