import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  language: string;
  sessionId: string;
  roles: string[]; // role codes
  permissions: string[]; // permission codes (module:action)
  allLocations: boolean; // scope_mode ALL on any role
  locationIds: string[]; // explicit assignments (used when !allLocations)
  companyId: string | null; // the company this user belongs to (null only for the Super Admin)
  isSuper: boolean; // Super Admin: manages companies, sees no branch data
}

export type EntrySourceValue = 'WEB' | 'PWA_OFFLINE' | 'SYSTEM';

/** Everything a domain service needs to know about the current request. */
export interface ReqCtx {
  user: AuthUser;
  ip?: string;
  userAgent?: string;
  deviceId?: string;
  requestId: string;
  source: EntrySourceValue;
}

export const isAdmin = (u: AuthUser) => u.roles.includes('ADMIN');
export const can = (u: AuthUser, perm: string) => u.permissions.includes(perm);
export const canAccessLocation = (u: AuthUser, locationId: string) =>
  u.allLocations || u.locationIds.includes(locationId);

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS_KEY = 'permissions';
/** Caller must hold ALL listed permissions. */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);

export const CurrentUser = createParamDecorator((_d: unknown, host: ExecutionContext): AuthUser => {
  return host.switchToHttp().getRequest().user;
});

export const Ctx = createParamDecorator((_d: unknown, host: ExecutionContext): ReqCtx => {
  const req = host.switchToHttp().getRequest();
  const ip = req.ip && isIP(req.ip.replace(/^::ffff:/, '')) ? req.ip.replace(/^::ffff:/, '') : undefined;
  const source = req.headers['x-entry-source'] === 'PWA_OFFLINE' ? 'PWA_OFFLINE' : 'WEB';
  return {
    user: req.user,
    ip,
    userAgent: req.headers['user-agent'],
    deviceId: typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'].slice(0, 64) : undefined,
    requestId: req.requestId ?? randomUUID(),
    source,
  };
});
