'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { connectLive, disconnectLive, useLive } from './live';
import { api, ApiError, refreshSession, setAccessToken, setAuthLostHandler } from './api';
import { clearLocalData } from './outbox';
import { useTheme } from './theme';
import { fontCss, sizePx } from './typography';

export type SignInMethod = 'PASSWORD' | 'PASSWORD_OTP' | 'OTP';

export interface Me {
  id: string;
  username: string;
  fullName: string;
  mobile?: string | null;
  language: string;
  roles: string[];
  /** the names the company gave the user's roles (an Admin can rename any role except Admin) */
  roleNames?: string[];
  permissions: string[];
  allLocations: boolean;
  /** Super Admin: manages companies, has no company of its own */
  isSuper?: boolean;
  /** still on the default / temporary password: the app asks for a new one */
  mustChangePassword?: boolean;
  company?: { id: string; code: string; name: string; businessType?: string; businessName?: string; businessLogo?: string; businessFrame?: string | null; businessFont?: string; businessFontSize?: string } | null;
  locations: Array<{ id: string; code: string; name: string; nameTa?: string | null; type: string; cardEnabled: boolean; defaultOpeningCash: string }>;
}

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  can: (perm: string) => boolean;
  /** Branch users work on one branch from their phone; everyone else uses the back-office layout. */
  isBranchUser: boolean;
  /** Which steps to show for this mobile number / username: PASSWORD (Super Admin), PASSWORD_OTP (Admin) or OTP (everyone else). */
  identify: (identifier: string) => Promise<SignInMethod>;
  /** Super Admin signs in; an Admin gets an OTP sent and 'OTP_SENT' comes back. */
  loginWithPassword: (username: string, password: string) => Promise<'SIGNED_IN' | 'OTP_SENT'>;
  /** OTP-only users ask for their code. */
  requestOtp: (mobile: string) => Promise<void>;
  verifyOtp: (mobile: string, otp: string) => Promise<void>;
  logout: () => Promise<void>;
  /** call after the password was changed so the prompt goes away */
  passwordChanged: () => void;
}

const Ctx = createContext<SessionCtx>(null as unknown as SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setBusinessType } = useTheme();
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

  const clientInfo = () => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    return { client: isMobile ? 'mobile' : 'desktop', deviceLabel: navigator.userAgent.slice(0, 60) };
  };
  // live updates run while someone is signed in
  useEffect(() => { if (me) connectLive(); else disconnectLive(); }, [!!me]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBusinessType(me?.company?.businessType); }, [me?.company?.businessType, setBusinessType]);
  // the company's name, logo or business type was changed (by the Super Admin or the Admin): everyone signed in picks it up now
  useLive(() => { if (me) void api.get<Me>('/me').then(setMe).catch(() => undefined); }, ['COMPANY', 'SETTING']);
  // the loader shows this business's logo on the next cold start, before the session is restored
  useEffect(() => { const logo = me?.company?.businessLogo; if (logo) { try { localStorage.setItem('bp_last_logo', logo); } catch { /* storage blocked */ } } }, [me?.company?.businessLogo]);
  // the company's typeface and text size (everything is rem-based, so the root size scales the whole interface)
  useEffect(() => {
    const root = document.documentElement;
    const font = me?.company?.businessFont;
    const size = me?.company?.businessFontSize;
    if (font && font !== 'INTER') root.style.setProperty('--app-font', fontCss(font)); else root.style.removeProperty('--app-font');
    if (size && size !== 'MEDIUM') root.style.fontSize = `${sizePx(size)}px`; else root.style.removeProperty('font-size');
  }, [me?.company?.businessFont, me?.company?.businessFontSize]);
  // the company's application frame (background picture), when it has one
  useEffect(() => {
    const root = document.documentElement;
    const url = me?.company?.businessFrame;
    if (url) root.style.setProperty('--app-frame', `url("${url}")`); else root.style.removeProperty('--app-frame');
    root.classList.toggle('has-frame', !!url);
  }, [me?.company?.businessFrame]);
  // browser tab: the signed-in business's name and logo (Branch Pulse when there is none)
  useEffect(() => {
    const name = me?.company?.businessName;
    const logo = me?.company?.businessLogo;
    document.title = name || 'Branch Pulse';
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    if (!links.length) return;
    links.forEach((l) => { l.dataset.orig ??= l.href; l.href = logo || l.dataset.orig; });
  }, [me?.company?.businessName, me?.company?.businessLogo]);

  const start = (res: any) => { setAccessToken(res.accessToken); setMe(res.user); };

  const identify = useCallback(async (identifier: string) => (await api.post('/auth/identify', { identifier })).method as SignInMethod, []);

  const loginWithPassword = useCallback(async (username: string, password: string) => {
    const res = await api.post('/auth/login', { username, password, ...clientInfo() });
    if (res.otpRequired) return 'OTP_SENT' as const;
    start(res);
    return 'SIGNED_IN' as const;
  }, []);

  const requestOtp = useCallback(async (mobile: string) => { await api.post('/auth/otp/request', { mobile }); }, []);

  const verifyOtp = useCallback(async (mobile: string, otp: string) => {
    start(await api.post('/auth/otp/verify', { mobile, otp, ...clientInfo() }));
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch (e) { if (!(e instanceof ApiError)) throw e; }
    setAccessToken(null);
    try { Object.keys(sessionStorage).filter((k) => k.startsWith('bp_pw_later_')).forEach((k) => sessionStorage.removeItem(k)); } catch { /* private mode */ }
    await clearLocalData();
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-api-cache' });
    setMe(null);
  }, []);

  const passwordChanged = useCallback(() => setMe((m) => (m ? { ...m, mustChangePassword: false } : m)), []);

  const value = useMemo<SessionCtx>(() => {
    const perms = new Set(me?.permissions ?? []);
    return {
      me,
      loading,
      can: (p) => perms.has(p),
      isBranchUser: perms.has('closing:submit') && !perms.has('closing:approve'),
      identify,
      loginWithPassword,
      requestOtp,
      verifyOtp,
      logout,
      passwordChanged,
    };
  }, [me, loading, identify, loginWithPassword, requestOtp, verifyOtp, logout, passwordChanged]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
