import { Feather } from '@expo/vector-icons';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, TextInput, View, type StyleProp, type TextInputProps, type ViewProps, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STATUS_LABEL } from '@/lib/labels';
import { useHeader } from './HeaderContext';
import { useLang } from '@/lib/language';
import { tr } from '@/lib/i18n';
import { cleanAmount } from '@/lib/money';
import { RADIUS, TOUCH, useTheme, type Theme } from '@/lib/theme';

export type IconName = keyof typeof Feather.glyphMap;
type ToneName = 'ok' | 'warn' | 'bad' | 'violet' | 'sky' | 'neutral';

// ------------------------------------------------------------------ layout
/**
 * A scrolling page with the app background, the curved header, pull-to-refresh and keyboard handling.
 * `hero`: the header stays fixed behind the page and the first card (HeroCard) sits over it - scrolling up, the cards
 * slide over the header. Without it the header is a normal bar above the page.
 */
export function Screen({ children, onRefresh, padBottom = 24, hero, headerRight, title }: { children: ReactNode; onRefresh?: () => Promise<void> | void; padBottom?: number; hero?: boolean; headerRight?: ReactNode; title?: string }) {
  const th = useTheme();
  const header = useHeader();
  const [headerH, setHeaderH] = useState(190);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await onRefresh?.(); } finally { setRefreshing(false); }
  }, [onRefresh]);
  const overlap = !!hero && !!header && !title;
  const bar = title ? <SubHeader title={title} right={headerRight} /> : header ? <AppBar {...header} right={headerRight ?? header.right} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)} /> : null;
  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      {bar && !overlap ? bar : null}
      {bar && overlap ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>{bar}</View> : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingTop: overlap ? headerH - 30 : 16, paddingBottom: padBottom, gap: 16 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={overlap ? '#fff' : th.brand} progressViewOffset={overlap ? headerH - 60 : 0} /> : undefined}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Soft card look: a shadow in light mode, a hairline in dark mode. */
export function cardLook(th: Theme): ViewStyle {
  return th.dark
    ? { borderWidth: 1, borderColor: th.border }
    : { shadowColor: '#1e2a8a', shadowOpacity: 0.09, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3 };
}

/** A soft white card. `tone` tints it (alerts). */
export function Card({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: ToneName }) {
  const th = useTheme();
  const t = tone ? th[tone] : null;
  return (
    <View style={[{ backgroundColor: t?.bg ?? th.surface, borderRadius: 20, padding: 16, gap: 12 }, t ? { borderWidth: 1, borderColor: t.border } : cardLook(th), style]}>
      {children}
    </View>
  );
}

/** Rounded tinted square holding an icon (the coloured tile on every stat card). */
export function IconTile({ icon, tone = 'brand', size = 48 }: { icon: IconName; tone?: ToneName | 'brand'; size?: number }) {
  const th = useTheme();
  const c = tone === 'brand' ? { bg: th.brandLight, fg: th.brandDark } : { bg: th[tone].bg, fg: th[tone].text };
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name={icon} size={size * 0.46} color={c.fg} />
    </View>
  );
}

