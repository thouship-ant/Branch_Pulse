'use client';

import { useCallback, useEffect, useState } from 'react';
import { todayIST } from './dates';

/**
 * A date kept in the page's `?date=` query, so going to a detail page and coming back (or refreshing) lands on the same day.
 * Read once on mount (not via useSearchParams, which would force a Suspense boundary); `ready` is false until then,
 * so callers can hold their first fetch and not load today's data only to replace it.
 */
export function useDateParam(): [string, (d: string) => void, boolean] {
  const [date, setDateState] = useState(todayIST());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('date');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayIST()) setDateState(d);
    setReady(true);
  }, []);

  const setDate = useCallback((d: string) => {
    setDateState(d);
    const url = new URL(window.location.href);
    if (d === todayIST()) url.searchParams.delete('date'); else url.searchParams.set('date', d);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  return [date, setDate, ready];
}
