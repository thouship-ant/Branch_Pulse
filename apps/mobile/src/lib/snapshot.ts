import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * Last-known screen data, so a page can show what it showed before while the fresh data loads. Kept in memory (instant when
 * you come back to a tab) and on disk (so it is also there right after the app is opened). Best effort: any failure just
 * means no snapshot.
 */
const memory = new Map<string, unknown>();
const web = Platform.OS === 'web';
const file = (key: string) => `${FileSystem.documentDirectory}snap-${key.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;

export const peekSnapshot = <T,>(key: string): T | null => (memory.get(key) as T | undefined) ?? null;

export async function loadSnapshot<T>(key: string): Promise<T | null> {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = web ? (typeof localStorage === 'undefined' ? null : localStorage.getItem(`snap-${key}`)) : await FileSystem.readAsStringAsync(file(key));
    if (!raw) return null;
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function saveSnapshot(key: string, value: unknown): void {
  memory.set(key, value);
  const raw = JSON.stringify(value);
  if (web) { try { localStorage.setItem(`snap-${key}`, raw); } catch { /* full */ } return; }
  void FileSystem.writeAsStringAsync(file(key), raw).catch(() => undefined);
}
