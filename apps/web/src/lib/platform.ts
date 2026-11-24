/**
 * Web or mobile-app pages. The web app and the mobile app (its browser build) are two different sites: this module knows where
 * the mobile one lives and whether the visitor is on a phone, so the login page can offer both and pick one by itself.
 */
const KEY = 'bp.platform';
export type Platform = 'web' | 'mobile';

/** Address of the mobile app's browser build: NEXT_PUBLIC_MOBILE_APP_URL, or in development the same host on port 8181 (the Expo web server). '' = not available. */
export function mobileAppUrl(): string {
  const set = process.env.NEXT_PUBLIC_MOBILE_APP_URL;
  if (set) return set.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:8181`;
  return '';
}

/** What the visitor chose last time (null = never chose, so the device decides). */
export const chosenPlatform = (): Platform | null => {
  try { const v = window.localStorage.getItem(KEY); return v === 'web' || v === 'mobile' ? v : null; } catch { return null; }
};
export const rememberPlatform = (p: Platform) => { try { window.localStorage.setItem(KEY, p); } catch { /* storage unavailable */ } };

/** A phone (not a tablet-sized desktop window): a mobile browser, or a touch screen that is narrow. */
export function isPhone(): boolean {
  const ua = navigator.userAgent;
  if (/Android.+Mobile|iPhone|iPod|Windows Phone|Mobile Safari/i.test(ua)) return true;
  return window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 768;
}

/** Where the mobile app's sign-in page is. */
export const mobileLoginUrl = () => { const base = mobileAppUrl(); return base ? `${base}/login` : ''; };
