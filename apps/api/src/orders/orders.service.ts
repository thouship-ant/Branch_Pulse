import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx, canAccessLocation } from '../common/auth-user';
import { CodesService } from '../common/codes.service';
import { toDate, todayIST } from '../common/dates';
import { D, parseMoney, ZERO } from '../common/money';
import { PrismaService } from '../common/prisma.service';

export const EVENT_TYPES = ['BUSINESS_MEETING', 'FUNCTION', 'PARTY', 'CORPORATE', 'OTHER'] as const;
/** The sub-events offered for each event type (the mobile app shows the same lists); Other has none. */
export const SUB_EVENTS: Record<string, string[]> = {
  BUSINESS_MEETING: ['Association'],
  FUNCTION: ['Annual Day', 'Engagement', 'Wedding Reception'],
  PARTY: ['Anniversary Party', 'Birthday Party', 'Farewell Party', 'Baby Shower', 'Get-together', 'Other'],
  CORPORATE: ['Meeting', 'Exports', 'IT', 'Manufacturing', 'Retail', 'Education', 'Other'],
};
const checkSubEvent = (eventType: string | undefined, subEvent: string | undefined) => {
  if (!subEvent) return;
  if (!eventType || !(SUB_EVENTS[eventType] ?? []).includes(subEvent)) throw validation('INVALID_SUB_EVENT', `"${subEvent}" is not a sub-event of this event type`, 'subEvent');
};
const MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'] as const;

export class CreateOrderDto {
  @IsUUID() locationId: string;
  @IsString() @MaxLength(100) customerName: string;
  @Matches(/^\d{10}$/, { message: 'Phone must be 10 digits' }) customerPhone: string; // the customer's number is mandatory on a new order
  @IsIn(EVENT_TYPES as unknown as string[]) eventType: string;
  @IsOptional() @IsString() @MaxLength(40) subEvent?: string;
  @IsDateString() eventDate: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/, { message: 'Time must be HH:MM' }) eventTime?: string;
  @IsOptional() @IsString() venue?: string;
  @IsOptional() @IsString() itemsSummary?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) peopleCount?: number;
  @IsString() amount: string;
  /** what the customer pays up front, if anything */
  @IsOptional() @IsString() advance?: string;
  @IsOptional() @IsIn(MODES as unknown as string[]) advanceMode?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateOrderDto {
  @IsOptional() @IsString() @MaxLength(100) customerName?: string;
  @IsOptional() @Matches(/^\d{10}$/, { message: 'Phone must be 10 digits' }) customerPhone?: string;
  @IsOptional() @IsIn(EVENT_TYPES as unknown as string[]) eventType?: string;
  @IsOptional() @IsString() @MaxLength(40) subEvent?: string;
  @IsOptional() @IsDateString() eventDate?: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) eventTime?: string;
  @IsOptional() @IsString() venue?: string;
  @IsOptional() @IsString() itemsSummary?: string;
  @IsOptional() @IsInt() @Min(1) peopleCount?: number;
  @IsOptional() @IsString() amount?: string;
  @IsOptional() @IsIn(['PLANNED', 'DELIVERED', 'CANCELLED']) status?: string;
  @IsOptional() @IsString() notes?: string;
}

