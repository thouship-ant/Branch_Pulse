import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export interface Photo { uri: string; name: string }

/** Take a photo (or pick one from the gallery), shrunk to ~1280 px JPEG so uploads stay small on mobile data. */
export async function pickPhoto(source: 'camera' | 'library' = 'camera'): Promise<Photo | null> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(source === 'camera' ? 'Allow camera access in Settings to attach a photo' : 'Allow photo access in Settings to attach a photo');
  const res = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const out = await ImageManipulator.manipulateAsync(a.uri, a.width > 1280 ? [{ resize: { width: 1280 } }] : [], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: out.uri, name: `photo-${Date.now()}.jpg` };
}
