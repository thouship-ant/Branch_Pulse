'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';
type BusinessType = 'TEA_SHOP' | 'OTHER';
interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
  businessType: BusinessType;
  setBusinessType: (type: string | null | undefined) => void;
}
const Ctx = createContext<ThemeCtx>({ theme: 'light', toggle: () => undefined, businessType: 'OTHER', setBusinessType: () => undefined });

/** Inline script (see layout.tsx) sets the class before first paint; this keeps React state in sync. */
export const THEME_SCRIPT =
  "try{if(localStorage.getItem('bp_theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [businessType, setBusinessTypeState] = useState<BusinessType>('OTHER');

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('tea-shop', businessType === 'TEA_SHOP');
  }, [businessType]);

  const setBusinessType = useCallback((type: string | null | undefined) => {
    setBusinessTypeState(type === 'TEA_SHOP' ? 'TEA_SHOP' : 'OTHER');
  }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try { localStorage.setItem('bp_theme', next); } catch { /* storage blocked */ }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle, businessType, setBusinessType }), [theme, toggle, businessType, setBusinessType]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
