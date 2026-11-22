'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/lib/session';

const KEY = 'bp_last_logo';

/**
 * The loader: the business logo with a ring turning around it. Before anyone is signed in (or while the session is still being
 * restored) it shows the logo of the last business used on this device, then the Branch Pulse logo.
 */
export function Loader({ size = 84 }: { size?: number }) {
  const { me } = useSession();
  const [remembered, setRemembered] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { try { setRemembered(localStorage.getItem(KEY) ?? ''); } catch { /* storage blocked */ } }, []);
  const logo = (me?.company?.businessLogo || remembered) && !failed ? (me?.company?.businessLogo || remembered) : '/logo.png';
  const inner = size - 20;
  return (
    <div role="status" aria-label="Loading" className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full border-4 border-brand/15" aria-hidden />
      <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-r-brand border-t-brand" aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" width={inner} height={inner} onError={() => setFailed(true)} className="rounded-full bg-white object-contain" style={{ width: inner, height: inner }} />
    </div>
  );
}

/** The loader in the middle of the screen, over a soft backdrop (page and sign-in waits). */
export function ScreenLoader() {
  return (
    <div className="anim-fade fixed inset-0 z-[99] flex items-center justify-center bg-surface/70 backdrop-blur-[2px]">
      <div className="rounded-full bg-surface p-3 shadow-xl ring-1 ring-black/5"><Loader /></div>
    </div>
  );
}
