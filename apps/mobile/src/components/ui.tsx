import { Feather } from '@expo/vector-icons';
import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  View, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STATUS_LABEL } from '@/lib/labels';
import { cleanAmount } from '@/lib/money';
import { RADIUS, TOUCH, useTheme, type Theme } from '@/lib/theme';

export type IconName = keyof typeof Feather.glyphMap;
type ToneName = 'ok' | 'warn' | 'bad' | 'violet' | 'sky' | 'neutral';

// ------------------------------------------------------------------ layout
/** A scrolling page with the app background, pull-to-refresh and keyboard handling. */
export function Screen({ children, onRefresh, padBottom = 24 }: { children: ReactNode; onRefresh?: () => Promise<void> | void; padBottom?: number }) {
  const th = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await onRefresh?.(); } finally { setRefreshing(false); }
  }, [onRefresh]);
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: th.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: padBottom, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={th.brand} /> : undefined}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Card({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: ToneName }) {
  const th = useTheme();
  const t = tone ? th[tone] : null;
  return (
    <View style={[{ backgroundColor: t?.bg ?? th.surface, borderColor: t?.border ?? th.border, borderWidth: 1, borderRadius: RADIUS, padding: 16, gap: 12 }, style]}>
      {children}
    </View>
  );
}

export function Heading({ title, sub }: { title: string; sub?: string }) {
  const th = useTheme();
  return (
    <View>
      {sub ? <Text style={{ color: th.muted, fontSize: 13 }}>{sub}</Text> : null}
      <Text style={{ color: th.ink, fontSize: 22, fontWeight: '700' }}>{title}</Text>
    </View>
  );
}

export const H3 = ({ children }: { children: ReactNode }) => {
  const th = useTheme();
  return <Text style={{ color: th.ink, fontSize: 16, fontWeight: '600' }}>{children}</Text>;
};

export const Muted = ({ children, small }: { children: ReactNode; small?: boolean }) => {
  const th = useTheme();
  return <Text style={{ color: th.muted, fontSize: small ? 12 : 14 }}>{children}</Text>;
};

export function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: string }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: th.muted, fontSize: 14, flexShrink: 1, fontWeight: bold ? '700' : '400' }}>{label}</Text>
      <Text style={{ color: accent ?? th.ink, fontSize: 14, fontWeight: bold ? '700' : '500', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

export function Divider() {
  const th = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: th.border }} />;
}

// ------------------------------------------------------------------ buttons
export function Button({
  title, onPress, variant = 'primary', disabled, loading, icon, small, style,
}: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; loading?: boolean; icon?: IconName; small?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const th = useTheme();
  const off = disabled || loading;
  const bg = variant === 'primary' ? th.brand : variant === 'danger' ? th.bad.bg : th.surface;
  const fg = variant === 'primary' ? th.onBrand : variant === 'danger' ? th.bad.text : th.ink;
  const border = variant === 'primary' ? th.brand : variant === 'danger' ? th.bad.border : th.border;
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off} onPress={onPress}
      style={({ pressed }) => [{
        minHeight: small ? 40 : TOUCH, paddingHorizontal: small ? 14 : 18, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: bg,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: off ? 0.5 : pressed ? 0.85 : 1,
      }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Feather name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 14 : 16 }}>{title}</Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ inputs
function labelEl(th: Theme, label: string, required?: boolean) {
  return (
    <Text style={{ color: th.muted, fontSize: 13, fontWeight: '600', marginBottom: 4 }}>
      {label}{required ? <Text style={{ color: th.bad.text }}> *</Text> : null}
    </Text>
  );
}

