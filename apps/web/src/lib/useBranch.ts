'use client';

import { useMemo } from 'react';
import { todayIST } from './dates';
import { useSession } from './session';

/** A branch user works on exactly one branch, for today's IST trading date. */
export function useBranch() {
  const { me } = useSession();
  const date = useMemo(() => todayIST(), []);
  const branch = me?.locations[0] ?? null;
  return { branch, date, locationId: branch?.id ?? '' };
}
