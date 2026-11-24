import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { unregisterPush } from './push';
import { connectLive, disconnectLive, useLive } from './live';
import { api, ApiError, clientInfo, endSession, loadStoredRefresh, refreshSession, setAuthLostHandler, startSession } from './api';
import { setBusinessType, setCompanyColor } from './theme';
import { setTypography } from './typography';

export type SignInMethod = 'PASSWORD' | 'PASSWORD_OTP' | 'OTP';

export interface Me {
  id: string; username: string; fullName: string; mobile?: string | null; language: string;
  roles: string[]; roleNames?: string[]; permissions: string[]; allLocations: boolean;
  isSuper?: boolean;
  /** still on the default / temporary password: the app asks for a new one */
  mustChangePassword?: boolean;
  company?: { id: string; code: string; name: string; businessType?: string; businessName?: string; businessLogo?: string; businessFrame?: string | null; businessFont?: string; businessFontSize?: string; businessNavColor?: string | null } | null;
  locations: Array<{ id: string; code: string; name: string; nameTa?: string | null; type: string; cardEnabled: boolean; defaultOpeningCash: string }>;
}

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  can: (perm: string) => boolean;
  /** Branch users work on one branch from their phone; everyone else gets the office view. */
  isBranchUser: boolean;
  identify: (identifier: string) => Promise<SignInMethod>;
  loginWithPassword: (username: string, password: string) => Promise<'SIGNED_IN' | 'OTP_SENT'>;
  requestOtp: (mobile: string) => Promise<void>;
  verifyOtp: (mobile: string, otp: string) => Promise<void>;
  logout: () => Promise<void>;
  /** call after the password was changed so the prompt goes away */
  passwordChanged: () => void;
  refreshMe: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>(null as unknown as SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthLostHandler(() => setMe(null));
    (async () => {
      // the access token lives in memory only; a cold start restores the session from the stored refresh token
      if (await loadStoredRefresh()) {
        const r = await refreshSession();
        if (r?.user) setMe(r.user);
      }
      setLoading(false);
    })();
    return () => setAuthLostHandler(null);
  }, []);

  // live updates run while someone is signed in
  useEffect(() => { if (me) connectLive(); else disconnectLive(); }, [!!me]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBusinessType(me?.company?.businessType); }, [me?.company?.businessType]);
  useEffect(() => { setCompanyColor(me?.company?.businessNavColor); }, [me?.company?.businessNavColor]);
  // the company's typeface and text size
  useEffect(() => { void setTypography(me?.company?.businessFont, me?.company?.businessFontSize); }, [me?.company?.businessFont, me?.company?.businessFontSize]);
  // the company's name, logo or business type was changed (by the Super Admin or the Admin): everyone signed in picks it up now
  useLive(() => { if (me) void api.get<Me>('/me').then(setMe).catch(() => undefined); }, ['COMPANY', 'SETTING']);

  const start = async (res: any) => { await startSession(res); setMe(res.user); };

  const identify = useCallback(async (identifier: string) => (await api.post('/auth/identify', { identifier })).method as SignInMethod, []);
  const loginWithPassword = useCallback(async (username: string, password: string) => {
    const res = await api.post('/auth/login', { username, password, ...clientInfo() });
    if (res.otpRequired) return 'OTP_SENT' as const;
    await start(res);
    return 'SIGNED_IN' as const;
  }, []);
  const requestOtp = useCallback(async (mobile: string) => { await api.post('/auth/otp/request', { mobile }); }, []);
  const verifyOtp = useCallback(async (mobile: string, otp: string) => { await start(await api.post('/auth/otp/verify', { mobile, otp, ...clientInfo() })); }, []);
  const logout = useCallback(async () => {
    await unregisterPush(); // while the session is still valid
    try { await api.post('/auth/logout'); } catch (e) { if (!(e instanceof ApiError)) throw e; }
    await endSession();
    setMe(null);
  }, []);

  const passwordChanged = useCallback(() => setMe((m) => (m ? { ...m, mustChangePassword: false } : m)), []);
  const refreshMe = useCallback(async () => { setMe(await api.get<Me>('/me')); }, []);

  const value = useMemo<SessionCtx>(() => {
    const perms = new Set(me?.permissions ?? []);
    return {
      me, loading, can: (p) => perms.has(p),
      isBranchUser: perms.has('closing:submit') && !perms.has('closing:approve'),
      identify, loginWithPassword, requestOtp, verifyOtp, logout, passwordChanged, refreshMe,
    };
  }, [me, loading, identify, loginWithPassword, requestOtp, verifyOtp, logout, passwordChanged, refreshMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

/** A branch user works on exactly one branch. */
export function useBranch() {
  const { me } = useSession();
  const branch = me?.locations[0] ?? null;
  return { branch, locationId: branch?.id ?? '' };
}
