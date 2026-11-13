'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { useBranch } from './useBranch';

/** The missed days the Admin has approved for this branch (the only past days that can be entered). Empty until loaded. */
export function useApprovedDays(): string[] {
  const { locationId } = useBranch();
  const [days, setDays] = useState<string[]>([]);
  useEffect(() => {
    if (!locationId) return;
    api.get<Array<{ date: string; request: { status: string } | null }>>(`/backdate-requests/eligible?locationId=${locationId}`)
      .then((r) => setDays(r.filter((d) => d.request?.status === 'APPROVED').map((d) => d.date)))
      .catch(() => setDays([]));
  }, [locationId]);
  return days;
}