export class AddPaymentDto {
  @IsString() amount: string;
  @IsIn(MODES as unknown as string[]) mode: string;
  @IsOptional() @IsDateString() paidOn?: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

export class ListOrdersQuery {
  @IsOptional() @IsIn(['PLANNED', 'DELIVERED', 'CANCELLED']) status?: string;
  @IsOptional() @IsIn(['UNPAID', 'PARTIAL', 'PAID']) paymentStatus?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() q?: string;
}

const statusOf = (amount: Prisma.Decimal, paid: Prisma.Decimal) => (paid.lessThanOrEqualTo(0) ? 'UNPAID' : paid.greaterThanOrEqualTo(amount) ? 'PAID' : 'PARTIAL');

/** Outside-shop orders (meetings, functions, parties): who ordered what, for when, and how much has been paid. */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly codes: CodesService) {}

  private view(o: any) {
    return { ...o, balance: D(o.amount).minus(o.paid_amount) };
  }

  async list(ctx: ReqCtx, q: ListOrdersQuery) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const search = q.q?.trim();
      const rows = await tx.order.findMany({
        where: {
          ...(q.status ? { status: q.status } : {}), ...(q.paymentStatus ? { payment_status: q.paymentStatus } : {}), ...(q.locationId ? { location_id: q.locationId } : {}),
          ...(q.from || q.to ? { event_date: { ...(q.from ? { gte: toDate(q.from, 'from') } : {}), ...(q.to ? { lte: toDate(q.to, 'to') } : {}) } } : {}),
          ...(search ? { OR: [{ customer_name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }, { venue: { contains: search, mode: 'insensitive' } }] } : {}),
        },
        orderBy: [{ event_date: 'desc' }, { created_at: 'desc' }],
        take: 500,
      });
      const locs = await tx.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.location_id))] } }, select: { id: true, code: true, name: true, name_ta: true } });
      const byId = new Map(locs.map((l) => [l.id, l]));
      return rows.map((r) => ({ ...this.view(r), location_name: byId.get(r.location_id)?.name, location_name_ta: byId.get(r.location_id)?.name_ta, location_code: byId.get(r.location_id)?.code }));
    });
  }

  async get(ctx: ReqCtx, id: string) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const o = await tx.order.findUnique({ where: { id }, include: { payments: { orderBy: [{ paid_on: 'asc' }, { created_at: 'asc' }] } } });
      if (!o) throw notFound('Order');
      const loc = await tx.location.findUnique({ where: { id: o.location_id }, select: { name: true, name_ta: true, code: true } });
      return { ...this.view(o), location_name: loc?.name, location_name_ta: loc?.name_ta, location_code: loc?.code };
    });
  }

  async create(ctx: ReqCtx, dto: CreateOrderDto) {
    if (!canAccessLocation(ctx.user, dto.locationId)) throw new AppException(403, 'FORBIDDEN', 'You cannot book orders for this branch');
    checkSubEvent(dto.eventType, dto.subEvent);
    const amount = parseMoney(dto.amount, 'amount', { allowZero: false });
    const advance = dto.advance ? parseMoney(dto.advance, 'advance', { allowZero: false }) : ZERO;
    if (advance.greaterThan(amount)) throw validation('INVALID_AMOUNT', 'The advance cannot be more than the order amount', 'advance');
    if (advance.greaterThan(0) && !dto.advanceMode) throw validation('MODE_REQUIRED', 'Choose how the advance was paid', 'advanceMode');
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw notFound('Location');
      const o = await tx.order.create({
        data: {
          code: await this.codes.next(tx, 'order', dto.locationId), location_id: dto.locationId, customer_name: dto.customerName.trim(), customer_phone: dto.customerPhone,
          event_type: dto.eventType, sub_event: dto.subEvent || null, event_date: toDate(dto.eventDate, 'eventDate'), event_time: dto.eventTime, venue: dto.venue?.trim() || null,
          items_summary: dto.itemsSummary?.trim() || null, people_count: dto.peopleCount, amount, paid_amount: advance, payment_status: statusOf(amount, advance),
          notes: dto.notes?.trim() || null, entered_by: ctx.user.id, created_by: ctx.user.id, updated_by: ctx.user.id,
          ...(advance.greaterThan(0) ? { payments: { create: [{ paid_on: toDate(todayIST()), amount: advance, mode: dto.advanceMode as any, reference: 'Advance', created_by: ctx.user.id }] } } : {}),
        },
      });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'ORDER', entityId: o.id, entityCode: o.code, locationId: o.location_id, after: o });
      return this.view(o);
    });
  }

  async update(ctx: ReqCtx, id: string, dto: UpdateOrderDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.order.findUnique({ where: { id } });
      if (!before) throw notFound('Order');
      // changing the event type clears a sub-event that no longer belongs to it
      const typeNow = dto.eventType ?? before.event_type;
      const subNow = dto.subEvent !== undefined ? dto.subEvent : dto.eventType && dto.eventType !== before.event_type ? '' : before.sub_event ?? '';
      checkSubEvent(typeNow, subNow || undefined);
      const amount = dto.amount ? parseMoney(dto.amount, 'amount', { allowZero: false }) : before.amount;
      if (amount.lessThan(before.paid_amount)) throw validation('INVALID_AMOUNT', 'The amount cannot be less than what is already paid', 'amount');
      const after = await tx.order.update({
        where: { id },
        data: {
          customer_name: dto.customerName?.trim(), customer_phone: dto.customerPhone, event_type: dto.eventType, sub_event: subNow || null, event_date: dto.eventDate ? toDate(dto.eventDate, 'eventDate') : undefined,
          event_time: dto.eventTime, venue: dto.venue?.trim(), items_summary: dto.itemsSummary?.trim(), people_count: dto.peopleCount, amount, status: dto.status,
          payment_status: statusOf(amount, before.paid_amount), notes: dto.notes?.trim(), updated_by: ctx.user.id, version: { increment: 1 },
        },
      });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'ORDER', entityId: id, entityCode: after.code, locationId: after.location_id, before, after });
      return this.view(after);
    });
  }

  /** A payment against the order; the status follows: nothing paid = UNPAID, some = PARTIAL, all = PAID. */
  async addPayment(ctx: ReqCtx, id: string, dto: AddPaymentDto) {
    const amount = parseMoney(dto.amount, 'amount', { allowZero: false });
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const o = await tx.order.findUnique({ where: { id } });
      if (!o) throw notFound('Order');
      if (o.status === 'CANCELLED') throw new AppException(409, 'ORDER_CANCELLED', 'This order is cancelled');
      const balance = o.amount.minus(o.paid_amount);
      if (amount.greaterThan(balance)) throw validation('OVERPAYMENT', `Only ${balance.toFixed(2)} is left to pay`, 'amount');
      await tx.orderPayment.create({ data: { order_id: id, paid_on: toDate(dto.paidOn ?? todayIST(), 'paidOn'), amount, mode: dto.mode as any, reference: dto.reference, created_by: ctx.user.id } });
      const paid = o.paid_amount.plus(amount);
      const after = await tx.order.update({ where: { id }, data: { paid_amount: paid, payment_status: statusOf(o.amount, paid), updated_by: ctx.user.id, version: { increment: 1 } } });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'ORDER', entityId: id, entityCode: o.code, locationId: o.location_id, before: o, after, reason: `Payment ${amount.toFixed(2)} (${dto.mode})` });
      return this.view(after);
    });
  }

  /** For the dashboard: how many orders are coming up and how much of their value is still unpaid. */
  async summary(ctx: ReqCtx) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const today = toDate(todayIST());
      const open = await tx.order.findMany({ where: { status: { not: 'CANCELLED' } }, select: { event_date: true, amount: true, paid_amount: true, payment_status: true, status: true } });
      const sum = (l: typeof open, f: (o: (typeof open)[number]) => Prisma.Decimal) => l.reduce((t, o) => t.plus(f(o)), ZERO);
      const upcoming = open.filter((o) => o.status === 'PLANNED' && o.event_date.getTime() >= today.getTime());
      return {
        upcoming: upcoming.length,
        counts: { UNPAID: open.filter((o) => o.payment_status === 'UNPAID').length, PARTIAL: open.filter((o) => o.payment_status === 'PARTIAL').length, PAID: open.filter((o) => o.payment_status === 'PAID').length },
        totalValue: sum(open, (o) => o.amount), received: sum(open, (o) => o.paid_amount), outstanding: sum(open, (o) => o.amount.minus(o.paid_amount)),
      };
    });
  }
}
