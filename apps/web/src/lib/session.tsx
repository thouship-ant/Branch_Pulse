'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, refreshSession, setAccessToken, setAuthLostHandler } from './api';
import { clearLocalData } from './outbox';

export interface Me {
  id: string;
  username: string;
  fullName: string;
  language: string;
  roles: string[];
  permissions: string[];
  allLocations: boolean;
  locations: Array<{ id: string; code: string; name: string; nameTa?: string | null; type: string; cardEnabled: boolean; defaultOpeningCash: string }>;
}

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  can: (perm: string) => boolean;
  /** Branch users work on one branch from their phone; everyone else uses the back-office layout. */
  isBranchUser: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>(null as unknown as SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthLostHandler(() => setMe(null));
    (async () => {
      // access tokens live in memory only; a reload restores the session from the HttpOnly cookie
      const r: any = await refreshSession();
      if (r && r.user) setMe(r.user);
      setLoading(false);
    })();
    return () => setAuthLostHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    const res = await api.post('/auth/login', { username, password, client: isMobile ? 'mobile' : 'desktop', deviceLabel: navigator.userAgent.slice(0, 60) });
    setAccessToken(res.accessToken);
    setMe(res.user);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch (e) { if (!(e instanceof ApiError)) throw e; }
    setAccessToken(null);
    await clearLocalData();
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-api-cache' });
    setMe(null);
  }, []);

  const value = useMemo<SessionCtx>(() => {
    const perms = new Set(me?.permissions ?? []);
    return {
      me,
      loading,
      can: (p) => perms.has(p),
      isBranchUser: perms.has('closing:submit') && !perms.has('closing:approve'),
      login,
      logout,
    };
  }, [me, loading, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
