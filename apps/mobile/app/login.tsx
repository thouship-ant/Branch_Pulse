import { Feather } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text as PlainText, TextInput, View } from 'react-native';
import { ThemeBackdrop, ThemeHeaderBg, useBackdropGeometry } from '@/components/ThemeBackdrop';
import { Text } from '@/components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ErrorBox, Field, Muted, Sheet } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useLang } from '@/lib/language';
import { useSession, type SignInMethod } from '@/lib/session';
import { OtpInput } from '@/components/OtpInput';
import { ThemeOverrideProvider, useTheme } from '@/lib/theme';

type Step = 'id' | 'password' | 'otp';
const RESEND_SECONDS = 30;

const friendly = (err: unknown) =>
  err instanceof ApiError
    ? err.code === 'ACCOUNT_LOCKED' ? 'Too many attempts. Try again in 15 minutes.' : err.message
    : err instanceof Error ? err.message : 'Could not sign in';

/**
 * Sign in: type the mobile number, then
 *   - Super Admin (username) -> password
 *   - Admin                  -> password, then an OTP
 *   - everyone else          -> an OTP
 */
export default function LoginScreen() {
  return (
    <ThemeOverrideProvider businessType="TEA_SHOP">
      <LoginForm />
    </ThemeOverrideProvider>
  );
}

