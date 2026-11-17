import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { deleteItemAsync, getItemAsync, setItemAsync } from './storage';

/**
 * The person's profile photo. It is kept on this device only (a small square JPEG), per user: the phone keeps a file, the web keeps
 * the picture in the browser. Nothing is uploaded to the server.
 */
const web = Platform.OS === 'web';
const webKey = (id: string) => `bp_avatar_${id}`;
const filePath = (id: string) => `${FileSystem.documentDirectory}avatar-${id}.jpg`;

async function load(id: string): Promise<string | null> {
  try {
    if (web) return await getItemAsync(webKey(id));
    const info = await FileSystem.getInfoAsync(filePath(id));
    return info.exists ? `${info.uri}?t=${'modificationTime' in info ? info.modificationTime : Date.now()}` : null;
  } catch { return null; }
}

/** Opens the gallery (or camera), squares the picture to 320 px and keeps it. Returns the new picture, or null if cancelled. */
async function choose(id: string, source: 'library' | 'camera'): Promise<string | null> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(source === 'camera' ? 'Allow camera access in Settings to take a photo' : 'Allow photo access in Settings to choose a photo');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  // crop to a centred square first (the web picker ignores the crop box), then shrink
  const side = Math.min(a.width, a.height);
  const out = await ImageManipulator.manipulateAsync(
    a.uri,
    [{ crop: { originX: Math.floor((a.width - side) / 2), originY: Math.floor((a.height - side) / 2), width: side, height: side } }, { resize: { width: 320, height: 320 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: web },
  );
  if (web) await setItemAsync(webKey(id), `data:image/jpeg;base64,${out.base64}`);
  else {
    await FileSystem.deleteAsync(filePath(id), { idempotent: true });
    await FileSystem.copyAsync({ from: out.uri, to: filePath(id) });
  }
  return load(id);
}

async function clear(id: string) {
  try {
    if (web) await deleteItemAsync(webKey(id));
    else await FileSystem.deleteAsync(filePath(id), { idempotent: true });
  } catch { /* nothing to remove */ }
}

/** The signed-in person's photo (null until one is chosen) plus the actions to change or remove it. */
export function useAvatar(userId?: string) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => { setUri(null); if (userId) void load(userId).then(setUri); }, [userId]);
  const pick = useCallback(async (source: 'library' | 'camera') => {
    if (!userId) return;
    const next = await choose(userId, source);
    if (next) setUri(next);
  }, [userId]);
  const remove = useCallback(async () => { if (userId) { await clear(userId); setUri(null); } }, [userId]);
  return { uri, pick, remove };
}
