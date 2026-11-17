import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';

/** Shared app-wide palette tokens with selectable brand colors and light/dark variants. */
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

const teaShopLight: Theme = {
  ...light,
  bg: '#f5f0e7', surface: '#fffdf8', ink: '#2f251c', muted: '#65584b', faint: '#988a7a', border: '#e6d8cc', fieldBg: '#fffefa',
  brand: '#386641', brandDark: '#2c5034', brandLight: '#e7f0e4', onBrand: '#ffffff',
  series: ['#386641', '#d28c45', '#b85c38', '#8a6f45', '#71917a', '#d6ad45'],
};

const teaShopDark: Theme = {
  ...dark,
  bg: '#161b14', surface: '#20271d', ink: '#f3ebdd', muted: '#ccbeaa', faint: '#a1957f', border: '#3a4435', fieldBg: '#272f23',
  brand: '#8fbf78', brandDark: '#a8d294', brandLight: '#2b3d2b', onBrand: '#172015',
  series: ['#8fbf78', '#e0ad63', '#dc8060', '#bca477', '#91b89a', '#e5c777'],
};

const redLight: Theme = {
  ...light,
  bg: '#f8f1f2', surface: '#fffdfd', ink: '#302124', muted: '#6f555a', faint: '#9b8085', border: '#ead9dc', fieldBg: '#fffdfd',
  brand: '#7a1e2c', brandDark: '#5c1621', brandLight: '#f3e4e7', onBrand: '#ffffff',
  series: ['#7a1e2c', '#d28c45', '#527d59', '#8a6f45', '#b85c63', '#d6ad45'],
};

const redDark: Theme = {
  ...dark,
  bg: '#1d1417', surface: '#281b1f', ink: '#f6e8ea', muted: '#d4b8bd', faint: '#ab8b90', border: '#493037', fieldBg: '#312127',
  brand: '#d17a8a', brandDark: '#f2a5b1', brandLight: '#46262d', onBrand: '#2c1017',
  series: ['#d17a8a', '#e0ad63', '#91b89a', '#bca477', '#dc8060', '#e5c777'],
};

/** The appearance the person chose: light, dark, or follow the phone. Remembered on the phone. */
export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeColor = 'red' | 'green' | 'blue';
const MODE_KEY = 'bp.themeMode';
const COLOR_KEY = 'bp.themeColor';

// a tiny shared store, so every screen redraws when the choice changes (works on phone and web alike)
type BusinessType = 'TEA_SHOP' | 'OTHER';
interface ThemeState { mode: ThemeMode; businessType: BusinessType; color: ThemeColor | null }
let current: ThemeState = { mode: 'system', businessType: 'OTHER', color: null };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const setCurrent = (m: ThemeMode) => { if (current.mode !== m) { current = { ...current, mode: m }; notify(); } };
export const setBusinessType = (type: string | null | undefined) => {
  const businessType: BusinessType = type === 'TEA_SHOP' ? 'TEA_SHOP' : 'OTHER';
  if (current.businessType !== businessType) { current = { ...current, businessType }; notify(); }
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getState = () => current;
const getMode = () => current.mode;
const defaultColor = () => current.businessType === 'TEA_SHOP' ? 'green' : 'blue';

export function useTheme(): Theme {
  const system = useColorScheme();
  const state = useSyncExternalStore(subscribe, getState, getState);
  const isDark = (state.mode === 'system' ? system === 'dark' : state.mode === 'dark');
  const color = state.color ?? defaultColor();
  if (color === 'red') return isDark ? redDark : redLight;
  if (color === 'green') return isDark ? teaShopDark : teaShopLight;
  return isDark ? dark : light;
}

export function useThemeColor(): [ThemeColor, (color: ThemeColor) => void] {
  const state = useSyncExternalStore(subscribe, getState, getState);
  const color = state.color ?? defaultColor();
  return [color, (value) => { void setThemeColor(value); }];
}

export async function loadThemeMode(): Promise<ThemeMode> {
  try { const v = await SecureStore.getItemAsync(MODE_KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}
async function loadThemeColor(): Promise<ThemeColor | null> {
  try {
    const value = await SecureStore.getItemAsync(COLOR_KEY);
    return value === 'red' || value === 'green' || value === 'blue' ? value : null;
  } catch { return null; }
}
/** Call once at start-up: restores the saved appearance and brand color. */
export async function applySavedThemeMode() {
  const [mode, color] = await Promise.all([loadThemeMode(), loadThemeColor()]);
  current = { ...current, mode, color };
  notify();
}

export async function setThemeMode(m: ThemeMode) {
  setCurrent(m);
  try { await SecureStore.setItemAsync(MODE_KEY, m); } catch { /* storage unavailable */ }
}

export async function setThemeColor(color: ThemeColor) {
  if (current.color !== color) { current = { ...current, color }; notify(); }
  try { await SecureStore.setItemAsync(COLOR_KEY, color); } catch { /* storage unavailable */ }
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const mode = useSyncExternalStore(subscribe, getMode, getMode);
  return [mode, (m) => { void setThemeMode(m); }];
}

export const RADIUS = 16;
export const TOUCH = 48; // >= 48 px touch targets, as on the web