function LoginForm() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const geo = useBackdropGeometry();
  const { lang, setLang } = useLang();
  const { me, identify, loginWithPassword, requestOtp, verifyOtp } = useSession();
  const [step, setStep] = useState<Step>('id');
  const [method, setMethod] = useState<SignInMethod>('OTP');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0); // seconds until "Resend OTP" works

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  if (me) return <Redirect href="/" />;

  const id = identifier.trim();
  const isMobile = /^\d{10}$/.test(id);

  /** Run one step. A failure re-enables the form; a step that signs the user in stays busy until the redirect. */
  async function run(fn: () => Promise<boolean | void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const signedIn = await fn();
      if (!signedIn) setBusy(false);
    } catch (err) {
      // "wait 30 seconds before another OTP" is not an error to read: the button simply counts down
      if (err instanceof ApiError && err.code === 'OTP_TOO_SOON') setWait(Number(/(\d+)\s*second/.exec(err.message)?.[1]) || RESEND_SECONDS);
      else setError(friendly(err));
      setBusy(false);
    }
  }

  const onIdentify = () => run(async () => {
    const m = await identify(id);
    setMethod(m);
    if (m === 'OTP') {
      if (!isMobile) throw new Error('Enter your 10-digit mobile number');
      await requestOtp(id);
      setWait(RESEND_SECONDS);
      setStep('otp');
    } else setStep('password');
  });

  const onPassword = () => run(async () => {
    const r = await loginWithPassword(id, password);
    if (r === 'OTP_SENT') { setWait(RESEND_SECONDS); setOtp(''); setStep('otp'); return false; }
    return true; // Super Admin: signed in
  });

  const onOtp = () => run(async () => { await verifyOtp(id, otp); return true; });

  const resend = () => run(async () => {
    if (method === 'PASSWORD_OTP') await loginWithPassword(id, password); // sends a fresh OTP after re-checking the password
    else await requestOtp(id);
    setOtp('');
    setWait(RESEND_SECONDS);
  });

  const back = () => { setStep('id'); setPassword(''); setOtp(''); setError(null); setWait(0); };

  const masked = isMobile ? `+91 ${id.slice(0, 2)}******${id.slice(-2)}` : id;

  return (
    <View style={{ flex: 1, width: '100%', backgroundColor: th.bg }}>
      <ThemeBackdrop />
      {/* the tea-cup header, with no logo or name (nobody is signed in yet) */}
      <ThemeHeaderBg emblem={false} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: geo.barH + 12, paddingBottom: insets.bottom + 20 }}
          showsVerticalScrollIndicator={false}
        >
        <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: th.dark ? 'rgba(40,26,18,0.94)' : 'rgba(255,250,244,0.94)', borderRadius: 28, borderWidth: th.dark ? 1 : 0, borderColor: th.border, padding: 20, gap: 22, shadowColor: '#47210e', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ color: th.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 }}>{step === 'otp' ? 'Enter the OTP' : 'Welcome back'}</Text>
            {step === 'otp' ? (
              <Text style={{ color: th.muted, fontSize: 15 }}>We sent a 6-digit OTP to <Text style={{ color: th.ink, fontWeight: '700' }}>{masked}</Text></Text>
            ) : (
              <Text style={{ color: th.muted, fontSize: 15 }}>Sign in to keep every branch on pulse.</Text>
            )}
          </View>

          <View style={[{ backgroundColor: th.surface, borderRadius: 20, padding: 20, gap: 16 }, th.dark ? { borderWidth: 1, borderColor: th.border } : { shadowColor: th.brand, shadowOpacity: 0.09, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3 }]}>
            {step === 'id' && (
              <>
                <View style={{ gap: 6 }}>
                  <Text style={{ color: th.muted, fontSize: 13, fontWeight: '600' }}>Mobile number</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: 12, borderWidth: 1.5, borderColor: identifier ? th.brand : th.border, backgroundColor: th.fieldBg, overflow: 'hidden' }}>
                    <View style={{ minWidth: 62, flexShrink: 0, paddingHorizontal: 12, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', backgroundColor: th.brandLight, borderRightWidth: 1, borderRightColor: th.border }}>
                      <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '800', fontSize: 16, flexShrink: 0 }}>+91</Text>
                    </View>
                    <TextInput
                      value={identifier} onChangeText={(v) => setIdentifier(v.replace(/\D/g, '').slice(0, 10))}
                      keyboardType="number-pad" maxLength={10} textContentType="telephoneNumber" autoComplete="tel" autoFocus
                      placeholder="10-digit number" placeholderTextColor={th.faint} onSubmitEditing={onIdentify} returnKeyType="next"
                      style={{ flex: 1, minWidth: 0, paddingHorizontal: 14, fontSize: 18, fontWeight: '600', letterSpacing: 1, color: th.ink, paddingVertical: 10 }}
                    />
                  </View>
                </View>
                <Button title={wait > 0 ? `Try again in ${wait}s` : 'Continue'} onPress={onIdentify} loading={busy} disabled={!isMobile || wait > 0} />
              </>
            )}

            {step === 'password' && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: th.brandLight, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}>
                  <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1 }}>{isMobile ? `+91 ${id}` : id}</Text>
                  <Pressable onPress={back} disabled={busy} hitSlop={8}><Text style={{ color: th.brand, fontWeight: '700' }}>Use a different number</Text></Pressable>
                </View>
                <View>
                  <Field
                    label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
                    textContentType="password" onSubmitEditing={onPassword} returnKeyType="go"
                  />
                  <Pressable onPress={() => setShow((x) => !x)} style={{ alignSelf: 'flex-end', paddingVertical: 8 }}>
                    <Text style={{ color: th.brand, fontWeight: '600' }}>{show ? 'Hide password' : 'Show password'}</Text>
                  </Pressable>
                </View>
                {method === 'PASSWORD_OTP' && <Muted small>An OTP will be sent to your mobile next.</Muted>}
                <Button title={wait > 0 && step === 'password' ? `Try again in ${wait}s` : method === 'PASSWORD_OTP' ? 'Send OTP' : 'Sign in'} onPress={onPassword} loading={busy} disabled={!password || (step === 'password' && wait > 0)} />
              </>
            )}

            {step === 'otp' && (
              <>
                <View style={{ gap: 8 }}>
                  <Text style={{ color: th.muted, fontSize: 13, fontWeight: '600' }}>OTP</Text>
                  <OtpInput value={otp} onChange={setOtp} />
                </View>
                <Button title="Verify and sign in" onPress={onOtp} loading={busy} disabled={otp.length !== 6} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Pressable onPress={back} disabled={busy} style={{ paddingVertical: 8 }}><Text style={{ color: th.brand, fontWeight: '600' }}>Use a different number</Text></Pressable>
                  <Pressable onPress={resend} disabled={busy || wait > 0} style={{ paddingVertical: 8, opacity: wait > 0 ? 0.5 : 1 }}>
                    <Text style={{ color: th.brand, fontWeight: '600' }}>{wait > 0 ? `Resend in ${wait}s` : 'Resend OTP'}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>

          {/* language: one pill showing the OTHER language (globe + its own name), like the web */}
          <Pressable
            onPress={() => setLang(lang === 'en' ? 'ta' : 'en')} accessibilityRole="button" accessibilityLabel={lang === 'en' ? 'தமிழ்' : 'English'}
            style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 20, borderRadius: 999, backgroundColor: th.brandLight, opacity: pressed ? 0.8 : 1 })}
          >
            <Feather name="globe" size={18} color={th.brand} />
            <PlainText style={{ color: th.brand, fontWeight: '700', fontSize: 16 }}>{lang === 'en' ? 'தமிழ்' : 'English'}</PlainText>
          </Pressable>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <Sheet open={!!error} onClose={() => setError(null)} title="Sign-in error">
        <ErrorBox error={error} />
        <Button title="OK" onPress={() => setError(null)} />
      </Sheet>
    </View>
  );
}
