import { Feather } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text as PlainText, View } from 'react-native';
import { Text } from '@/components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ErrorBox, Field, Muted } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useLang } from '@/lib/language';
import { useSession, type SignInMethod } from '@/lib/session';
import { useTheme } from '@/lib/theme';

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
  const th = useTheme();
  const insets = useSafeAreaInsets();
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
      setError(friendly(err));
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

  const masked = isMobile ? `${id.slice(0, 2)}******${id.slice(-2)}` : id;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#1e2a8a' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {/* brand banner (same look as the web sign-in): navy, soft glows, a faint pulse line */}
        <View style={{ backgroundColor: '#1e2a8a', overflow: 'hidden', minHeight: 300, paddingTop: insets.top + 28, paddingBottom: 64, paddingHorizontal: 24, justifyContent: 'space-between' }}>
          <View pointerEvents="none" style={{ position: 'absolute', left: -90, top: -90, width: 290, height: 290, borderRadius: 145, backgroundColor: 'rgba(255,255,255,0.10)' }} />
          <View pointerEvents="none" style={{ position: 'absolute', right: -110, bottom: -150, width: 360, height: 360, borderRadius: 180, backgroundColor: 'rgba(165,180,252,0.20)' }} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 40, height: 56, opacity: 0.16, flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ flex: 0.26, height: 3, backgroundColor: '#fff', borderRadius: 2 }} />
            <View style={{ width: 3, height: 54, backgroundColor: '#fff', borderRadius: 2, transform: [{ rotate: '14deg' }] }} />
            <View style={{ width: 3, height: 44, backgroundColor: '#fff', borderRadius: 2, marginLeft: 10, transform: [{ rotate: '-16deg' }] }} />
            <View style={{ flex: 1, height: 3, backgroundColor: '#fff', borderRadius: 2 }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Image source={require('../assets/logo.png')} accessibilityLabel="Branch Pulse" style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff' }} />
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.4 }}>Branch Pulse</Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6, maxWidth: 300 }}>Every branch. One pulse.</Text>
        </View>

        {/* the sign-in sheet overlaps the banner */}
        <View style={{ flex: 1, marginTop: -32, backgroundColor: th.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 32, paddingBottom: insets.bottom + 28, gap: 22 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ color: th.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 }}>{step === 'otp' ? 'Enter the OTP' : 'Welcome back'}</Text>
            {step === 'otp' ? (
              <Text style={{ color: th.muted, fontSize: 15 }}>We sent a 6-digit OTP to <Text style={{ color: th.ink, fontWeight: '700' }}>{masked}</Text></Text>
            ) : (
              <Text style={{ color: th.muted, fontSize: 15 }}>Sign in to keep every branch on pulse.</Text>
            )}
          </View>

          <View style={[{ backgroundColor: th.surface, borderRadius: 20, padding: 20, gap: 16 }, th.dark ? { borderWidth: 1, borderColor: th.border } : { shadowColor: '#1e2a8a', shadowOpacity: 0.09, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3 }]}>
            {step === 'id' && (
              <>
                <Field
                  label="Mobile number" value={identifier} onChangeText={(v) => setIdentifier(v.replace(/\s/g, ''))} autoCapitalize="none" autoCorrect={false}
                  keyboardType="default" textContentType="username" onSubmitEditing={onIdentify} returnKeyType="next"
                />
                <ErrorBox error={error} />
                <Button title="Continue" onPress={onIdentify} loading={busy} disabled={!id} />
              </>
            )}

            {step === 'password' && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: th.brandLight, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}>
                  <Text numberOfLines={1} style={{ color: th.ink, fontWeight: '700', fontVariant: ['tabular-nums'], flexShrink: 1 }}>{id}</Text>
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
                <ErrorBox error={error} />
                <Button title={method === 'PASSWORD_OTP' ? 'Send OTP' : 'Sign in'} onPress={onPassword} loading={busy} disabled={!password} />
              </>
            )}

            {step === 'otp' && (
              <>
                <Field
                  label="OTP" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6}
                  textContentType="oneTimeCode" autoComplete="sms-otp" autoFocus onSubmitEditing={onOtp}
                  style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
                />
                <ErrorBox error={error} />
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
  );
}