export function Field({ label, required, error, style, multiline, ...rest }: { label: string; required?: boolean; error?: string | null } & TextInputProps) {
  const th = useTheme();
  return (
    <View>
      {labelEl(th, label, required)}
      <TextInput
        placeholderTextColor={th.faint}
        multiline={multiline}
        style={[{
          minHeight: multiline ? 84 : TOUCH, borderRadius: 12, borderWidth: 1, borderColor: error ? th.bad.border : th.border, backgroundColor: th.fieldBg,
          color: th.ink, paddingHorizontal: 12, paddingVertical: multiline ? 10 : 8, fontSize: 16, textAlignVertical: multiline ? 'top' : 'center',
        }, style]}
        {...rest}
      />
      {error ? <Text style={{ color: th.bad.text, fontSize: 13, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

export function MoneyField({ label, value, onChange, required, disabled, hint }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; disabled?: boolean; hint?: string }) {
  const th = useTheme();
  return (
    <View>
      {labelEl(th, label, required)}
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: TOUCH, borderRadius: 12, borderWidth: 1, borderColor: th.border, backgroundColor: th.fieldBg, paddingHorizontal: 12, opacity: disabled ? 0.6 : 1 }}>
        <Text style={{ color: th.muted, fontSize: 16, marginRight: 6 }}>₹</Text>
        <TextInput
          style={{ flex: 1, color: th.ink, fontSize: 18, paddingVertical: 8, fontVariant: ['tabular-nums'] }}
          keyboardType="decimal-pad" placeholder="0" placeholderTextColor={th.faint} editable={!disabled}
          value={value} onChangeText={(v) => onChange(cleanAmount(v))}
        />
      </View>
      {hint ? <Text style={{ color: th.muted, fontSize: 12, marginTop: 4 }}>{hint}</Text> : null}
    </View>
  );
}

/** Single-choice pills (payment mode, reason, sub-category ...). */
export function Chips<T extends string>({ label, value, onChange, options }: { label?: string; value: T | ''; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  const th = useTheme();
  return (
    <View>
      {label ? labelEl(th, label) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, justifyContent: 'center', borderColor: on ? th.brand : th.border, backgroundColor: on ? th.brand : th.surface }}
            >
              <Text style={{ color: on ? th.onBrand : th.ink, fontWeight: '500' }}>{on ? '✓ ' : ''}{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ status
const STATUS_TONE: Record<string, { tone: ToneName; icon: string }> = {
  PENDING: { tone: 'neutral', icon: '○' }, SUBMITTED: { tone: 'warn', icon: '◔' }, APPROVED: { tone: 'ok', icon: '✓' },
  REJECTED: { tone: 'bad', icon: '✕' }, REOPENED: { tone: 'violet', icon: '↺' },
};

/** Colour + icon + word, never colour alone. */
export function Chip({ text, tone = 'neutral', icon }: { text: string; tone?: ToneName; icon?: string }) {
  const th = useTheme();
  const t = th[tone];
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: t.bg, borderColor: t.border }}>
      {icon ? <Text style={{ color: t.text, fontSize: 12 }}>{icon}</Text> : null}
      <Text style={{ color: t.text, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_TONE[status] ?? STATUS_TONE.PENDING;
  return <Chip text={STATUS_LABEL[status] ?? status} tone={s.tone} icon={s.icon} />;
}

export function Banner({ tone, children }: { tone: ToneName; children: ReactNode }) {
  const th = useTheme();
  const t = th[tone];
  return (
    <View accessibilityRole="alert" style={{ borderWidth: 1, borderRadius: RADIUS, padding: 12, backgroundColor: t.bg, borderColor: t.border }}>
      <Text style={{ color: t.text, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  return error ? <Banner tone="bad">✕ {error}</Banner> : null;
}

export function Warnings({ items }: { items: Array<{ code: string; message: string }> }) {
  return items.length ? <View style={{ gap: 8 }}>{items.map((w) => <Banner key={w.code + w.message} tone="warn">⚠ {w.message}</Banner>)}</View> : null;
}

export function Loading() {
  const th = useTheme();
  return <View style={{ padding: 48, alignItems: 'center' }}><ActivityIndicator size="large" color={th.brand} /></View>;
}

export function Empty({ text }: { text: string }) {
  return <View style={{ padding: 24, alignItems: 'center' }}><Muted>{text}</Muted></View>;
}

// ------------------------------------------------------------------ modal sheet
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.5)' }} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ backgroundColor: th.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%', paddingBottom: insets.bottom + 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
            <Text style={{ color: th.ink, fontSize: 18, fontWeight: '700', flexShrink: 1 }}>{title}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={12} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={22} color={th.muted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 16 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ------------------------------------------------------------------ app bar
/** Branch + user header shown above every tab (mirrors the web app's top bar). */
export function AppBar({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: th.brand, paddingTop: insets.top + 8, paddingBottom: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="activity" size={20} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function IconButton({ icon, onPress, label }: { icon: IconName; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name={icon} size={22} color="#fff" />
    </Pressable>
  );
}

/** Date row with previous / next arrows (the web DateNav). */
export function DateStepper({ date, label, onPrev, onNext, nextDisabled }: { date: string; label: string; onPrev: () => void; onNext: () => void; nextDisabled?: boolean }) {
  const th = useTheme();
  void date;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: th.surface, borderWidth: 1, borderColor: th.border, borderRadius: 14 }}>
      <Pressable onPress={onPrev} accessibilityLabel="Previous day" style={{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="chevron-left" size={22} color={th.ink} />
      </Pressable>
      <Text style={{ color: th.ink, fontWeight: '700', fontSize: 16 }}>{label}</Text>
      <Pressable onPress={onNext} disabled={nextDisabled} accessibilityLabel="Next day" style={{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', opacity: nextDisabled ? 0.3 : 1 }}>
        <Feather name="chevron-right" size={22} color={th.ink} />
      </Pressable>
    </View>
  );
}

/** A tappable card row with an icon, title, detail and chevron (the branch home checklist). */
export function LinkCard({ icon, title, detail, right, onPress, done }: { icon: IconName; title: string; detail?: string; right?: ReactNode; onPress: () => void; done?: boolean }) {
  const th = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 12 }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? th.ok.bg : th.brandLight }}>
          <Feather name={icon} size={22} color={done ? th.ok.text : th.brandDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: th.ink, fontWeight: '600', fontSize: 16 }}>{title}</Text>
          {detail ? <Text style={{ color: th.ink, fontWeight: '700', fontSize: 18, fontVariant: ['tabular-nums'] }}>{detail}</Text> : null}
        </View>
        {right}
        <Feather name="chevron-right" size={18} color={th.faint} />
      </Card>
    </Pressable>
  );
}
