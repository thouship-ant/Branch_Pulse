import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { JwtStrategy } from '../auth/jwt.strategy';
import { env } from '../config/env';
import { PrismaService } from './prisma.service';

/** What a screen is told: something of this kind changed (no data: the screen asks the API again, so permissions still apply). */
export interface LiveEvent { topic: string; action: string; locationId?: string | null; at: number }

/**
 * Live updates over a WebSocket (socket.io, long-polling as the fallback). A signed-in app connects with its access token and is
 * put in the rooms it may hear about: its company, and each branch it works for (or every branch, for an all-branch role).
 * Every audited change is announced to those rooms, so the other people's screens refresh themselves.
 */
@Injectable()
export class RealtimeService {
  private readonly log = new Logger('Realtime');
  private io: Server | null = null;
  private readonly jwt = new JwtService({ secret: env.jwtSecret });
  private readonly users: JwtStrategy;
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(private readonly prisma: PrismaService) {
    this.users = new JwtStrategy(prisma);
  }

  /** Call once, after the HTTP server exists. */
  attach(server: HttpServer) {
    this.io = new Server(server, {
      path: '/api/v1/realtime',
      cors: { origin: env.corsOrigins, credentials: true },
      serveClient: false,
    });
    // sign-in check: the access token travels in the handshake; the user is looked up again so a locked-out user is refused
    this.io.use(async (socket: Socket, next) => {
      try {
        const token = String(socket.handshake.auth?.token ?? '');
        const p = this.jwt.verify<{ sub: string; sid: string }>(token);
        const u = await this.users.loadAuthUser(p.sub, p.sid);
        if (!u || !u.companyId) return next(new Error('unauthorized'));
        socket.join(`co:${u.companyId}`);
        if (u.allLocations) socket.join(`coall:${u.companyId}`);
        else u.locationIds.forEach((id) => socket.join(`loc:${id}`));
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });
    this.log.log('Live updates ready on /api/v1/realtime');
  }

  /**
   * Announce a change. Waits a moment (and merges repeats) so the screens ask again only after the change is committed.
   * With a branch: that branch's people and the all-branch roles hear it. Without: everyone in the company.
   */
  announce(companyId: string | null | undefined, topic: string, action: string, locationId?: string | null) {
    if (!this.io || !companyId) return;
    const key = `${companyId}|${locationId ?? ''}|${topic}`;
    if (this.pending.has(key)) return;
    this.pending.set(key, setTimeout(() => {
      this.pending.delete(key);
      const event: LiveEvent = { topic, action, locationId: locationId ?? null, at: Date.now() };
      const rooms = locationId ? this.io!.to(`coall:${companyId}`).to(`loc:${locationId}`) : this.io!.to(`co:${companyId}`);
      rooms.emit('change', event);
    }, 400));
  }
}
