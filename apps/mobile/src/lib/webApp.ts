import { Platform } from 'react-native';

/**
 * Where the full web version lives, or '' when this is not the browser build of the app (the installed phone app has no web version to go to).
 * EXPO_PUBLIC_WEB_APP_URL, or in development the same host on port 3300 (the Next dev server).
 */
export function webAppUrl(): string {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return '';
  const set = process.env.EXPO_PUBLIC_WEB_APP_URL;
  if (set) return set.replace(/\/$/, '');
  return __DEV__ ? `${window.location.protocol}//${window.location.hostname}:3300` : '';
}
