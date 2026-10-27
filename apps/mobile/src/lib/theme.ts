import { useColorScheme } from 'react-native';

/** Same tokens as the web app's globals.css (deep navy brand, slate neutrals), resolved for light and dark. */
type Tone = { bg: string; border: string; text: string };
export interface Theme {
  dark: boolean;
  bg: string; surface: string; ink: string; muted: string; faint: string; border: string; fieldBg: string;
  brand: string; brandDark: string; brandLight: string; onBrand: string;
  ok: Tone; warn: Tone; bad: Tone; violet: Tone; sky: Tone; neutral: Tone;
  series: string[];
}

const light: Theme = {
  dark: false,
  bg: '#f2f4f8', surface: '#ffffff', ink: '#182236', muted: '#475569', faint: '#94a3b8', border: '#e2e7f0', fieldBg: '#ffffff',
  brand: '#1e2a8a', brandDark: '#18236f', brandLight: '#eef1ff', onBrand: '#ffffff',
  ok: { bg: '#ecfdf5', border: '#6ee7b7', text: '#065f46' },
  warn: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
  bad: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
  violet: { bg: '#f5f3ff', border: '#c4b5fd', text: '#5b21b6' },
  sky: { bg: '#f0f9ff', border: '#7dd3fc', text: '#0c4a6e' },
  neutral: { bg: '#edf0f6', border: '#cbd5e1', text: '#334155' },
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
};

const dark: Theme = {
  dark: true,
  bg: '#0f1729', surface: '#172033', ink: '#e2e8f0', muted: '#b4c0d4', faint: '#7d8aa5', border: '#263248', fieldBg: '#1c2740',
  brand: '#4a5bd8', brandDark: '#8b97f0', brandLight: '#1a2747', onBrand: '#ffffff',
  ok: { bg: '#062e24', border: '#047857', text: '#6ee7b7' },
  warn: { bg: '#422c08', border: '#92400e', text: '#fcd34d' },
  bad: { bg: '#450a0a', border: '#991b1b', text: '#fca5a5' },
  violet: { bg: '#2e1065', border: '#6d28d9', text: '#c4b5fd' },
  sky: { bg: '#082f49', border: '#0369a1', text: '#bae6fd' },
  neutral: { bg: '#1c2740', border: '#334155', text: '#cbd5e1' },
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'],
};

export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

export const RADIUS = 16;
export const TOUCH = 48; // >= 48 px touch targets, as on the web
