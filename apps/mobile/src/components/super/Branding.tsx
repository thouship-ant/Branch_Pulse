import { Feather } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { Text } from '@/components/Text';
import { API_ORIGIN } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { Button, Chips } from '../ui';

/** The typefaces and text sizes a company can choose (same ids as the web form and the server). */
export const FONT_CHOICES = [
  { value: 'INTER', label: 'Inter' }, { value: 'POPPINS', label: 'Poppins' }, { value: 'NUNITO', label: 'Nunito' },
  { value: 'ROBOTO', label: 'Roboto' }, { value: 'LORA', label: 'Lora' },
];
export const SIZE_CHOICES = [{ value: 'SMALL', label: 'S' }, { value: 'MEDIUM', label: 'M' }, { value: 'LARGE', label: 'L' }, { value: 'XLARGE', label: 'XL' }];

/** A frame address from the server is relative (/api/v1/branding/...); a picture just picked is already a data URL. */
export const pictureUri = (v: string | null | undefined) => (v ? (v.startsWith('data:') ? v : `${API_ORIGIN}${v}`) : '');

/** Pick a picture and shrink it until it fits the server's limit (logo: PNG under 80 KB, frame: JPEG under ~400 KB). */
async function pick(kind: 'logo' | 'frame'): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Allow photo access in Settings to choose a picture');
  const result = await ImagePicker.launchImageLibraryAsync(kind === 'logo'
    ? { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 }
    : { mediaTypes: ['images'], allowsEditing: true, aspect: [2, 3], quality: 1 });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;
  if (kind === 'logo') {
    // PNG keeps a transparent background; shrink until it fits
    for (const side of [256, 192, 144, 112]) {
      const out = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: side } }], { format: ImageManipulator.SaveFormat.PNG, base64: true });
      const url = `data:image/png;base64,${out.base64 ?? ''}`;
      if (out.base64 && url.length <= 78_000) return url;
    }
    throw new Error('That logo is too detailed to shrink under 80 KB. Try a simpler one.');
  }
  for (const [width, compress] of [[768, 0.75], [768, 0.6], [640, 0.6], [512, 0.55]] as const) {
    const out = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width } }], { format: ImageManipulator.SaveFormat.JPEG, compress, base64: true });
    const url = `data:image/jpeg;base64,${out.base64 ?? ''}`;
    if (out.base64 && url.length <= 520_000) return url;
  }
  throw new Error('That picture is too detailed to shrink under 400 KB.');
}

/**
 * Change one picture of the company (opened from the pencil on the banner). For the frame, `value` null means "unchanged" and ''
 * means "back to the default"; the logo is just its data URL ('' = none).
 */
export function PictureEditor({ kind, value, onChange, onDone }: { kind: 'logo' | 'frame'; value: string; onChange: (v: string) => void; onDone: () => void }) {
  const th = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logo = kind === 'logo';

  async function choose() {
    setBusy(true); setError(null);
    try { const url = await pick(kind); if (url) onChange(url); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not choose the picture'); }
    finally { setBusy(false); }
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: th.border, backgroundColor: th.surface }}>
        <View style={{ width: logo ? 84 : 72, height: logo ? 84 : 108, borderRadius: logo ? 42 : 12, overflow: 'hidden', borderWidth: 1, borderColor: th.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
          {value
            ? <Image source={{ uri: pictureUri(value) }} resizeMode={logo ? 'contain' : 'cover'} style={{ width: '100%', height: '100%' }} />
            : <Text style={{ color: th.faint, fontSize: 12 }}>Default</Text>}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={{ color: th.ink, fontWeight: '700' }}>{logo ? 'Business logo' : 'Application frame'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button small variant="secondary" title={value ? 'Replace' : 'Upload'} loading={busy} onPress={() => void choose()} />
            {value ? <Button small variant="secondary" title="Remove" onPress={() => onChange('')} /> : null}
          </View>
        </View>
      </View>
      <Text style={{ color: th.muted, fontSize: 12.5, lineHeight: 18 }}>
        {logo
          ? 'PNG or JPEG. A transparent PNG keeps its transparent background. Shown in the app header, on the cup and in the browser tab.'
          : "The app's background: a tall picture (2:3) with the header band and an empty cup at the top. Your logo is placed on the cup. Without one the standard theme is used."}
      </Text>
      {error ? <Text accessibilityRole="alert" style={{ color: th.bad.text, fontSize: 13 }}>{error}</Text> : null}
      <Button title="Done" onPress={onDone} />
    </View>
  );
}

/** Typeface and text size of the company's app. */
export function FontFields({ font, fontSize, onFont, onSize }: { font: string; fontSize: string; onFont: (v: string) => void; onSize: (v: string) => void }) {
  return (
    <View style={{ gap: 12 }}>
      <Chips label="Font style" value={font} onChange={onFont} options={FONT_CHOICES} />
      <Chips label="Font size" value={fontSize} onChange={onSize} options={SIZE_CHOICES} />
    </View>
  );
}
