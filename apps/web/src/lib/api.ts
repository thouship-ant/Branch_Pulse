/** Thin fetch wrapper for the Branch Pulse API (same-origin via Next rewrites). */

export interface Warning { code: string; message: string; field?: string }
export interface Envelope<T> { data: T; warnings?: Warning[]; meta?: Record<string, any> }

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
    public requestId?: string,
  ) {
    super(message);
  }
  /** True when the browser could not reach the server at all. */
  get isNetwork() { return this.status === 0; }
}

let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;

export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const setAuthLostHandler = (fn: (() => void) | null) => { onAuthLost = fn; };

// how many requests are in flight right now, for a global "the app is talking to the server" indicator
let pending = 0;
const pendingListeners = new Set<() => void>();
const notifyPending = () => pendingListeners.forEach((fn) => fn());
export const subscribePending = (fn: () => void) => { pendingListeners.add(fn); return () => { pendingListeners.delete(fn); }; };
export const getPending = () => pending;

// crypto.randomUUID() is only defined in a secure context (HTTPS, or the literal host "localhost") -
// a phone hitting the dev server over http://<lan-ip>:3300 has `crypto` but not this method, so it throws
// "is not a function" rather than being undefined. Fall back to a Math.random-based v4 for that case;
// these ids are only used for local idempotency keys, not for anything security-sensitive.
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('bp_device_id');
    if (!id) {
      id = `pwa-${uuid().slice(0, 8)}`;
      localStorage.setItem('bp_device_id', id);
    }
    return id;
  } catch {
    return 'pwa-unknown';
  }
}

let refreshing: Promise<boolean> | null = null;

/** Refresh the access token from the HttpOnly cookie. Single-flight so rotation never races itself. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    const run = async () => {
      try {
        const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' });
        if (!res.ok) return false;
        const body = await res.json();
        accessToken = body.data.accessToken;
        return body.data;
      } catch {
        return false;
      }
    };
    // Web Locks serialise refreshes across tabs (the cookie is shared and rotates on every use)
    const locked: Promise<any> = (navigator as any).locks
      ? (navigator as any).locks.request('bp-refresh', run)
      : run();
    refreshing = locked.finally(() => { refreshing = null; });
  }
  return refreshing as Promise<any>;
}

interface Options extends Omit<RequestInit, 'body'> {
  body?: unknown;
  idempotencyKey?: string;
  raw?: boolean; // return the whole envelope
}

async function request<T>(method: string, path: string, opts: Options = {}, retried = false): Promise<any> {
  // counted once per user-facing call, not per retry: the 401-refresh-and-replay below stays invisible to it
  if (!retried) { pending++; notifyPending(); }
  try {
    const headers: Record<string, string> = { 'X-Device-Id': deviceId(), ...(opts.headers as Record<string, string>) };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    let res: Response;
    try {
      res = await fetch(`/api/v1${path}`, {
        method,
        headers,
        credentials: 'same-origin',
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'No internet connection');
    }

    if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
      const ok = await refreshSession();
      if (ok) return await request<T>(method, path, opts, true);
      accessToken = null;
      onAuthLost?.();
    }

    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // a proxy/server hiccup (e.g. mid-restart) can hand back a plain-text error page instead of JSON;
      // surface something the user can act on rather than the raw parser error
      throw new ApiError(res.status || 0, res.ok ? 'BAD_RESPONSE' : 'SERVER_ERROR', 'The server sent back an unexpected response. Please try again.');
    }
    if (!res.ok) {
      const e = json.error ?? {};
      throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? res.statusText, e.details, json.requestId);
    }
    return opts.raw ? json : json.data;
  } finally {
    if (!retried) { pending--; notifyPending(); }
  }
}

export const api = {
  get: <T = any>(path: string, o?: Options): Promise<T> => request('GET', path, o),
  post: <T = any>(path: string, body?: unknown, o?: Options): Promise<T> => request('POST', path, { ...o, body: body ?? {} }),
  put: <T = any>(path: string, body?: unknown, o?: Options): Promise<T> => request('PUT', path, { ...o, body }),
  patch: <T = any>(path: string, body?: unknown, o?: Options): Promise<T> => request('PATCH', path, { ...o, body }),
  /** Same as the verbs above but returns { data, warnings, meta }. */
  full: {
    get: <T = any>(path: string): Promise<Envelope<T>> => request('GET', path, { raw: true }),
    put: <T = any>(path: string, body: unknown): Promise<Envelope<T>> => request('PUT', path, { body, raw: true }),
    post: <T = any>(path: string, body: unknown): Promise<Envelope<T>> => request('POST', path, { body, raw: true }),
  },
};

/** Upload a blob to a presigned URL and return the storage key to attach to a record. */
export async function uploadAttachment(blob: Blob, fileName: string, locationId: string): Promise<string> {
  const presign = await api.post<{ key: string; uploadUrl: string; headers: Record<string, string> }>('/attachments/presign', {
    fileName, mimeType: blob.type || 'image/jpeg', sizeBytes: blob.size, locationId,
  });
  let res: Response;
  try {
    res = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.headers, body: blob });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No internet connection');
  }
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'Photo upload failed');
  return presign.key;
}
