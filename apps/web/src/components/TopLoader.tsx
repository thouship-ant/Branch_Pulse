'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { getPending, subscribePending } from '@/lib/api';

/** A thin bar + spinner while any API request is in flight or a menu link is navigating - the one loader every page gets for free. */
export function TopLoader() {
  const pending = useSyncExternalStore(subscribePending, getPending, () => 0);
  const path = usePathname();
  const [navigating, setNavigating] = useState(false);

  // the route changed: navigation is done
  useEffect(() => { setNavigating(false); }, [path]);

  // a click on an internal link starts navigation (the page may compile/load before any API call fires)
  useEffect(() => {
    let safety: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setNavigating(true);
      clearTimeout(safety);
      safety = setTimeout(() => setNavigating(false), 15000);
    };
    // capture phase: next/link calls preventDefault() in its own handler, which runs before a bubbling document listener
    document.addEventListener('click', onClick, true);
    return () => { document.removeEventListener('click', onClick, true); clearTimeout(safety); };
  }, []);

  const busy = pending > 0 || navigating;

  if (!busy) return null;
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-transparent" role="status" aria-label="Loading">
        <div className="anim-loader h-full w-1/3 rounded-full bg-gradient-to-r from-[#18236f] via-[#1e2a8a] to-[#4a5bd8]" />
      </div>
      {/* the page mask covers navigation only; once the page is up, API calls show just the top bar */}
      {navigating && (
        <div className="anim-fade fixed inset-0 z-[99] flex items-center justify-center bg-slate-900/30" aria-hidden="true">
          <div className="rounded-full bg-white p-3 shadow-xl ring-1 ring-black/5">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1e2a8a]/25 border-t-[#1e2a8a]" />
          </div>
        </div>
      )}
    </>
  );
}
