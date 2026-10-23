'use client';

import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The plain text of a node (an <option> may hold `{a} · {b}`, i.e. an array of strings). */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

/** Flatten <option> children, looking through fragments and arrays, into { value, label, disabled }. */
function readOptions(children: ReactNode): Array<{ value: string; label: string; disabled: boolean }> {
  const out: Array<{ value: string; label: string; disabled: boolean }> = [];
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (c) => {
      if (!isValidElement(c)) return;
      const p = c.props as { value?: string | number; disabled?: boolean; children?: ReactNode };
      if (c.type === 'option') {
        const label = textOf(p.children);
        out.push({ value: p.value == null ? label : String(p.value), label, disabled: !!p.disabled });
      } else walk(p.children);
    });
  };
  walk(children);
  return out;
}

/**
 * Drop-in replacement for <select>: same value / onChange(e.target.value) / <option> children / disabled / id / className,
 * but the list is a themed popover (rounded card, lavender highlight, check on the chosen row) instead of the browser's own menu.
 */
export function Select({ value, onChange, children, className = '', id, disabled }: {
  value: string | number; onChange: (e: ChangeEvent<HTMLSelectElement>) => void; children: ReactNode; className?: string; id?: string; disabled?: boolean;
}) {
  const options = useMemo(() => readOptions(children), [children]);
  const current = options.findIndex((o) => o.value === String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    setOpen(false);
    btn.current?.focus();
    if (o.value !== String(value)) onChange({ target: { value: o.value }, currentTarget: { value: o.value } } as unknown as ChangeEvent<HTMLSelectElement>);
  };

  useEffect(() => {
    if (!open || !btn.current) return;
    const anchor = btn.current;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const wantH = Math.min(320, options.length * 44 + 16);
      const up = below < wantH && above > below;
      const maxH = Math.max(120, Math.min(320, up ? above : below));
      const width = Math.max(r.width, 180);
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width, maxH,
        top: up ? r.top - 6 - Math.min(wantH, maxH) : r.bottom + 6,
      });
    };
    place();
    const away = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!list.current?.contains(n) && !anchor.contains(n)) setOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', away);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', away);
    };
  }, [open, options.length]);

  // keep the highlighted row in view
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, pos]);

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setActive(Math.max(0, current)); setOpen(true); }
      return;
    }
    const step = (dir: 1 | -1) => {
      let i = active;
      for (let n = 0; n < options.length; n++) {
        i = (i + dir + options.length) % options.length;
        if (!options[i].disabled) break;
      }
      setActive(i);
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const hit = options.findIndex((o, i) => i > active && !o.disabled && o.label.toLowerCase().startsWith(k));
      const wrap = hit > -1 ? hit : options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(k));
      if (wrap > -1) setActive(wrap);
    }
  };

  const label = current > -1 ? options[current].label : '';
  return (
    <>
      <button
        ref={btn} id={id} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onKeyDown={onKey}
        onClick={() => { setActive(Math.max(0, current)); setOpen((o) => !o); }}
        className={`field flex items-center justify-between gap-2 text-left ${className}`}
      >
        <span className={`truncate ${label ? '' : 'text-slate-400'}`}>{label || '—'}</span>
        <svg className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && createPortal(
        <div
          ref={list} role="listbox" onClick={(e) => e.stopPropagation()}
          className="anim-sheet fixed z-[80] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-surface p-2"
          style={{ boxShadow: 'var(--shadow-pop)', left: pos?.left ?? 0, top: pos?.top ?? 0, width: pos?.width, maxHeight: pos?.maxH, visibility: pos ? 'visible' : 'hidden' }}
        >
          {options.map((o, i) => {
            const selected = i === current;
            return (
              <div
                key={`${o.value}-${i}`} data-i={i} role="option" aria-selected={selected} aria-disabled={o.disabled}
                onMouseEnter={() => !o.disabled && setActive(i)} onClick={() => choose(i)}
                className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl px-3 text-[15px] transition-colors ${
                  o.disabled ? 'cursor-not-allowed text-slate-300' : selected ? 'bg-brand-light font-semibold text-brand' : 'text-slate-700'
                } ${i === active && !o.disabled && !selected ? 'bg-slate-100' : ''}`}
              >
                <span className="truncate">{o.label || '—'}</span>
                {selected && <svg className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
