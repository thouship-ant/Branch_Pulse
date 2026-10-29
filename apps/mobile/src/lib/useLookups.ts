import { useEffect, useState } from 'react';
import { api } from './api';

export interface Option { id: string; code?: string; name: string; type?: string }

/** Branches the user may see (for filters and pickers). */
export function useBranches() {
  const [rows, setRows] = useState<Option[]>([]);
  useEffect(() => { api.get('/locations?type=BRANCH').then((b) => setRows(b as Option[])).catch(() => undefined); }, []);
  return rows;
}

/** Expense categories (top-level and sub-categories together). */
export function useCategories(includeInactive = false) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.get(`/expense-categories${includeInactive ? '?includeInactive=true' : ''}`).then((c) => setRows(c as any[])).catch(() => undefined); }, [includeInactive]);
  return rows;
}
