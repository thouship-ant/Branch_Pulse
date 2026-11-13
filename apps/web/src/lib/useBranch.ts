'use client';

import { useMemo } from 'react';
import { todayIST } from './dates';
import { useEntry } from './entry';
import { useSession } from './session';

/** A branch user works on exactly one branch, for today's IST trading date (or the missed day being entered, while that sheet is open). */
export function useBranch() {
  const { me } = useSession();
  const today = useMemo(() => todayIST(), []);
  const entry = useEntry();
  const entering = !!entry.date && entry.date <= today; // the step-by-step sheet is open (for today, or a missed day)
  const date = entering ? entry.date! : today;
  const branch = me?.locations[0] ?? null;
  return { branch, today, date, entering, locationId: branch?.id ?? '' };
}
