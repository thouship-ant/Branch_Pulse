import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Empty, LinkCard, Screen } from '@/components/ui';
import { MENU } from '@/lib/menu';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** All back-office sections the signed-in user may open. */
export default function MoreScreen() {
  const th = useTheme();
  const router = useRouter();
  const { can } = useSession();
  const groups = MENU.map((g) => ({ ...g, items: g.items.filter((i) => can(i.perm)) })).filter((g) => g.items.length);
  return (
    <Screen>
      {groups.length === 0 ? <Empty text="Nothing else to show for your role." /> : groups.map((g) => (
        <View key={g.title} style={{ gap: 10 }}>
          <Text style={{ color: th.muted, fontSize: 13, fontWeight: '800', letterSpacing: 0.6 }}>{g.title.toUpperCase()}</Text>
          {g.items.map((i) => <LinkCard key={i.path} icon={i.icon} title={i.title} detail={undefined} onPress={() => router.push(i.path as any)} right={<Text style={{ color: th.faint, fontSize: 12, maxWidth: 140 }} numberOfLines={2}>{i.hint}</Text>} />)}
        </View>
      ))}
    </Screen>
  );
}
