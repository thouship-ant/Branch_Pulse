'use client';

import Dexie, { type Table } from 'dexie';
import { useEffect, useState } from 'react';
import { api, ApiError, deviceId, uploadAttachment } from './api';

/**
 * Offline outbox (LLD s15). Every offline-capable entry is written here FIRST - online or not - so
 * there is a single code path. The server applies each operation exactly once by clientUuid.
 */
export type OpState = 'PENDING' | 'SENDING' | 'DONE' | 'CONFLICT' | 'REJECTED';

export interface OutboxOp {
  clientUuid: string; // primary key
  entityType: 'EXPENSE' | 'DAILY_SALES' | 'CASH_RECONCILIATION' | 'CASH_TRANSACTION';
  op: 'CREATE' | 'UPDATE';
  payload: Record<string, any>;
  baseVersion?: number;
  locationId: string;
  businessDate: string;
  createdAt: string;
  attempts: number;
  state: OpState;
  lastError?: string;
  server?: any; // server copy when CONFLICT
  warnings?: Array<{ code: string; message: string }>;
  entityId?: string;
  blobs?: Array<{ blob: Blob; name: string }>; // receipt photos, uploaded just before the op is sent
  seq: number;
}

class BranchPulseDb extends Dexie {
  outbox!: Table<OutboxOp, string>;
  masters!: Table<{ key: string; value: any }, string>;
  constructor() {
    super('branch-pulse');
    this.version(1).stores({
      outbox: 'clientUuid, state, locationId, businessDate, seq',
      masters: 'key',
    });
  }
}

let _db: BranchPulseDb | null = null;
const db = () => (_db ??= new BranchPulseDb());

export async function clearLocalData() {
  try { await db().outbox.clear(); await db().masters.clear(); } catch { /* ignore */ }
}

let seqCounter = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function enqueue(
  op: Omit<OutboxOp, 'clientUuid' | 'createdAt' | 'attempts' | 'state' | 'seq'>,
): Promise<OutboxOp> {
  const row: OutboxOp = {
    ...op,
    clientUuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    state: 'PENDING',
    seq: Date.now() * 1000 + (seqCounter++ % 1000),
  };
  await db().outbox.add(row);
  notify();
  return row;
}

let flushing: Promise<void> | null = null;
let backoffMs = 5_000;
let nextTryAt = 0;

/** Send PENDING operations in order. Safe to call from anywhere; concurrent calls share one run. */
export function flushOutbox(force = false): Promise<void> {
  if (!navigator.onLine) return Promise.resolve();
  if (!force && Date.now() < nextTryAt) return Promise.resolve();
  if (!flushing) flushing = run().finally(() => { flushing = null; });
  return flushing;
}

async function run() {
  const pending = (await db().outbox.where('state').equals('PENDING').sortBy('seq')).slice(0, 50);
  if (!pending.length) return;
  await db().outbox.where('clientUuid').anyOf(pending.map((p) => p.clientUuid)).modify({ state: 'SENDING' });
  notify();

  try {
    // photos first (pre-signed upload), so the batch only carries storage keys
    for (const p of pending) {
      if (p.blobs?.length) {
        const keys: string[] = [];
        for (const b of p.blobs) keys.push(await uploadAttachment(b.blob, b.name, p.locationId));
        p.payload = { ...p.payload, attachmentKeys: keys };
        p.blobs = undefined;
        await db().outbox.update(p.clientUuid, { payload: p.payload, blobs: undefined });
      }
    }

    const res = await api.post<{ results: any[]; mastersChanged: boolean }>('/sync/batch', {
      deviceId: deviceId(),
      operations: pending.map((p) => ({
        clientUuid: p.clientUuid, entityType: p.entityType, op: p.op, baseVersion: p.baseVersion,
        clientCreatedAt: p.createdAt, payload: p.payload,
      })),
    });

    for (const r of res.results) {
      const state: OpState =
        r.result === 'APPLIED' || r.result === 'DUPLICATE' ? 'DONE' : r.result === 'CONFLICT' ? 'CONFLICT' : 'REJECTED';
      await db().outbox.update(r.clientUuid, {
        state, entityId: r.entityId, warnings: r.warnings, server: r.server,
        lastError: r.error ? `${r.error.code}: ${r.error.message}` : undefined,
      });
    }
    backoffMs = 5_000;
    nextTryAt = 0;
    // finished entries are pruned after they have been shown
    setTimeout(pruneDone, 30_000);
  } catch (e) {
    // network / server trouble: put everything back and retry with exponential backoff (5 s -> 5 min)
    await db().outbox.where('clientUuid').anyOf(pending.map((p) => p.clientUuid)).modify((o) => {
      o.state = 'PENDING';
      o.attempts += 1;
    });
    if (!(e instanceof ApiError) || e.isNetwork || e.status >= 500) {
      nextTryAt = Date.now() + backoffMs;
      backoffMs = Math.min(backoffMs * 2, 300_000);
    } else if (e.status === 401) {
      nextTryAt = Date.now() + 10_000;
    } else {
      // a 4xx for the whole batch: mark rejected so it does not loop forever
      await db().outbox.where('clientUuid').anyOf(pending.map((p) => p.clientUuid)).modify({ state: 'REJECTED', lastError: e.message });
    }
  } finally {
    notify();
  }
}

