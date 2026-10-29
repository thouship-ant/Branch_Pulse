import { useState } from 'react';
import { addDays, prettyDate, todayIST } from './dates';

/** A single chosen day with previous / next / today helpers (the web DateNav). */
export function useDay(initial?: string) {
  const today = todayIST();
  const [date, setDate] = useState(initial ?? today);
  return {
    date, setDate, today,
    prev: () => setDate((d) => addDays(d, -1)),
    next: () => setDate((d) => (d < today ? addDays(d, 1) : d)),
    isToday: date === today,
    label: date === today ? `Today · ${prettyDate(date)}` : prettyDate(date),
  };
}
