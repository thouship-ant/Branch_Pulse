import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReqCtx } from './auth-user';
import { Tx } from './prisma.service';

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'STATUS_CHANGE' | 'APPROVE' | 'REJECT' | 'REOPEN' | 'CANCEL' | 'REVERSE'
  | 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT' | 'EXPORT' | 'SETTINGS_CHANGE' | 'PERMISSION_CHANGE';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  entityCode?: string;
  locationId?: string | null;
  /** the company the entry belongs to, when it differs from the actor's (e.g. the Super Admin acting for a company) */
  companyId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string;
}

const MASKED = new Set(['password_hash', 'refresh_token_hash', 'bank_details_enc', 'token', 'password']);
const NOISE = new Set(['updated_at', 'updated_by', 'version', 'created_at', 'created_by']);

function jsonSafe(v: unknown): Prisma.InputJsonValue | null {
  if (v === null || v === undefined) return null;
  if (Prisma.Decimal.isDecimal(v)) return (v as Prisma.Decimal).toFixed();
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return '***';
  if (Array.isArray(v)) return v.map((x) => jsonSafe(x)) as Prisma.InputJsonValue;
  if (typeof v === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = MASKED.has(k) ? '***' : jsonSafe(x);
    return out as Prisma.InputJsonValue;
  }
  return v as Prisma.InputJsonValue;
}

/**
 * Append-only audit trail (LLD s14). Called with the SAME transaction client as the change, so a
 * change can never exist without its audit row. Masked fields never reach the log.
 */
@Injectable()
export class AuditService {
  async log(tx: Tx, ctx: ReqCtx | null, e: AuditEntry) {
    const before = e.before ?? null;
    const after = e.after ?? null;

    let changed: string[] = [];
    let oldValues: unknown = null;
    let newValues: unknown = after;
    if (before && after) {
      const oldDiff: Record<string, unknown> = {};
      const newDiff: Record<string, unknown> = {};
      for (const k of Object.keys(after)) {
        if (NOISE.has(k)) continue;
        if (JSON.stringify(jsonSafe(before[k])) !== JSON.stringify(jsonSafe(after[k]))) {
          changed.push(k);
          oldDiff[k] = before[k];
          newDiff[k] = after[k];
        }
      }
      oldValues = oldDiff;
      newValues = newDiff;
    } else if (before) {
      oldValues = before;
      changed = Object.keys(before).filter((k) => !NOISE.has(k));
    } else if (after) {
      changed = Object.keys(after).filter((k) => !NOISE.has(k));
    }

    await tx.auditLog.create({
      data: {
        actor_id: ctx?.user.id ?? null,
        company_id: e.companyId ?? ctx?.user.companyId ?? undefined, // undefined: the column default (session company) applies
        actor_role: ctx?.user.roles[0] ?? (ctx ? null : 'SYSTEM'),
        location_id: e.locationId ?? null,
        action: e.action,
        entity_type: e.entityType,
        entity_id: e.entityId ?? null,
        entity_code: e.entityCode ?? null,
        old_values: (jsonSafe(oldValues) ?? Prisma.DbNull) as Prisma.InputJsonValue,
        new_values: (jsonSafe(newValues) ?? Prisma.DbNull) as Prisma.InputJsonValue,
        changed_fields: changed,
        reason: e.reason ?? null,
        request_id: ctx?.requestId ?? null,
        ip: ctx?.ip ?? null,
        user_agent: ctx?.userAgent?.slice(0, 300) ?? null,
        device_id: ctx?.deviceId ?? null,
        source: ctx?.source ?? 'SYSTEM',
      },
    });
  }
}