async function pruneDone() {
  await db().outbox.where('state').equals('DONE').delete();
  notify();
}

export async function discard(clientUuid: string) {
  await db().outbox.delete(clientUuid);
  notify();
}

/** Conflict resolution: keep mine -> resend as UPDATE against the server's current version. */
export async function keepMine(op: OutboxOp) {
  await db().outbox.update(op.clientUuid, {
    op: 'UPDATE', baseVersion: op.server?.version, state: 'PENDING', lastError: undefined, server: undefined,
  });
  notify();
  void flushOutbox(true);
}

export const listOutbox = () => db().outbox.orderBy('seq').toArray();

/** Live view of the outbox for banners, checklists and the conflict resolver. */
export function useOutbox(locationId?: string, businessDate?: string) {
  const [ops, setOps] = useState<OutboxOp[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const all = await listOutbox();
      if (alive) setOps(all.filter((o) => (!locationId || o.locationId === locationId) && (!businessDate || o.businessDate === businessDate)));
    };
    listeners.add(load);
    void load();

    setOnline(navigator.onLine);
    const on = () => { setOnline(true); void flushOutbox(true); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const timer = setInterval(() => void flushOutbox(), 60_000); // every 60 s while online
    const sw = (e: MessageEvent) => { if (e.data?.type === 'flush-outbox') void flushOutbox(true); };
    navigator.serviceWorker?.addEventListener('message', sw);
    void flushOutbox(true); // on app start

    return () => {
      alive = false;
      listeners.delete(load);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(timer);
      navigator.serviceWorker?.removeEventListener('message', sw);
    };
  }, [locationId, businessDate]);

  return {
    ops,
    online,
    waiting: ops.filter((o) => o.state === 'PENDING' || o.state === 'SENDING').length,
    needsAttention: ops.filter((o) => o.state === 'CONFLICT' || o.state === 'REJECTED'),
  };
}

/** Ask the browser to wake us for a background sync when connectivity returns (where supported). */
export async function registerBackgroundSync() {
  try {
    const reg: any = await navigator.serviceWorker?.ready;
    await reg?.sync?.register('sync-outbox');
  } catch { /* unsupported: the online event and 60 s timer still cover it */ }
}

/**
 * Enqueue, try to send immediately, and report what happened to THIS operation. Offline it simply
 * stays PENDING and the caller shows "saved, will sync".
 */
export async function submitOffline(
  op: Parameters<typeof enqueue>[0],
): Promise<OutboxOp> {
  const row = await enqueue(op);
  await registerBackgroundSync();
  await flushOutbox(true);
  return (await db().outbox.get(row.clientUuid)) ?? row;
}

export async function cacheMaster(key: string, value: any) {
  try { await db().masters.put({ key, value }); } catch { /* ignore */ }
}
export async function readMaster<T = any>(key: string): Promise<T | undefined> {
  try { return (await db().masters.get(key))?.value; } catch { return undefined; }
}
