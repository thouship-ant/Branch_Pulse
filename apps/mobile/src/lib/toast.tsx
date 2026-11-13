import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/Text';

interface ToastData { id: number; text: string; action?: { label: string; onPress: () => void }; ms: number }
let listeners: Array<(t: ToastData | null) => void> = [];
let seq = 0;

/** A short message at the bottom of the screen, optionally with one action (such as Undo). */
export function showToast(text: string, action?: ToastData['action'], ms = 5000) {
  const t: ToastData = { id: ++seq, text, action, ms };
  listeners.forEach((l) => l(t));
}
export const hideToast = () => listeners.forEach((l) => l(null));

/** Mounted once at the app root. */
export function ToastHost() {
  const [toast, setToast] = useState<ToastData | null>(null);
  useEffect(() => {
    listeners.push(setToast);
    return () => { listeners = listeners.filter((l) => l !== setToast); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.ms);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 96, zIndex: 100, elevation: 30 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#064e3b', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text numberOfLines={2} style={{ color: '#fff', flex: 1, fontSize: 14 }}>{toast.text}</Text>
        {toast.action ? (
          <Pressable hitSlop={10} onPress={() => { toast.action!.onPress(); setToast(null); }}>
            <Text style={{ color: '#fde68a', fontWeight: '800', fontSize: 14 }}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
