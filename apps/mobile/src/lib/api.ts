import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { uuid } from './dates';

/** API origin: EXPO_PUBLIC_API_URL, else production. (Android emulators reach the host PC at 10.0.2.2.) */
export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL || 'https://api-branchpulse.antstockpulse.pro').replace(/\/$/, '');
const BASE = `${API_ORIGIN}/api/v1`;

export interface Warning { code: string; message: string; field?: string }
export interface Envelope<T> { data: T; warnings?: Warning[]; meta?: Record<string, any> }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
  get isNetwork() { return this.status === 0; }
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onAuthLost: (() => void) | null = null;
export const setAuthLostHandler = (fn: (() => void) | null) => { onAuthLost = fn; };

const REFRESH_KEY = 'bp_refresh_token';
const DEVICE_KEY = 'bp_device_id';

export async function loadStoredRefresh() {
  try { refreshToken = await SecureStore.getItemAsync(REFRESH_KEY); } catch { refreshToken = null; }
  return refreshToken;
}
async function storeRefresh(t: string | null) {
  refreshToken = t;
  try { t ? await SecureStore.setItemAsync(REFRESH_KEY, t) : await SecureStore.deleteItemAsync(REFRESH_KEY); } catch { /* secure store unavailable */ }
}

let device: string | null = null;
async function deviceId(): Promise<string> {
  if (device) return device;
  try {
    let id = await SecureStore.getItemAsync(DEVICE_KEY);
    if (!id) { id = `app-${uuid().slice(0, 8)}`; await SecureStore.setItemAsync(DEVICE_KEY, id); }
    device = id;
  } catch { device = 'app-unknown'; }
  return device;
}

export const clientInfo = () => ({ client: 'mobile' as const, deviceLabel: `${Platform.OS} ${Constants.expoConfig?.version ?? ''}`.trim() });

/** Start a session from a sign-in / refresh response: the access token stays in memory, the refresh token goes in the keystore. */
export async function startSession(res: { accessToken: string; refreshToken?: string }) {
  accessToken = res.accessToken;
  if (res.refreshToken) await storeRefresh(res.refreshToken);
}
export async function endSession() { accessToken = null; await storeRefresh(null); }

let refreshing: Promise<any | false> | null = null;
/** Trade the stored refresh token for a new access token (single-flight: the token rotates on every use). */
export function refreshSession(): Promise<any | false> {
  if (!refreshing) {
    refreshing = (async () => {
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client': 'native', 'X-Device-Id': await deviceId() },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) { if (res.status === 401 || res.status === 403) await storeRefresh(null); return false; }
        const body = (await res.json()).data;
        await startSession(body);
        return body;
      } catch {
        return false;
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

interface Options { body?: unknown; raw?: boolean }

async function request(method: string, path: string, opts: Options = {}, retried = false): Promise<any> {
  const headers: Record<string, string> = { 'X-Client': 'native', 'X-Device-Id': await deviceId() };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData; // fetch sets the multipart boundary itself
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body) });
  } catch (e) {
    // the address is part of the message so a wrong EXPO_PUBLIC_API_URL (or a phone that cannot see the PC) is obvious
    throw new ApiError(0, 'NETWORK', `Cannot reach the server at ${API_ORIGIN}. Check your connection (${e instanceof Error ? e.message : 'network error'}).`);
  }

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request(method, path, opts, true);
    accessToken = null;
    onAuthLost?.();
  }

  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch {
    throw new ApiError(res.status || 0, res.ok ? 'BAD_RESPONSE' : 'SERVER_ERROR', 'The server sent back an unexpected response. Please try again.');
  }
  if (!res.ok) {
    const e = json.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? res.statusText, e.details);
  }
  return opts.raw ? json : json.data;
}

export const api = {
  get: <T = any>(path: string): Promise<T> => request('GET', path),
  post: <T = any>(path: string, body?: unknown): Promise<T> => request('POST', path, { body: body ?? {} }),
  put: <T = any>(path: string, body?: unknown): Promise<T> => request('PUT', path, { body }),
  patch: <T = any>(path: string, body?: unknown): Promise<T> => request('PATCH', path, { body }),
  /** multipart/form-data upload (a file plus fields) */
  postForm: <T = any>(path: string, form: FormData): Promise<T> => request('POST', path, { body: form }),
  /** Same as get but returns { data, warnings, meta }. */
  full: {
    get: <T = any>(path: string): Promise<Envelope<T>> => request('GET', path, { raw: true }),
    put: <T = any>(path: string, body: unknown): Promise<Envelope<T>> => request('PUT', path, { body, raw: true }),
    post: <T = any>(path: string, body: unknown): Promise<Envelope<T>> => request('POST', path, { body, raw: true }),
  },
};

/** Upload a photo to the slot the API hands out and return the storage key to attach to a record. */
export async function uploadAttachment(uri: string, fileName: string, locationId: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const presign = await api.post<{ key: string; uploadUrl: string; headers: Record<string, string> }>('/attachments/presign', {
    fileName, mimeType: blob.type || 'image/jpeg', sizeBytes: blob.size, locationId,
  });
  const url = presign.uploadUrl.startsWith('/') ? `${API_ORIGIN}${presign.uploadUrl}` : presign.uploadUrl; // local storage hands out a relative path
  let res: Response;
  try {
    res = await fetch(url, { method: 'PUT', headers: presign.headers, body: blob });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No internet connection');
  }
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'Photo upload failed');
  return presign.key;
}

export const errMessage = (e: unknown, fallback = 'Something went wrong') => (e instanceof Error ? e.message : fallback);

/** Server field errors ([{field,message}]) -> { field: message } so each shows under its own box. */
export const fieldErrors = (e: unknown): Record<string, string> =>
  e instanceof ApiError && Array.isArray(e.details) ? Object.fromEntries(e.details.filter((d: any) => d?.field).map((d: any) => [d.field, d.message])) : {};

/** Download a file the API serves behind the bearer token (a plain link could not send it) and hand it to the share sheet. */
export async function downloadAndShare(path: string, fileName: string, mimeType: string): Promise<void> {
  const headers: Record<string, string> = { 'X-Client': 'native', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
  if (Platform.OS === 'web') {
    const res = await fetch(`${BASE}${path}`, { headers });
    if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Could not download the file');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const target = `${FileSystem.cacheDirectory}${fileName}`;
  const res = await FileSystem.downloadAsync(`${BASE}${path}`, target, { headers });
  if (res.status !== 200) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Could not download the file');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(res.uri, { mimeType, dialogTitle: fileName });
}
