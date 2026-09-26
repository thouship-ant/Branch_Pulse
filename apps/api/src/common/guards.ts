import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import {
  AuthUser,
  canAccessLocation,
  IS_PUBLIC,
  PERMISSIONS_KEY,
} from './auth-user';
import { AppException, forbiddenLocation } from './app-exception';

/** Layer 1 of access: valid bearer token on a live session (deny by default; opt out with @Public). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

/** WHAT the caller may do: module:action permissions resolved from roles (data, not code). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) return true; // @Public route
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) {
      throw new AppException(403, 'FORBIDDEN', 'You do not have permission for this action', { missing });
    }
    return true;
  }
}

const LOCATION_KEYS = ['locationId', 'fromLocationId', 'toLocationId'];

/**
 * WHERE the caller may act: rejects any request whose path, query or body names a location outside
 * the caller's scope with 403 (HLD s3, enforcement layer 2). Repositories and RLS are layers 3 and 4.
 */
@Injectable()
export class LocationScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    if (!user || user.allLocations) return true;

    const ids: string[] = [];
    const collect = (src: Record<string, unknown> | undefined) => {
      if (!src || typeof src !== 'object') return;
      for (const k of LOCATION_KEYS) {
        const v = src[k];
        if (typeof v === 'string' && v) ids.push(v);
      }
      const many = src['locationIds'];
      if (typeof many === 'string' && many) ids.push(...many.split(','));
      if (Array.isArray(many)) ids.push(...many.filter((x): x is string => typeof x === 'string'));
    };
    collect(req.params);
    collect(req.query);
    collect(req.body);

    if (ids.some((id) => !canAccessLocation(user, id))) throw forbiddenLocation();
    return true;
  }
}
