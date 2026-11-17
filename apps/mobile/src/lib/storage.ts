import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Same calls as expo-secure-store. The keystore only exists on the phone; on the web it throws, which used to make every page
 * refresh forget the sign-in. On the web the browser's localStorage is used instead.
 */
const web = Platform.OS === 'web';
const ls = () => (typeof localStorage === 'undefined' ? null : localStorage);

export const getItemAsync = async (key: string): Promise<string | null> => (web ? ls()?.getItem(key) ?? null : SecureStore.getItemAsync(key));
export const setItemAsync = async (key: string, value: string): Promise<void> => { if (web) ls()?.setItem(key, value); else await SecureStore.setItemAsync(key, value); };
export const deleteItemAsync = async (key: string): Promise<void> => { if (web) ls()?.removeItem(key); else await SecureStore.deleteItemAsync(key); };
