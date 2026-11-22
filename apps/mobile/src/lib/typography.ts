import * as Font from 'expo-font';
import { useSyncExternalStore } from 'react';

/**
 * The typeface and text size a company chose (Super Admin, company form). Text.tsx applies them to every piece of text, so each
 * signed-in person of that company sees the same face and size. INTER = the phone's own font.
 */
type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';
type Files = Partial<Record<Weight, number>>;

const FAMILIES: Record<string, Files> = {
  POPPINS: {
    regular: require('@expo-google-fonts/poppins/400Regular/Poppins_400Regular.ttf'),
    medium: require('@expo-google-fonts/poppins/500Medium/Poppins_500Medium.ttf'),
    semibold: require('@expo-google-fonts/poppins/600SemiBold/Poppins_600SemiBold.ttf'),
    bold: require('@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf'),
    extrabold: require('@expo-google-fonts/poppins/800ExtraBold/Poppins_800ExtraBold.ttf'),
  },
  NUNITO: {
    regular: require('@expo-google-fonts/nunito/400Regular/Nunito_400Regular.ttf'),
    semibold: require('@expo-google-fonts/nunito/600SemiBold/Nunito_600SemiBold.ttf'),
    bold: require('@expo-google-fonts/nunito/700Bold/Nunito_700Bold.ttf'),
    extrabold: require('@expo-google-fonts/nunito/800ExtraBold/Nunito_800ExtraBold.ttf'),
  },
  ROBOTO: {
    regular: require('@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf'),
    medium: require('@expo-google-fonts/roboto/500Medium/Roboto_500Medium.ttf'),
    bold: require('@expo-google-fonts/roboto/700Bold/Roboto_700Bold.ttf'),
  },
  LORA: {
    regular: require('@expo-google-fonts/lora/400Regular/Lora_400Regular.ttf'),
    medium: require('@expo-google-fonts/lora/500Medium/Lora_500Medium.ttf'),
    semibold: require('@expo-google-fonts/lora/600SemiBold/Lora_600SemiBold.ttf'),
    bold: require('@expo-google-fonts/lora/700Bold/Lora_700Bold.ttf'),
  },
};
const SCALE: Record<string, number> = { SMALL: 0.9, MEDIUM: 1, LARGE: 1.12, XLARGE: 1.25 };
/** nearest available file when a family lacks a weight (Roboto has no semibold / extrabold ...) */
const ORDER: Weight[] = ['regular', 'medium', 'semibold', 'bold', 'extrabold'];

export interface Typography { scale: number; family: string | null; weights: Partial<Record<Weight, string>> }
let state: Typography = { scale: 1, family: null, weights: {} };
const listeners = new Set<() => void>();
const set = (next: Typography) => { state = next; listeners.forEach((l) => l()); };

/** Pick the company's typeface and size. The font files are loaded first; text switches over when they are ready. */
export async function setTypography(font?: string | null, size?: string | null) {
  const scale = SCALE[size ?? 'MEDIUM'] ?? 1;
  const files = font ? FAMILIES[font] : undefined;
  if (!files) { set({ scale, family: null, weights: {} }); return; }
  set({ ...state, scale }); // the size applies at once
  try {
    const map: Record<string, number> = {};
    for (const w of ORDER) if (files[w]) map[`${font}_${w}`] = files[w]!;
    await Font.loadAsync(map);
    const weights: Partial<Record<Weight, string>> = {};
    for (const w of ORDER) {
      // the closest weight the family has
      const have = ORDER.filter((x) => files[x]);
      const idx = ORDER.indexOf(w);
      const best = have.reduce((a, b) => (Math.abs(ORDER.indexOf(b) - idx) < Math.abs(ORDER.indexOf(a) - idx) ? b : a));
      weights[w] = `${font}_${best}`;
    }
    set({ scale, family: font!, weights });
  } catch {
    set({ scale, family: null, weights: {} }); // could not load: keep the phone's font
  }
}

export const weightOf = (w: unknown): Weight => {
  const n = w === 'bold' ? 700 : w === 'normal' || w == null ? 400 : Number(w);
  if (!Number.isFinite(n) || n < 450) return 'regular';
  if (n < 550) return 'medium';
  if (n < 650) return 'semibold';
  if (n < 750) return 'bold';
  return 'extrabold';
};

export function useTypography(): Typography {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}
