import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Text } from './Text';
import { api, ApiError } from '@/lib/api';
import { passwordOk } from '@/lib/password';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { PasswordChecklist } from './PasswordChecklist';
import { Banner, Button, ErrorBox, Field, Muted } from './ui';

/**
 * Shown right after sign-in while the account still has the default / temporary password. Submit saves the new
 * password; Cancel hides the prompt until the app is opened again.
 */
export function ChangePasswordModal() {
  const th = useTheme();
  const { me, passwordChanged } = useSession();
  const [later, setLater] = useState(false);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { setLater(false); setPw(''); setConfirm(''); setError(null); }, [me?.id]);

  const open = !!me && ((me.mustChangePassword && !later) || done);
  if (!open) return null;
  const ready = passwordOk(pw) && pw === confirm;

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.post('/auth/change-password', { newPassword: pw, confirmPassword: confirm });
      setDone(true);
      passwordChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the password');
    } finally { setBusy(false); }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => (done ? setDone(false) : setLater(true))}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: th.surface, borderRadius: 20, padding: 20, gap: 14, borderWidth: 1, borderColor: th.border }}>
          <Text style={{ color: th.ink, fontSize: 20, fontWeight: '700' }}>{done ? 'Password changed' : 'Change your password'}</Text>
          {done ? (
            <>
              <Banner tone="ok">✓ Your new password is saved.</Banner>
              <Button title="Done" onPress={() => setDone(false)} />
            </>
          ) : (
            <>
              <Muted>You are using a default password. Choose your own to keep your account safe.</Muted>
              <Field label="New Password" value={pw} onChangeText={setPw} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} textContentType="newPassword" />
              <PasswordChecklist value={pw} />
              <Field
                label="Confirm Password" value={confirm} onChangeText={setConfirm} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false}
                error={confirm.length > 0 && pw !== confirm ? 'Passwords do not match' : null}
              />
              <Pressable onPress={() => setShow((s) => !s)} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
                <Text style={{ color: th.brand, fontWeight: '600' }}>{show ? 'Hide passwords' : 'Show passwords'}</Text>
              </Pressable>
              <ErrorBox error={error} />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setLater(true)} disabled={busy} />
                <Button title="Submit" style={{ flex: 1 }} onPress={submit} loading={busy} disabled={!ready} />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
