'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { Overlay } from './ui';
import { useT } from '@/lib/i18n';

export interface PaletteItem { href: string; label: string; icon: IconName; hint?: string }

/** Ctrl K: jump to any page or action by typing a few letters. */
export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const { t } = useT();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => !s || `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(s)).slice(0, 12);
  }, [items, q]);

  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => setActive(0), [q]);

  const go = (i: PaletteItem | undefined) => { if (!i) return; onClose(); router.push(i.href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(shown[active]); }
    else if (e.key === 'Escape') onClose();
  };

  if (!open) return null;
  return (
    <Overlay>
      <div className="anim-fade fixed inset-0 z-[90] flex items-start justify-center bg-slate-900/45 px-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
        <div role="dialog" aria-modal="true" aria-label={t('searchPlaceholder')} className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-surface" style={{ boxShadow: 'var(--shadow-pop)' }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3 border-b border-slate-200 px-4">
            <Icon name="eye" size={18} className="text-slate-500" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t('searchPlaceholder')} className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-slate-500" aria-label={t('searchPlaceholder')} />
            <kbd className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600">Esc</kbd>
          </div>
          <ul role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-600">{t('noResults')}</li>}
            {shown.map((i, n) => (
              <li key={i.href + i.label} role="option" aria-selected={n === active}>
                <button type="button" onMouseEnter={() => setActive(n)} onClick={() => go(i)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] ${n === active ? 'bg-brand-light text-brand' : 'text-ink'}`}>
                  <Icon name={i.icon} size={18} /><span className="flex-1 font-medium">{i.label}</span>{i.hint && <span className="text-xs text-slate-600">{i.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Overlay>
  );
}
