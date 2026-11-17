import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useAvatar } from '@/lib/avatar';
import { useSession } from '@/lib/session';
import { useAttention } from '@/lib/useAttention';
import { Text } from '@/components/Text';

export function TeaShopHeaderActions({ hidden, onToggleHidden, onNotifications, onProfile, notifications, initials }: {
  hidden?: boolean; onToggleHidden?: () => void; onNotifications: () => void; onProfile: () => void; notifications: number; initials: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {onToggleHidden ? <Pressable onPress={onToggleHidden} accessibilityRole="button" accessibilityLabel={hidden ? 'Show amounts' : 'Hide amounts'} style={{ width: 30, height: 38, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={hidden ? 'eye-off' : 'eye'} size={18} color="#fff7ed" />
      </Pressable> : null}
      <Pressable onPress={onNotifications} accessibilityRole="button" accessibilityLabel={`Approvals${notifications ? `, ${notifications} pending` : ''}`} style={{ width: 30, height: 38, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="bell" size={18} color="#fff7ed" />
        {notifications > 0 ? (
          <View style={{ position: 'absolute', top: 1, right: -1, minWidth: 15, height: 15, borderRadius: 8, paddingHorizontal: 3, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' }}>
            <Text allowFontScaling={false} style={{ color: '#fff', fontSize: 9, lineHeight: 11, fontWeight: '800' }}>{notifications > 99 ? '99+' : notifications}</Text>
          </View>
        ) : null}
      </Pressable>
      <ProfilePill onPress={onProfile} initials={initials} />
    </View>
  );
}

/** The header's right side for a tea-shop page: amounts toggle (when the page supports it), approvals bell and profile. */
export function useTeaHeaderRight({ canHide = false }: { canHide?: boolean } = {}) {
  const router = useRouter();
  const { me } = useSession();
  const attention = useAttention();
  const [hidden, setHidden] = useState(false);
  const right = (
    <TeaShopHeaderActions
      hidden={hidden}
      onToggleHidden={canHide ? () => setHidden((h) => !h) : undefined}
      onNotifications={() => router.push('/approvals' as any)}
      onProfile={() => router.push('/account' as any)}
      notifications={attention.waiting}
      initials={me?.fullName?.trim().split(/\s+/).map((part) => part[0]).slice(0, 1).join('').toUpperCase() || 'A'}
    />
  );
  return { hidden, right };
}

/** The person's photo (or, without one, their initial) as a round button; opens Account. No name beside it. */
export function ProfilePill({ onPress, initials }: { onPress: () => void; initials?: string }) {
  const { me } = useSession();
  const avatar = useAvatar(me?.id);
  const firstName = me?.fullName?.trim().split(/\s+/)[0] ?? '';
  const letter = initials ?? (firstName[0]?.toUpperCase() || 'A');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Account${firstName ? `, ${firstName}` : ''}`} hitSlop={6} style={{ marginLeft: 4 }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#ffe9c2', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,225,190,0.8)' }}>
        {avatar.uri
          ? <Image source={{ uri: avatar.uri }} accessibilityLabel="Profile photo" style={{ width: '100%', height: '100%' }} />
          : <Text style={{ color: '#54210d', fontSize: 14, fontWeight: '800' }}>{letter}</Text>}
      </View>
    </Pressable>
  );
}
