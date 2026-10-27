import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/auth-user';
import { PrismaService } from '../common/prisma.service';
import { env } from '../config/env';

interface JwtPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: env.jwtSecret,
      ignoreExpiration: false,
    });
  }

  /** Resolve user -> roles -> permissions and user -> allowed locations on every request. */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.loadAuthUser(payload.sub, payload.sid);
    if (!user) throw new UnauthorizedException();
    return user;
  }

  async loadAuthUser(userId: string, sessionId: string): Promise<AuthUser | null> {
    // before the company is known: runAuth may read users, roles and sessions across companies
    return this.prisma.runAuth(async (tx) => {
      const session = await tx.session.findUnique({ where: { id: sessionId } });
      if (!session || session.user_id !== userId || session.revoked_at || session.expires_at < new Date()) return null;

      const u = await tx.user.findUnique({
        where: { id: userId },
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          locations: true,
        },
      });
      if (!u || u.status !== 'ACTIVE') return null;
      if (u.company_id) {
        const company = await tx.company.findUnique({ where: { id: u.company_id } });
        if (!company || company.status !== 'ACTIVE') return null; // a deactivated company is locked out
      }

      const activeRoles = u.roles.map((r) => r.role).filter((r) => r.status === 'ACTIVE');
      return {
        id: u.id,
        username: u.username,
        fullName: u.full_name,
        language: u.preferred_language,
        sessionId,
        roles: activeRoles.map((r) => r.code),
        permissions: [...new Set(activeRoles.flatMap((r) => r.permissions.map((p) => p.permission.code)))],
        allLocations: activeRoles.some((r) => r.scope_mode === 'ALL'),
        locationIds: u.locations.map((l) => l.location_id),
        companyId: u.company_id,
        isSuper: activeRoles.some((r) => r.code === 'SUPER_ADMIN'),
      };
    });
  }
}
