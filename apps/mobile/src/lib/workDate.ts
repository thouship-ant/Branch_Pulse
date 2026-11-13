import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { todayIST } from './dates';

/**
 * The day the entry screens (sales, expenses, purchases, closing) work on. Normally today; while a missed day that the Admin
 * approved is being entered it is that day. The step the person reached is kept on the phone, so a day that was left (or the
 * app closed) is opened again where it stopped.
 */
interface State { date: string | null; step: number; open: boolean }
const KEY = 'bp.backdateEntry';
let state: State = { date: null, step: 0, open: false };
const listeners = new Set<() => void>();
const set = (s: State) => { state = s; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const get = () => state;
const persist = (s: { date: string; step: number; open: boolean } | null) => {
  void (s ? SecureStore.setItemAsync(KEY, JSON.stringify(s)) : SecureStore.deleteItemAsync(KEY)).catch(() => undefined);
};

/** The date entries are made for: the day being caught up, else today. */
export function useWorkDate(): string {
  const s = useSyncExternalStore(subscribe, get, get);
  return s.date ?? todayIST();
}
/** The catch-up state: `date` is set while a missed day is open for entry. */
export function useEntryDay() { return useSyncExternalStore(subscribe, get, get); }

/** What was left unfinished last time (null when nothing). */
export async function savedEntry(): Promise<{ date: string; step: number; open: boolean } | null> {
  try { const v = await SecureStore.getItemAsync(KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}

/** Open a missed day for entry, at the step where it was left (`step` overrides). */
export async function startEntry(date: string, step?: number) {
  const saved = await savedEntry();
  const at = step ?? (saved?.date === date ? saved.step : 0);
  set({ date, step: at, open: true });
  persist({ date, step: at, open: true });
}
export function setEntryStep(step: number) {
  if (!state.date) return;
  set({ ...state, step });
  persist({ date: state.date, step, open: true });
}
/** Leave the day. `done` forgets the progress (the day was submitted); otherwise it is remembered for next time. */
export function leaveEntry(done = false) {
  const was = state;
  set({ date: null, step: 0, open: false });
  persist(done || !was.date ? null : { date: was.date, step: was.step, open: false });
}
