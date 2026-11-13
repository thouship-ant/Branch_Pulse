import { useSyncExternalStore } from 'react';

/**
 * Catching up a missed day that the Admin approved: which day, and the step reached (sales, expenses, purchases, closing).
 * Kept in the browser, so a day that was left (or the tab closed) is opened again where it stopped.
 */
export interface Entry { date: string | null; step: number }
const KEY = 'bp.backdateEntry';
const NONE: Entry = { date: null, step: 0 };
let state: Entry = NONE;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try { const v = localStorage.getItem(KEY); if (v) state = JSON.parse(v); } catch { /* storage unavailable */ }
}
const set = (s: Entry) => {
  state = s;
  try { if (s.date) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => { load(); listeners.add(l); return () => { listeners.delete(l); }; };
const get = () => { load(); return state; };

export const useEntry = () => useSyncExternalStore(subscribe, get, () => NONE);
export const startEntry = (date: string, step = 0) => set({ date, step });
export const setEntryStep = (step: number) => { if (state.date) set({ ...state, step }); };
export const leaveEntry = () => set(NONE);
/** The step the day was left at (for the "Continue" label). */
export const resumeStep = (date: string) => { load(); return state.date === date ? state.step : null; };
