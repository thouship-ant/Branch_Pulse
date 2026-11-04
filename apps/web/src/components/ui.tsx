'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { cleanAmount } from '@/lib/money';
import { useT, type MessageKey } from '@/lib/i18n';
import { useOutbox } from '@/lib/outbox';
import type { Warning } from '@/lib/api';
import { Icon } from './Icon';

// ------------------------------------------------------------------ status: colour + icon + word, never colour alone
const STATUS: Record<string, { icon: string; cls: string; key: MessageKey }> = {
  PENDING: { icon: '○', cls: 'border-slate-300 bg-slate-100 text-slate-700', key: 'pending' },
  SUBMITTED: { icon: '◔', cls: 'border-amber-300 bg-amber-50 text-amber-800', key: 'submitted' },
  APPROVED: { icon: '✓', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800', key: 'approved' },
  REJECTED: { icon: '✕', cls: 'border-red-300 bg-red-50 text-red-800', key: 'rejected' },
  REOPENED: { icon: '↺', cls: 'border-violet-300 bg-violet-50 text-violet-800', key: 'reopened' },
};

export function StatusPill({ status }: { status: string }) {
  const { t } = useT();
  const s = STATUS[status] ?? STATUS.PENDING;
  return (
    <span className={`chip ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {t(s.key)}
    </span>
  );
}

/** Active / inactive: icon + word, never colour alone. */
export function ActiveChip({ active }: { active: boolean }) {
  const { t } = useT();
  return (
    <span className={`chip ${active ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-100 text-slate-600'}`}>
      <Icon name={active ? 'checkCircle' : 'banCircle'} size={15} />{active ? t('active') : t('inactive')}
    </span>
  );
}

// ------------------------------------------------------------------ inputs
export function MoneyInput({
  value, onChange, label, id, required, hint, disabled, onBlur, error,
}: {
  value: string; onChange: (v: string) => void; label: string; id: string; required?: boolean; hint?: string; disabled?: boolean;
  /** fired when the user leaves the field (auto-save) */ onBlur?: () => void;
  /** inline message shown under the field */ error?: string;
}) {
  return (
    <div>
      <LabelRow htmlFor={id} hint={hint}>
        {label}{required && <span className="text-red-600"> *</span>}
      </LabelRow>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">₹</span>
        <input
          id={id}
          className={`field pl-8 text-lg tabular-nums ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onBlur={onBlur}
          onKeyDown={onBlur ? (e) => { if (e.key === 'Enter') e.currentTarget.blur(); } : undefined}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(cleanAmount(e.target.value))}
        />
      </div>
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** A small round "?" next to a field name: click it to read the hint (instead of a line of grey text under the box). */
export function HintTip({ text }: { text: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // a hint in the left column opens to the right of its "?", one in the right column opens to the left, so it never runs off the dialog / screen
  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const box = ref.current.closest('[role="dialog"]')?.getBoundingClientRect();
      const edge = Math.min(box ? box.right : Infinity, document.documentElement.clientWidth) - 12;
      setAlignRight(r.left + 270 > edge);
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button" aria-label="Help" aria-expanded={open} onClick={toggle}
        className={`grid h-5 w-5 place-items-center rounded-full text-xs font-bold leading-none transition ${open ? 'bg-brand text-white' : 'bg-slate-200 text-slate-600 hover:bg-brand hover:text-white'}`}
      >?</button>
      {open && (
        <span role="note" className={`anim-fade absolute top-full z-30 mt-2 w-max max-w-[min(260px,70vw)] rounded-xl ${alignRight ? 'right-0' : 'left-0'} border border-slate-200 bg-surface p-3 text-left text-xs font-normal leading-relaxed text-slate-700 shadow-lg`}>
          <span aria-hidden className={`absolute -top-1.5 h-3 w-3 rotate-45 border-l border-t border-slate-200 bg-surface ${alignRight ? 'right-2' : 'left-2'}`} />
          {text}
        </span>
      )}
    </span>
  );
}
/** Field name with its "?" hint beside it. */
export function LabelRow({ htmlFor, hint, children }: { htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  if (!hint) return <label htmlFor={htmlFor} className="label">{children}</label>;
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <label htmlFor={htmlFor} className="label !mb-0">{children}</label>
      <HintTip text={hint} />
    </div>
  );
}

export function TextField({ label, id, className = '', hint, ...rest }: { label: string; id: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <LabelRow htmlFor={id} hint={hint}>{label}</LabelRow>
      {/* read-only values look different from editable ones (and are announced as read-only) */}
      <input
        id={id} aria-readonly={rest.readOnly || undefined}
        className={`field ${rest.readOnly ? 'cursor-default bg-slate-100 text-slate-600 focus:border-slate-300 focus:ring-0' : ''} ${className}`}
        {...rest}
      />
    </div>
  );
}

/** Multi-line text that grows with its content (so every line is visible) and can still be resized by hand. */
export function AutoTextarea({
  label, id, value, onChange, minRows = 2, ...rest
}: { label: string; id: string; value: string; onChange: (v: string) => void; minRows?: number } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`; // +2: the border
  }, [value]);
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <textarea
        ref={ref} id={id} rows={minRows} value={value} onChange={(e) => onChange(e.target.value)}
        className="field resize-y overflow-hidden py-2 leading-6" {...rest}
      />
    </div>
  );
}

export function Chips<T extends string>({
  options, value, onChange, label,
}: { options: Array<{ value: T; label: string }>; value: T | ''; onChange: (v: T) => void; label?: string }) {
  return (
    <div>
      {label && <span className="label">{label}</span>}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value} type="button" role="radio" aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className="pill active:scale-[0.97]"
          >
            {value === o.value && <span aria-hidden>✓ </span>}{o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ feedback
export function Skeleton({ className = 'h-20' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function Warnings({ items }: { items?: Warning[] }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-1" role="status">
      {items.map((w, i) => (
        <li key={i} className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span aria-hidden>⚠ </span>{w.message}
        </li>
      ))}
    </ul>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="whitespace-pre-line rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      <span aria-hidden>✕ </span>{error}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on desktop. */
/** Draws its children on <body>, above the header and every page layer (a dialog inside the page would be trapped under them). */
export function Overlay({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? createPortal(children, document.body) : null;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  // parents pass a new onClose on every render: keep the latest in a ref so typing in a field never re-runs the effect
  // (which would move focus back to the dialog after every keystroke)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 flex h-[100dvh] items-end justify-center bg-slate-900/45 pb-4 backdrop-blur-sm sm:items-center sm:pb-0" onClick={onClose}>
      <div
        ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className="anim-sheet max-h-[85dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-[24px] border border-slate-200/70 bg-surface p-5 pt-3 outline-none sm:rounded-2xl sm:pt-5"
        style={{ boxShadow: 'var(--shadow-pop)', WebkitOverflowScrolling: 'touch' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <button
            type="button" onClick={onClose} aria-label={t('close')}
            className="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ sync banner ("3 entries waiting to sync")
export function SyncBanner({ locationId, businessDate }: { locationId?: string; businessDate?: string }) {
  const { t } = useT();
  const { waiting, online } = useOutbox(locationId, businessDate);
  if (online && waiting === 0) return null;
  return (
    <div role="status" className={`px-4 py-2 text-sm ${online ? 'bg-amber-50 text-amber-900' : 'bg-[#1e293b] text-white'}`}>
      {!online && <span>⚡ {t('offline')}</span>}
      {waiting > 0 && <span>{online ? '' : ' · '}⟳ {waiting} {t('waiting')}</span>}
    </div>
  );
}
