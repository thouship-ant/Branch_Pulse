import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useSession } from './session';
import { useLive } from './live';

/** Counts for the tab-bar badges: things waiting for approval, and branches with unclosed days. */
export function useAttention() {
  const { can } = useSession();
  const [a, setA] = useState({ waiting: 0, unclosedBranches: 0 });
  const load = useCallback(async () => {
    let waiting = 0;
    let unclosedBranches = 0;
    const jobs: Array<Promise<void>> = [];
    if (can('expense:approve')) jobs.push(api.get<any[]>('/expenses?status=SUBMITTED&pageSize=100').then((r) => { waiting += r.length; }).catch(() => undefined));
    if (can('closing:approve')) jobs.push(api.get<any[]>('/closings/awaiting').then((r) => { waiting += r.length; }).catch(() => undefined));
    if (can('closing:reopen')) jobs.push(api.get<any[]>('/backdate-requests?status=PENDING').then((r) => { waiting += r.length; }).catch(() => undefined));
    if (can('alert:view')) jobs.push(api.get<any[]>('/pending-closings').then((r) => { unclosedBranches = new Set(r.map((x) => x.locationId)).size; }).catch(() => undefined));
    await Promise.all(jobs);
    setA({ waiting, unclosedBranches });
  }, [can]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useLive(load);
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  return a;
}
