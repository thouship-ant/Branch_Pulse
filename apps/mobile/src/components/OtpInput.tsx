import { useRef, useState } from 'react';
import { TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';
import { useTheme } from '@/lib/theme';

/** Six separate digit boxes: typing moves on, backspace moves back, and a pasted or auto-filled code spreads across the boxes. */
export function OtpInput({ value, onChange, onComplete, length = 6 }: { value: string; onChange: (v: string) => void; onComplete?: () => void; length?: number }) {
  const th = useTheme();
  const refs = useRef<Array<TextInput | null>>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const change = (text: string, i: number) => {
    const clean = text.replace(/\D/g, '');
    if (!clean && text !== '') return;
    if (clean.length > 1) { // paste / SMS auto-fill
      const next = (value.slice(0, i) + clean).slice(0, length);
      onChange(next);
      refs.current[Math.min(next.length, length - 1)]?.focus();
      if (next.length === length) onComplete?.();
      return;
    }
    const arr = [...digits];
    arr[i] = clean;
    const next = arr.join('');
    onChange(next);
    if (clean && i < length - 1) refs.current[i + 1]?.focus();
    if (clean && next.length === length) onComplete?.();
  };
  const key = (e: NativeSyntheticEvent<TextInputKeyPressEventData>, i: number) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    const arr = [...digits];
    if (!arr[i] && i > 0) { arr[i - 1] = ''; onChange(arr.join('')); refs.current[i - 1]?.focus(); }
    else if (arr[i]) { arr[i] = ''; onChange(arr.join('')); }
  };

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      {digits.map((d, i) => {
        const on = focus === i;
        return (
          <TextInput
            key={i} ref={(r) => { refs.current[i] = r; }}
            value={d} onChangeText={(t) => change(t, i)} onKeyPress={(e) => key(e, i)}
            onFocus={() => setFocus(i)} onBlur={() => setFocus(null)}
            keyboardType="number-pad" maxLength={i === 0 ? length : 1} selectTextOnFocus autoFocus={i === 0}
            textContentType={i === 0 ? 'oneTimeCode' : 'none'} autoComplete={i === 0 ? 'sms-otp' : 'off'}
            accessibilityLabel={`OTP digit ${i + 1}`}
            style={{
              flex: 1, minWidth: 0, maxWidth: 52, height: 56, borderRadius: 12, borderWidth: on ? 2 : 1.5, textAlign: 'center', padding: 0, fontSize: 22, fontWeight: '700',
              color: th.ink, borderColor: on ? th.brand : d ? th.faint : th.border, backgroundColor: on ? th.surface : th.fieldBg,
            }}
          />
        );
      })}
    </View>
  );
}
