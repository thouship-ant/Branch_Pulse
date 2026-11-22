import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from '@/lib/storage';
import { Linking, Platform } from 'react-native';
import { api } from './api';

/**
 * Push notifications (Expo push service).
 *
 *  - The phone registers its Expo push token with the API after sign-in and removes it at sign-out.
 *  - A notification carries a `category` that decides its action buttons, and `data.type` that decides where a tap goes:
 *
 *      EXPENSE_APPROVAL   Approve | Reject        -> Approvals > Expenses
 *      CLOSING_APPROVAL   Approve | Review        -> Approvals > Closing
 *      CLOSING_REMINDER   Open closing            -> the closing screen
 *      EXPENSE_RESULT / CLOSING_RESULT (info)     -> the item
 */
const TOKEN_KEY = 'bp_push_token';
const PREF_KEY = 'bp_push_enabled';
const supported = Platform.OS !== 'web' && Device.isDevice;

// while the app is open a notification still shows as a banner
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushData = {
  type?: string; category?: string; expenseId?: string; closingId?: string; locationId?: string; date?: string; code?: string;
};

export const ACTION = { APPROVE: 'APPROVE', REJECT: 'REJECT', REVIEW: 'REVIEW', OPEN_CLOSING: 'OPEN_CLOSING' } as const;

/** Android channels and the action buttons of each kind of notification. Safe to call more than once. */
export async function setupNotifications() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Approvals and results', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], lightColor: '#1e2a8a',
    });
    await Notifications.setNotificationChannelAsync('reminders', { name: 'Closing reminders', importance: Notifications.AndroidImportance.DEFAULT });
  }
  const approve = { identifier: ACTION.APPROVE, buttonTitle: 'Approve', options: { opensAppToForeground: true } };
  await Notifications.setNotificationCategoryAsync('approval_expense', [
    approve, { identifier: ACTION.REJECT, buttonTitle: 'Reject', options: { opensAppToForeground: true, isDestructive: true } },
  ]);
  await Notifications.setNotificationCategoryAsync('approval_closing', [
    approve, { identifier: ACTION.REVIEW, buttonTitle: 'Review', options: { opensAppToForeground: true } },
  ]);
  await Notifications.setNotificationCategoryAsync('closing_reminder', [
    { identifier: ACTION.OPEN_CLOSING, buttonTitle: 'Open closing', options: { opensAppToForeground: true } },
  ]);
}

export async function pushEnabled(): Promise<boolean> {
  try { return (await SecureStore.getItemAsync(PREF_KEY)) !== 'off'; } catch { return true; }
}

export async function setPushEnabled(on: boolean) {
  try { on ? await SecureStore.deleteItemAsync(PREF_KEY) : await SecureStore.setItemAsync(PREF_KEY, 'off'); } catch { /* storage unavailable */ }
  if (on) return registerForPush();
  await unregisterPush();
  return null;
}

/** Asks for permission, gets this phone's Expo push token and tells the API. Returns the token, or null when notifications cannot be used here. */
let problem: string | null = null;
/** Why the last attempt to register this phone did not work (shown on the Account screen), or null. */
export const pushProblem = () => problem;

/** Turns the raw error into something a person can act on. */
function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/FirebaseApp|google-services|FCM|Firebase/i.test(m)) return 'This build has no Firebase setup (google-services.json). Add it and make a new build, then try again.';
  if (/network|timeout|fetch/i.test(m)) return 'Could not reach the notification service. Check the internet connection and try again.';
  return m;
}

export async function registerForPush(): Promise<string | null> {
  problem = null;
  if (!supported) { problem = Platform.OS === 'web' ? 'Notifications are not available in the browser.' : 'Notifications need a real phone, not an emulator.'; return null; }
  if (!(await pushEnabled())) { problem = 'Push notifications are switched off here.'; return null; }
  try {
    await setupNotifications();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })).status; // the system asks the person here
    if (status !== 'granted') { problem = 'Notifications are blocked for Branch Pulse. Allow them in the phone settings.'; return null; }
    // the Expo (EAS) project id: `eas init` writes it into app.json (extra.eas.projectId)
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) { console.warn('[push] No EAS project id: run `eas init` in apps/mobile'); problem = 'This build has no Expo project id (run eas init and rebuild).'; return null; }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.post('/push/register', { token, platform: Platform.OS, deviceName: Device.deviceName ?? Device.modelName ?? undefined });
    try { await SecureStore.setItemAsync(TOKEN_KEY, token); } catch { /* storage unavailable */ }
    return token;
  } catch (e) {
    console.warn('[push] could not register', e);
    problem = explain(e);
    return null;
  }
}

/** At sign-out: this phone stops receiving this person's notifications. */
export async function unregisterPush() {
  if (!supported) return;
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) {
      await api.post('/push/unregister', { token });
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
  } catch { /* offline or already signed out: the server drops dead tokens by itself */ }
}

export const sendTestPush = () => api.post<{ sent: number }>('/push/test');

/** 'granted' | 'denied' | 'undetermined' (never asked) - and whether the system will still show its permission question. */
export async function notificationPermission(): Promise<{ status: string; canAskAgain: boolean }> {
  if (!supported) return { status: 'unavailable', canAskAgain: false };
  const p = await Notifications.getPermissionsAsync();
  return { status: p.status, canAskAgain: p.canAskAgain };
}

/** The phone's own settings page for this app (where notifications can be switched on after they were refused). */
export const openNotificationSettings = () => Linking.openSettings();

const ASKED_KEY = 'bp_push_asked';
/** True the first time only: used to explain once, in the app's words, why notifications are wanted and where to switch them on. */
export async function shouldExplainOnce(): Promise<boolean> {
  try {
    if ((await SecureStore.getItemAsync(ASKED_KEY)) === '1') return false;
    await SecureStore.setItemAsync(ASKED_KEY, '1');
    return true;
  } catch { return false; }
}
