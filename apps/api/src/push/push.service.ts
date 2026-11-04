import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ReqCtx } from '../common/auth-user';
import { toDate, todayIST } from '../common/dates';
import { PrismaService, SYSTEM_SCOPE } from '../common/prisma.service';
import { env } from '../config/env';

export class RegisterDeviceDto {
  @IsString() @Matches(/^Expo(nent)?PushToken\[[^\]]+\]$/, { message: 'Not an Expo push token' }) token!: string;
  @IsOptional() @IsIn(['android', 'ios', 'web']) platform?: string;
  @IsOptional() @IsString() @MaxLength(100) deviceName?: string;
}

export class UnregisterDeviceDto {
  @IsString() @MaxLength(200) token!: string;
}

/**
 * What the phone shows. `category` picks the action buttons on the notification (Approve / Reject / Open ...), `data` tells the app
 * where to go when it is tapped. The app registers the categories; see apps/mobile/src/lib/push.ts.
 */
export interface PushPayload {
  title: string;
  body: string;
  category: 'approval_expense' | 'approval_closing' | 'closing_reminder' | 'info';
  data: Record<string, unknown>;
}

const inr = (v: unknown) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const day = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Push notifications through the Expo push service. Everything here is fire-and-forget: a failure to notify is logged and never
 * breaks the request that triggered it.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ device registry
  /** The same phone may be used by another person later: the token moves to whoever registers it last. */
  async register(ctx: ReqCtx, dto: RegisterDeviceDto) {
    if (!ctx.user.companyId) return { registered: false }; // the Super Admin has no branch work to be told about
    await this.prisma.runScoped(SYSTEM_SCOPE, (tx) =>
      tx.pushDevice.upsert({
        where: { token: dto.token },
        update: { user_id: ctx.user.id, company_id: ctx.user.companyId, platform: dto.platform, device_name: dto.deviceName, status: 'ACTIVE', last_seen_at: new Date() },
        create: { user_id: ctx.user.id, company_id: ctx.user.companyId, token: dto.token, platform: dto.platform, device_name: dto.deviceName },
      }),
    );
    return { registered: true };
  }

  async unregister(ctx: ReqCtx, token: string) {
    await this.prisma.runScoped(SYSTEM_SCOPE, (tx) =>
      tx.pushDevice.updateMany({ where: { token, user_id: ctx.user.id }, data: { status: 'INACTIVE' } }),
    );
    return { unregistered: true };
  }

  /** "Send me a test": lets a user check that notifications reach their phone. */
  async sendTest(ctx: ReqCtx) {
    const sent = await this.sendToUsers([ctx.user.id], {
      title: 'Branch Pulse', body: 'Notifications are working on this phone.', category: 'info', data: { type: 'TEST' },
    });
    return { sent };
  }

  // ------------------------------------------------------------ who to tell
  /** Active users of a company that hold `permission` and can see `locationId` (all-branch roles, or assigned to it). */
  private async recipients(companyId: string, permission: string, locationId: string | null, exclude?: string): Promise<string[]> {
    return this.prisma.runScoped(SYSTEM_SCOPE, async (tx) => {
      const users = await tx.user.findMany({
        where: {
          company_id: companyId, status: 'ACTIVE',
          roles: { some: { role: { status: 'ACTIVE', permissions: { some: { permission: { code: permission } } } } } },
        },
        select: { id: true, roles: { select: { role: { select: { scope_mode: true } } } } },
      });
      const wide = new Set(users.filter((u) => u.roles.some((r) => r.role.scope_mode === 'ALL')).map((u) => u.id));
      const assigned = locationId
        ? new Set((await tx.userLocation.findMany({ where: { location_id: locationId, user_id: { in: users.map((u) => u.id) } }, select: { user_id: true } })).map((l) => l.user_id))
        : new Set<string>();
      return users.map((u) => u.id).filter((id) => id !== exclude && (!locationId || wide.has(id) || assigned.has(id)));
    });
  }

  /** Sends to every active device of the given users. Returns how many devices were handed to Expo. */
  async sendToUsers(userIds: string[], p: PushPayload): Promise<number> {
    if (!env.push.enabled || userIds.length === 0) return 0;
    try {
      const devices = await this.prisma.runScoped(SYSTEM_SCOPE, (tx) =>
        tx.pushDevice.findMany({ where: { user_id: { in: userIds }, status: 'ACTIVE' }, select: { token: true } }),
      );
      if (devices.length === 0) return 0;
      const messages = devices.map((d) => ({
        to: d.token, title: p.title, body: p.body, data: { ...p.data, category: p.category }, sound: 'default', priority: 'high',
        channelId: p.category === 'closing_reminder' ? 'reminders' : 'alerts', categoryId: p.category,
      }));
      for (let i = 0; i < messages.length; i += 100) await this.post(messages.slice(i, i + 100));
      return devices.length;
    } catch (err) {
      this.log.warn(`Push failed: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
  }

  private async post(batch: Array<{ to: string }>) {
    const res = await fetch(env.push.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(env.push.accessToken ? { Authorization: `Bearer ${env.push.accessToken}` } : {}) },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Expo push service answered ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
    // a phone that uninstalled the app or revoked the token: stop sending to it
    const dead = (body.data ?? []).flatMap((t, i) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? [batch[i].to] : []));
    if (dead.length) {
      await this.prisma.runScoped(SYSTEM_SCOPE, (tx) => tx.pushDevice.updateMany({ where: { token: { in: dead } }, data: { status: 'INACTIVE' } }));
    }
  }

  // ------------------------------------------------------------ events (called after the change is saved)
  private fire(job: () => Promise<unknown>) {
    void job().catch((err) => this.log.warn(`Push event failed: ${err instanceof Error ? err.message : err}`));
  }

  /** A new expense is waiting for approval -> everyone who can approve it, with Approve / Reject buttons. */
  expenseSubmitted(ctx: ReqCtx, e: { id: string; code: string; location_id: string; category_id: string; amount: unknown; payment_mode: string; business_date: Date }) {
    const companyId = ctx.user.companyId;
    if (!companyId) return;
    this.fire(async () => {
      const [ids, names] = await Promise.all([this.recipients(companyId, 'expense:approve', e.location_id, ctx.user.id), this.names(e.location_id, e.category_id)]);
      await this.sendToUsers(ids, {
        title: 'Expense awaiting approval',
        body: `${inr(e.amount)} · ${names.category} · ${names.location} (${ctx.user.fullName})`,
        category: 'approval_expense', data: { type: 'EXPENSE_APPROVAL', expenseId: e.id, code: e.code, locationId: e.location_id },
      });
    });
  }

  /** Approved / rejected -> the person who entered it. */
  expenseDecided(ctx: ReqCtx, e: { id: string; code: string; entered_by: string; amount: unknown; approval_status: string; rejection_reason?: string | null; location_id: string }) {
    if (e.entered_by === ctx.user.id) return;
    const rejected = e.approval_status === 'REJECTED';
    this.fire(() => this.sendToUsers([e.entered_by], {
      title: rejected ? 'Expense rejected' : 'Expense approved',
      body: rejected ? `${e.code} · ${inr(e.amount)} — ${e.rejection_reason ?? 'see the app'}` : `${e.code} · ${inr(e.amount)}`,
      category: 'info', data: { type: 'EXPENSE_RESULT', expenseId: e.id, locationId: e.location_id },
    }));
  }

  /** A branch submitted its closing -> approvers, with Approve / Review buttons. */
  closingSubmitted(ctx: ReqCtx, c: { id: string; location_id: string; business_date: Date; total_sales?: unknown }) {
    const companyId = ctx.user.companyId;
    if (!companyId) return;
    this.fire(async () => {
      const [ids, names] = await Promise.all([this.recipients(companyId, 'closing:approve', c.location_id, ctx.user.id), this.names(c.location_id)]);
      await this.sendToUsers(ids, {
        title: 'Closing awaiting approval',
        body: `${names.location} · ${day(c.business_date)}${c.total_sales != null ? ` · Sales ${inr(c.total_sales)}` : ''}`,
        category: 'approval_closing', data: { type: 'CLOSING_APPROVAL', closingId: c.id, locationId: c.location_id, date: c.business_date.toISOString().slice(0, 10) },
      });
    });
  }

  /** Approved / rejected / reopened -> the people who run that branch. */
  closingDecided(ctx: ReqCtx, c: { location_id: string; business_date: Date; review_comment?: string | null }, outcome: 'APPROVED' | 'REJECTED' | 'REOPENED', comment?: string) {
    const companyId = ctx.user.companyId;
    if (!companyId) return;
    this.fire(async () => {
      const [ids, names] = await Promise.all([this.recipients(companyId, 'closing:submit', c.location_id, ctx.user.id), this.names(c.location_id)]);
      const word = outcome === 'APPROVED' ? 'approved' : outcome === 'REJECTED' ? 'rejected' : 'reopened';
      await this.sendToUsers(ids, {
        title: `Closing ${word}`,
        body: `${names.location} · ${day(c.business_date)}${comment || c.review_comment ? ` — ${comment ?? c.review_comment}` : ''}`,
        category: 'info', data: { type: 'CLOSING_RESULT', locationId: c.location_id, date: c.business_date.toISOString().slice(0, 10), outcome },
      });
    });
  }

  private async names(locationId: string, categoryId?: string) {
    return this.prisma.runScoped(SYSTEM_SCOPE, async (tx) => {
      const [loc, cat] = await Promise.all([
        tx.location.findUnique({ where: { id: locationId }, select: { name: true } }),
        categoryId ? tx.expenseCategory.findUnique({ where: { id: categoryId }, select: { name_en: true } }) : null,
      ]);
      return { location: loc?.name ?? 'Branch', category: cat?.name_en ?? 'Expense' };
    });
  }

  // ------------------------------------------------------------ reminder
  /** 8:30 pm IST: a branch whose closing for today is still not submitted gets a nudge. */
  @Cron('30 20 * * *', { timeZone: 'Asia/Kolkata' })
  async closingReminders() {
    if (!env.push.enabled) return;
    const date = toDate(todayIST());
    const open = await this.prisma.runScoped(SYSTEM_SCOPE, async (tx) => {
      const closings = await tx.dailyClosing.findMany({ where: { business_date: date, status: { in: ['PENDING', 'REJECTED', 'REOPENED'] } }, select: { location_id: true, status: true } });
      const locs = await tx.location.findMany({ where: { id: { in: closings.map((c) => c.location_id) }, status: 'ACTIVE', type: 'BRANCH' }, select: { id: true, name: true, company_id: true } });
      return locs.map((l) => ({ ...l, status: closings.find((c) => c.location_id === l.id)?.status }));
    });
    let sent = 0;
    for (const l of open) {
      if (!l.company_id) continue;
      const ids = await this.recipients(l.company_id, 'closing:submit', l.id);
      sent += await this.sendToUsers(ids, {
        title: l.status === 'PENDING' ? 'Closing not submitted yet' : 'Closing needs your attention',
        body: `${l.name} · ${day(date)} — finish sales, cash and stock, then submit.`,
        category: 'closing_reminder', data: { type: 'CLOSING_REMINDER', locationId: l.id, date: todayIST() },
      });
    }
    this.log.log(`Closing reminders: ${open.length} branches, ${sent} devices`);
  }
}
