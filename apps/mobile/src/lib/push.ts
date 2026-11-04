import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
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
export async function registerForPush(): Promise<string | null> {
  if (!supported || !(await pushEnabled())) return null;
  try {
    await setupNotifications();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    // the Expo (EAS) project id: `eas init` writes it into app.json (extra.eas.projectId)
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) { console.warn('[push] No EAS project id: run `eas init` in apps/mobile'); return null; }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.post('/push/register', { token, platform: Platform.OS, deviceName: Device.deviceName ?? Device.modelName ?? undefined });
    try { await SecureStore.setItemAsync(TOKEN_KEY, token); } catch { /* storage unavailable */ }
    return token;
  } catch (e) {
    console.warn('[push] could not register', e);
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
