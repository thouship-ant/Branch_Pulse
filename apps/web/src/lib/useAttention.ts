'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useSession } from './session';

export interface Attention {
  /** expenses waiting for the Admin's decision, and the oldest one's date */
  expenses: number; expenseAmount: number; oldestExpense: string | null;
  /** closings submitted and waiting for approval, and the oldest day */
  closings: number; oldestClosing: string | null;
  /** requests to enter a missed day */
  requests: number;
  /** branches with at least one day not yet closed, and how many such branch-days */
  unclosedBranches: number; unclosedDays: number; oldestUnclosed: string | null;
  /** everything the Admin has to decide: expenses + closings + requests */
  waiting: number;
}

const EMPTY: Attention = { expenses: 0, expenseAmount: 0, oldestExpense: null, closings: 0, oldestClosing: null, requests: 0, unclosedBranches: 0, unclosedDays: 0, oldestUnclosed: null, waiting: 0 };

/** What needs the signed-in person's attention, refreshed every minute and whenever a page says it changed it (window event "bp:attention"). */
export function useAttention(): Attention {
  const { can } = useSession();
  const [a, setA] = useState<Attention>(EMPTY);

  const load = useCallback(async () => {
    const next = { ...EMPTY };
    const jobs: Array<Promise<void>> = [];
    if (can('expense:approve')) {
      jobs.push(api.get<any[]>('/expenses?status=SUBMITTED&pageSize=100').then((rows) => {
        next.expenses = rows.length;
        next.expenseAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
        next.oldestExpense = rows.map((r) => String(r.createdAt)).sort()[0] ?? null;
      }).catch(() => undefined));
    }
    if (can('closing:approve')) {
      jobs.push(api.get<any[]>('/closings/awaiting').then((rows) => {
        next.closings = rows.length;
        next.oldestClosing = rows.map((r) => String(r.submittedAt ?? r.businessDate)).sort()[0] ?? null;
      }).catch(() => undefined));
    }
    if (can('closing:reopen')) jobs.push(api.get<any[]>('/backdate-requests?status=PENDING').then((rows) => { next.requests = rows.length; }).catch(() => undefined));
    if (can('alert:view')) {
      jobs.push(api.get<any[]>('/pending-closings').then((rows) => {
        next.unclosedDays = rows.length;
        next.unclosedBranches = new Set(rows.map((r) => r.locationId)).size;
        next.oldestUnclosed = rows.map((r) => String(r.businessDate).slice(0, 10)).sort()[0] ?? null;
      }).catch(() => undefined));
    }
    await Promise.all(jobs);
    next.waiting = next.expenses + next.closings + next.requests;
    setA(next);
  }, [can]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 60_000);
    const on = () => void load();
    window.addEventListener('bp:attention', on);
    return () => { clearInterval(timer); window.removeEventListener('bp:attention', on); };
  }, [load]);

  return a;
}
