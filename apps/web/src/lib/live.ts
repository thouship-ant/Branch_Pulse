'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshSession } from './api';

/** What the server announces: something of this kind changed. `null` means "we were offline, so assume anything changed". */
export interface LiveEvent { topic: string; action: string; locationId?: string | null }
type Listener = (e: LiveEvent | null) => void;

const listeners = new Set<Listener>();
let socket: Socket | null = null;
let seen = false;

/** Open the live connection (after sign-in). Safe to call again. The same web origin carries it, like every API call. */
export function connectLive() {
  if (socket) return;
  seen = false;
  const s = io({ path: '/api/v1/realtime', auth: (cb) => cb({ token: getAccessToken() ?? '' }), transports: ['polling', 'websocket'], reconnectionDelayMax: 15_000 });
  socket = s;
  s.on('change', (e: LiveEvent) => listeners.forEach((l) => l(e)));
  // back online after a gap: whatever changed meanwhile was missed, so every screen asks again
  s.on('connect', () => { if (seen) listeners.forEach((l) => l(null)); seen = true; });
  // refused (the access token ran out): get a new one, then try again. socket.io does not retry a refusal by itself
  s.on('connect_error', (err) => {
    if (err.message !== 'unauthorized') return;
    void refreshSession().then((ok) => { if (ok && socket === s) setTimeout(() => s.connect(), 1500); });
  });
}
export function disconnectLive() { socket?.disconnect(); socket = null; }

/**
 * Run `load` again whenever another person (or another device) changes something this screen shows. `topics` narrows it to the
 * kinds of change that matter (e.g. ['EXPENSE', 'DAILY_CLOSING']); leave it out to refresh on any change.
 */
export function useLive(load: () => unknown, topics?: string[]) {
  const fn = useRef(load);
  fn.current = load;
  const want = useRef(topics);
  want.current = topics;
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const l: Listener = (e) => {
      if (e && want.current && !want.current.includes(e.topic)) return;
      clearTimeout(t);
      t = setTimeout(() => void fn.current(), 250); // a burst of changes is one refresh
    };
    listeners.add(l);
    return () => { listeners.delete(l); clearTimeout(t); };
  }, []);
}