/** Half-width stat card: icon tile, big number, label (the "Overview" grid). */
export function StatCard({ icon, tone = 'brand', value, label, sub, alert }: { icon: IconName; tone?: ToneName | 'brand'; value: string; label: string; sub?: string; alert?: boolean }) {
  const th = useTheme();
  return (
    <View style={[{ width: '47.8%', backgroundColor: th.surface, borderRadius: 20, padding: 16, gap: 10 }, cardLook(th)]}>
      <IconTile icon={icon} tone={tone} />
      <View>
        <Text style={{ color: alert ? th.bad.text : th.ink, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
        <Text style={{ color: th.muted, fontSize: 14 }}>{label}</Text>
        {sub ? <Text style={{ color: th.faint, fontSize: 12, marginTop: 2 }}>{sub}</Text> : null}
      </View>
    </View>
  );
}

/** The big headline card that overlaps the header: icon + label, huge value, then figures side by side. */
export function HeroCard({
  icon, label, value, sub, columns, children,
}: { icon: IconName; label: string; value: string; sub?: string; columns?: Array<{ label: string; value: string; color?: string }>; children?: ReactNode }) {
  const th = useTheme();
  return (
    <View style={[{ backgroundColor: th.surface, borderRadius: 24, padding: 20, gap: 14 }, cardLook(th)]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile icon={icon} tone="bad" size={50} />
        <Text style={{ color: th.muted, fontSize: 17, fontWeight: '500', flex: 1 }}>{label}</Text>
      </View>
      <View>
        <Text style={{ color: th.ink, fontSize: 38, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
        {sub ? <Text style={{ color: th.faint, fontSize: 12 }}>{sub}</Text> : null}
      </View>
      {columns?.length ? (
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: th.border, paddingTop: 14 }}>
          {columns.map((c, i) => (
            <View key={c.label} style={{ flex: 1, paddingLeft: i ? 16 : 0, borderLeftWidth: i ? 1 : 0, borderLeftColor: th.border }}>
              <Text style={{ color: th.muted, fontSize: 14 }}>{c.label}</Text>
              <Text style={{ color: c.color ?? th.ink, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{c.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
        placeholder={typeof rest.placeholder === 'string' ? tr(rest.placeholder) : rest.placeholder}
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
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good Morning,' : h < 17 ? 'Good Afternoon,' : 'Good Evening,'; };

/**
 * Curved brand header: logo, greeting, the user's name and the company (and branch) under it. The bottom padding leaves
 * room for the first card to overlap it (HeroCard).
 */
export function AppBar({ title, subtitle, right, onLayout }: { title: string; subtitle?: string; right?: ReactNode; onLayout?: ViewProps['onLayout'] }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      onLayout={onLayout}
      style={{ backgroundColor: th.brand, paddingTop: insets.top + 14, paddingBottom: 62, paddingHorizontal: 20, borderBottomLeftRadius: 34, borderBottomRightRadius: 34, flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <Image source={require('../../assets/logo.png')} accessibilityLabel="Branch Pulse" style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: '#fff' }} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.78)', fontSize: 14 }}>{greeting()}</Text>
        <Text numberOfLines={1} style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '500' }}>{subtitle}</Text> : null}
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

/** A dropdown: shows the chosen option and opens a list in a sheet (the phone version of a <select>). */
export function SelectField<T extends string>({
  label, value, onChange, options, placeholder = 'Select…', required, disabled,
}: { label: string; value: T | ''; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; placeholder?: string; required?: boolean; disabled?: boolean }) {
  const th = useTheme();
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  return (
    <View>
      {labelEl(th, label, required)}
      <Pressable
        accessibilityRole="button" accessibilityState={{ disabled: !!disabled, expanded: open }} disabled={disabled} onPress={() => setOpen(true)}
        style={{ minHeight: TOUCH, borderRadius: 12, borderWidth: 1, borderColor: th.border, backgroundColor: th.fieldBg, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: disabled ? 0.5 : 1 }}
      >
        <Text numberOfLines={1} style={{ color: chosen ? th.ink : th.faint, fontSize: 16, flex: 1 }}>{chosen?.label ?? placeholder}</Text>
        <Feather name="chevron-down" size={20} color={th.muted} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value} accessibilityRole="button" accessibilityState={{ selected: on }}
              onPress={() => { onChange(o.value); setOpen(false); }}
              style={{ minHeight: TOUCH, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center', borderColor: on ? th.brand : th.border, backgroundColor: on ? th.brandLight : th.surface }}
            >
              <Text style={{ color: th.ink, fontWeight: on ? '700' : '400' }}>{on ? '✓ ' : ''}{o.label}</Text>
            </Pressable>
          );
        })}
      </Sheet>
    </View>
  );
}

// ------------------------------------------------------------------ sub-pages
/** Slim brand bar for sub-pages: back arrow, title, optional action on the right. */
export function SubHeader({ title, right }: { title: string; right?: ReactNode }) {
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: th.brand, paddingTop: insets.top + 6, paddingBottom: 14, paddingHorizontal: 8, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel="Back" hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="arrow-left" size={24} color="#fff" />
      </Pressable>
      <Text numberOfLines={1} style={{ color: '#fff', fontSize: 20, fontWeight: '800', flex: 1 }}>{title}</Text>
      {right}
    </View>
  );
}

/** Horizontal pill tabs for pages with several sections (Daily | Variance report ...). */
export function SegTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ key: T; label: string }> }) {
  const th = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key} onPress={() => onChange(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? th.brand : th.surface, ...(on ? {} : cardLook(th)) }}
          >
            <Text style={{ color: on ? th.onBrand : th.ink, fontWeight: '700', fontSize: 14 }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A tappable list card: title + lines on the left, value / status on the right. */
export function ListRow({ title, lines, right, onPress, tone }: { title: string; lines?: Array<string | null | undefined | false>; right?: ReactNode; onPress?: () => void; tone?: ToneName }) {
  const th = useTheme();
  const body = (
    <Card tone={tone} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: th.ink, fontWeight: '700', fontSize: 16 }}>{title}</Text>
        {lines?.filter(Boolean).map((l, i) => <Text key={i} style={{ color: th.muted, fontSize: 13 }}>{l}</Text>)}
      </View>
      {right ? <View style={{ alignItems: 'flex-end', gap: 4 }}>{right}</View> : null}
      {onPress ? <Feather name="chevron-right" size={18} color={th.faint} /> : null}
    </Card>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>{body}</Pressable> : body;
}

export const SectionTitle = ({ children }: { children: ReactNode }) => {
  const th = useTheme();
  return <Text style={{ color: th.ink, fontSize: 18, fontWeight: '800' }}>{children}</Text>;
};

/** Label + value summary line used in detail cards. */
export function KV({ label, value, bold }: { label: string; value: string; bold?: boolean }) { return <Row label={label} value={value} bold={bold} />; }

/** Date row with previous / next arrows (the web DateNav). */
export function DateStepper({ label, onPrev, onNext, nextDisabled }: { date?: string; label: string; onPrev: () => void; onNext: () => void; nextDisabled?: boolean }) {
  const th = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: th.surface, borderRadius: 18 }, cardLook(th)]}>
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

/** Horizontal bars with a label, an amount and an optional detail line (branch-wise / category-wise breakdowns). */
export function BarList({ rows, format, color }: { rows: Array<{ key: string; label: string; value: number; detail?: string }>; format: (n: number) => string; color?: string }) {
  const th = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <Muted>No data for this period.</Muted>;
  return (
    <View style={{ gap: 12 }}>
      {rows.map((r) => (
        <View key={r.key} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '600', flex: 1 }}>{r.label}</Text>
            <Text style={{ color: th.ink, fontVariant: ['tabular-nums'], fontWeight: '700' }}>{format(r.value)}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: th.brandLight, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: color ?? th.series[1] }} />
          </View>
          {r.detail ? <Text style={{ color: th.faint, fontSize: 12 }}>{r.detail}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** Multi-choice pills (roles, branches ...). */
export function MultiChips({ label, values, onChange, options }: { label?: string; values: string[]; onChange: (v: string[]) => void; options: Array<{ value: string; label: string }> }) {
  const th = useTheme();
  return (
    <View>
      {label ? labelEl(th, label) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <Pressable
              key={o.value} onPress={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
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

/** A labelled on/off switch row. */
export function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TOUCH }}>
      <Text style={{ color: th.ink, fontSize: 16, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: th.brand }} />
    </View>
  );
}

/** English | தமிழ் switch (the choice is remembered on the phone). */
export function LanguageSwitch() {
  const { lang, setLang } = useLang();
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {([['en', 'English'], ['ta', 'தமிழ்']] as const).map(([code, label]) => {
        const on = lang === code;
        return (
          <Pressable
            key={code} onPress={() => setLang(code)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label}
            style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderColor: on ? th.brand : th.border, backgroundColor: on ? th.brand : th.surface }}
          >
            <Text style={{ color: on ? th.onBrand : th.ink, fontWeight: '700' }}>{on ? '✓ ' : ''}{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
