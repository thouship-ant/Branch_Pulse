import { Text, View } from 'react-native';
import { PASSWORD_RULES } from '@/lib/password';
import { useTheme } from '@/lib/theme';

/** Live list of the password rules: tick when met, circle when not (never colour alone). */
export function PasswordChecklist({ value }: { value: string }) {
  const th = useTheme();
  return (
    <View style={{ gap: 2 }}>
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value);
        return <Text key={r.key} style={{ color: ok ? th.ok.text : th.muted, fontSize: 13 }}>{ok ? '✓' : '○'} {r.label}</Text>;
      })}
    </View>
  );
}
