import { HttpException } from '@nestjs/common';

/** Business/validation error with a stable machine-readable code (LLD s10, s11). */
export class AppException extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const forbiddenLocation = () =>
  new AppException(403, 'FORBIDDEN_LOCATION', 'You do not have access to this location');

export const notFound = (what: string) => new AppException(404, 'NOT_FOUND', `${what} not found`);

export const invalidTransition = (entity: string, from: string, to: string) =>
  new AppException(409, 'INVALID_TRANSITION', `${entity}: cannot go from ${from} to ${to}`);

export const staleVersion = () =>
  new AppException(409, 'STALE_VERSION', 'The record was changed by someone else; reload and retry');

export const validation = (code: string, message: string, field?: string) =>
  new AppException(422, code, message, field ? [{ field, message }] : undefined);
