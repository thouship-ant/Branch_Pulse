'use client';

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/** Six separate digit boxes: typing moves on, backspace moves back, arrows move, and a pasted code spreads across the boxes. */
export function OtpInput({ value, onChange, length = 6, autoFocus }: { value: string; onChange: (v: string) => void; length?: number; autoFocus?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();
  useEffect(() => { if (autoFocus) focus(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    if (!clean) return;
    if (clean.length > 1) { // auto-fill from SMS
      const next = (value.slice(0, i) + clean).slice(0, length);
      onChange(next); focus(next.length >= length ? length - 1 : next.length);
      return;
    }
    const arr = [...digits]; arr[i] = clean;
    onChange(arr.join('')); focus(i + 1);
  };
  const keyDown = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const arr = [...digits];
      if (arr[i]) { arr[i] = ''; onChange(arr.join('')); } else if (i > 0) { arr[i - 1] = ''; onChange(arr.join('')); focus(i - 1); }
    } else if (e.key === 'ArrowLeft') focus(i - 1);
    else if (e.key === 'ArrowRight') focus(i + 1);
  };
  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    const clean = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!clean) return;
    e.preventDefault(); onChange(clean); focus(Math.min(clean.length, length - 1));
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="One-time password">
      {digits.map((d, i) => (
        <input
          key={i} ref={(el) => { refs.current[i] = el; }}
          value={d} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={i === 0 ? length : 1}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => set(i, e.target.value)} onKeyDown={(e) => keyDown(e, i)} onPaste={paste} onFocus={(e) => e.target.select()}
          className={`h-14 min-w-0 flex-1 rounded-xl border-[1.5px] bg-white text-center text-2xl font-bold tabular-nums text-slate-900 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25 ${d ? 'border-slate-400' : 'border-slate-200'}`}
        />
      ))}
    </div>
  );
}
