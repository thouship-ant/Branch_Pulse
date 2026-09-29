'use client';

import { useSyncExternalStore } from 'react';
import { getPending, subscribePending } from '@/lib/api';

/** A thin bar at the top of the screen while any API request is in flight - the one loader every page gets for free. */
export function TopLoader() {
  const pending = useSyncExternalStore(subscribePending, getPending, () => 0);
  if (!pending) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-transparent" role="status" aria-label="Loading">
      <div className="anim-loader h-full w-1/3 rounded-full bg-gradient-to-r from-[#2456e0] via-[#5046e5] to-[#dd5586]" />
    </div>
  );
}
