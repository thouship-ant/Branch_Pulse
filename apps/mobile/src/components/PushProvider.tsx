import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { tAlert } from '@/lib/i18n';
import { ACTION, registerForPush, setupNotifications, type PushData } from '@/lib/push';
import { useSession } from '@/lib/session';

/**
 * Lives once at the app root. After sign-in it registers the phone for notifications, and it turns a tap on a notification (or on one
 * of its buttons) into the right action or screen - also when the tap is what opened the app.
 */
export function PushProvider() {
  const router = useRouter();
  const { me, isBranchUser } = useSession();
  const handled = useRef<string | null>(null);

  // register (again) whenever someone signs in
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void setupNotifications();
    if (me && !me.isSuper) void registerForPush();
  }, [me?.id]);

  useEffect(() => {
    if (Platform.OS === 'web' || !me) return;

    async function act(r: Notifications.NotificationResponse) {
      const key = `${r.notification.request.identifier}:${r.actionIdentifier}`;
      if (handled.current === key) return; // the same tap is reported by both the listener and the cold-start lookup
      handled.current = key;
      const d = (r.notification.request.content.data ?? {}) as PushData;
      const go = (href: string) => router.push(href as never);
      const closingPath = d.locationId && d.date ? `/more/closing/${d.locationId}/${d.date}` : '/approvals';

      switch (r.actionIdentifier) {
        case ACTION.APPROVE: {
          const url = d.expenseId ? `/expenses/${d.expenseId}/approve` : d.closingId ? `/closings/${d.closingId}/approve` : null;
          if (!url) return go('/approvals');
          try {
            await api.post(url, d.closingId ? {} : undefined);
            tAlert(d.expenseId ? 'Expense approved' : 'Closing approved');
          } catch (e) {
            tAlert('Could not approve', e instanceof ApiError || e instanceof Error ? e.message : undefined, [{ text: 'Open Approvals', onPress: () => go('/approvals') }, { text: 'OK' }]);
          }
          return;
        }
        case ACTION.REJECT: return go(d.expenseId ? `/approvals?reject=${d.expenseId}` : '/approvals');
        case ACTION.REVIEW: return go(closingPath);
        case ACTION.OPEN_CLOSING: return go(isBranchUser ? '/closing' : closingPath);
        default: // a plain tap on the notification
          switch (d.type) {
            case 'EXPENSE_APPROVAL': return go('/approvals');
            case 'CLOSING_APPROVAL': return go('/approvals?tab=closing');
            case 'CLOSING_REMINDER': case 'CLOSING_RESULT': return go(isBranchUser ? '/closing' : closingPath);
            case 'EXPENSE_RESULT': return go(isBranchUser ? '/expense' : '/more/expenses');
            default: return;
          }
      }
    }

    const sub = Notifications.addNotificationResponseReceivedListener((r) => void act(r));
    // the tap that launched the app
    void Notifications.getLastNotificationResponseAsync().then((r) => { if (r) void act(r); });
    return () => sub.remove();
  }, [me?.id, isBranchUser]);

  return null;
}
