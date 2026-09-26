import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, map } from 'rxjs';

/** Return this from a handler to add warnings / paging meta to the standard envelope (LLD s11). */
export class Envelope<T> {
  constructor(
    public readonly data: T,
    public readonly warnings: Array<{ code: string; message: string; field?: string }> = [],
    public readonly meta?: Record<string, unknown>,
  ) {}
}

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * Serialise for the wire (LLD s1): camelCase keys, Decimals as strings, BigInt as string, and DATE
 * columns (UTC-midnight values) as YYYY-MM-DD.
 */
export function serialise(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toFixed();
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (Buffer.isBuffer(value)) return undefined; // never leak binary columns (e.g. bank details)
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'password_hash' || k === 'refresh_token_hash' || k === 'bank_details_enc') continue;
      // audit snapshots are records of raw column names (they line up with changed_fields), so their inner keys stay as-is
      if (k === 'old_values' || k === 'new_values') { out[camel(k)] = v; continue; }
      const s = serialise(v);
      if (s !== undefined) out[camel(k)] = s;
    }
    return out;
  }
  return value;
}

export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result) => {
        if (result instanceof Envelope) {
          return {
            data: serialise(result.data),
            warnings: result.warnings,
            ...(result.meta ? { meta: serialise(result.meta) } : {}),
          };
        }
        return { data: serialise(result) };
      }),
    );
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const { status, code, message, details } = this.normalise(exception);
    if (status >= 500) this.log.error(`${req.method} ${req.url}: ${(exception as Error)?.stack ?? exception}`);
    res.status(status).json({ error: { code, message, details }, requestId: req.requestId });
  }

  private normalise(e: unknown): { status: number; code: string; message: string; details?: unknown } {
    if (e instanceof HttpException) {
      const body = e.getResponse() as any;
      if (body && typeof body === 'object' && body.code) {
        return { status: e.getStatus(), code: body.code, message: body.message, details: body.details };
      }
      const msg = Array.isArray(body?.message) ? body.message.join('; ') : (body?.message ?? e.message);
      const status = e.getStatus();
      const code = status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR';
      return { status, code, message: msg };
    }

    const text = (e as Error)?.message ?? '';
    // Errors raised by database triggers / RLS (LLD s7) surfaced with stable codes.
    if (text.includes('DAY_LOCKED')) {
      return { status: 409, code: 'DAY_LOCKED', message: 'Day closed - ask the owner to reopen it' };
    }
    if (text.includes('APPROVED_IMMUTABLE')) {
      return { status: 409, code: 'APPROVED_IMMUTABLE', message: 'Approved records cannot be edited; reverse and re-enter' };
    }
    if (text.includes('row-level security')) {
      return { status: 403, code: 'FORBIDDEN_LOCATION', message: 'You do not have access to this location' };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return { status: 409, code: 'DUPLICATE', message: 'A record with the same unique value already exists', details: e.meta };
      }
      if (e.code === 'P2025') return { status: 404, code: 'NOT_FOUND', message: 'Record not found' };
    }
    return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' };
  }
}
