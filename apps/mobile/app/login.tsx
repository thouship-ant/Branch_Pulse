import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ErrorBox, Field, LanguageSwitch, Muted } from '@/components/ui';
import { ApiError } from '@/lib/api';
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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: th.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        {/* brand banner */}
        <View style={{ backgroundColor: th.brandDark === '#18236f' ? '#1e2a8a' : '#18236f', paddingTop: insets.top + 32, paddingBottom: 56, paddingHorizontal: 24, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Image source={require('../assets/logo.png')} accessibilityLabel="Branch Pulse" style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: '#fff' }} />
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>Branch Pulse</Text>
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }}>Every branch, every rupee, in one place.</Text>
        </View>

        <View style={{ marginTop: -28, paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
          <View style={{ backgroundColor: th.surface, borderRadius: 20, borderWidth: 1, borderColor: th.border, padding: 20, gap: 16 }}>
            <Text style={{ color: th.ink, fontSize: 22, fontWeight: '700' }}>Sign in</Text>

            {step === 'id' && (
              <>
                <Field
                  label="Mobile number or username" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false}
                  keyboardType="default" textContentType="username" onSubmitEditing={onIdentify} returnKeyType="next"
                />
                <ErrorBox error={error} />
                <Button title="Continue" onPress={onIdentify} loading={busy} disabled={!id} />
              </>
            )}

            {step === 'password' && (
              <>
                <Muted>Signing in as {id}</Muted>
                <View>
                  <Field
                    label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
                    textContentType="password" onSubmitEditing={onPassword} returnKeyType="go"
                  />
                  <Pressable onPress={() => setShow((s) => !s)} style={{ alignSelf: 'flex-end', paddingVertical: 8 }}>
                    <Text style={{ color: th.brand, fontWeight: '600' }}>{show ? 'Hide password' : 'Show password'}</Text>
                  </Pressable>
                </View>
                {method === 'PASSWORD_OTP' && <Muted small>An OTP will be sent to your mobile next.</Muted>}
                <ErrorBox error={error} />
                <Button title={method === 'PASSWORD_OTP' ? 'Send OTP' : 'Sign in'} onPress={onPassword} loading={busy} disabled={!password} />
                <Button title="Back" variant="secondary" onPress={back} disabled={busy} />
              </>
            )}

            {step === 'otp' && (
              <>
                <Muted>Enter the 6-digit OTP sent to {id}</Muted>
                <Field
                  label="OTP" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6}
                  textContentType="oneTimeCode" autoComplete="sms-otp" autoFocus onSubmitEditing={onOtp}
                  style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
                />
                <ErrorBox error={error} />
                <Button title="Verify and sign in" onPress={onOtp} loading={busy} disabled={otp.length !== 6} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Pressable onPress={back} disabled={busy} style={{ paddingVertical: 8 }}><Text style={{ color: th.brand, fontWeight: '600' }}>Change number</Text></Pressable>
                  <Pressable onPress={resend} disabled={busy || wait > 0} style={{ paddingVertical: 8, opacity: wait > 0 ? 0.5 : 1 }}>
                    <Text style={{ color: th.brand, fontWeight: '600' }}>{wait > 0 ? `Resend in ${wait}s` : 'Resend OTP'}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
          <View style={{ marginTop: 16 }}><LanguageSwitch /></View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
