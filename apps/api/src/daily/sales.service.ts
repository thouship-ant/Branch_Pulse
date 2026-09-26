import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AppException, staleVersion, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { addDays, toDate } from '../common/dates';
import { D, MONEY_PATTERN, parseMoney, parseMoneyOr0, sum } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { RulesService } from '../common/rules.service';
import { SettingsService } from '../common/settings.service';
import { Envelope } from '../common/response';
import { salesMismatch } from './daily.rules';

export class SalesDto {
  @Matches(MONEY_PATTERN) totalSales: string;
  @IsOptional() @Matches(MONEY_PATTERN) cashSales?: string;
  @IsOptional() @Matches(MONEY_PATTERN) upiSales?: string;
  @IsOptional() @Matches(MONEY_PATTERN) cardSales?: string;
  @IsOptional() @Matches(MONEY_PATTERN) creditSales?: string;
  @IsOptional() @Matches(MONEY_PATTERN) complimentaryAmount?: string;
  @IsOptional() @Matches(MONEY_PATTERN) otherAdjustments?: string; // may be negative
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
  @IsOptional() @IsInt() version?: number;
  @IsOptional() @IsUUID() clientUuid?: string;
  @IsOptional() @IsString() clientCreatedAt?: string;
}

type Warning = { code: string; message: string; field?: string };

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly settings: SettingsService,
  ) {}

  get(ctx: ReqCtx, locationId: string, dateStr: string) {
    const date = toDate(dateStr, 'date');
    return this.prisma.runScoped(ctx.user, (tx) =>
      tx.dailySales.findFirst({ where: { location_id: locationId, business_date: date, status: 'ACTIVE' } }),
    );
  }

  /** PUT /daily-sales: one ACTIVE record per branch per day (V6); optimistic-locked (V26). */
  async upsert(ctx: ReqCtx, locationId: string, dateStr: string, dto: SalesDto): Promise<Envelope<unknown>> {
    const date = await this.rules.assertBusinessDate(ctx.user, dateStr, 'date');

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw new AppException(404, 'NOT_FOUND', 'Location not found');
      if (loc.type !== 'BRANCH') throw validation('INVALID_LOCATION', 'Sales are recorded for branches only', 'locationId');
      await this.rules.assertDayEditable(tx, ctx.user, locationId, date);

      const total = parseMoney(dto.totalSales, 'totalSales');
      const cash = parseMoneyOr0(dto.cashSales, 'cashSales');
      const upi = parseMoneyOr0(dto.upiSales, 'upiSales');
      const card = parseMoneyOr0(dto.cardSales, 'cardSales');
      const credit = parseMoneyOr0(dto.creditSales, 'creditSales');
      const comp = parseMoneyOr0(dto.complimentaryAmount, 'complimentaryAmount');
      const other = parseMoneyOr0(dto.otherAdjustments, 'otherAdjustments', { allowNegative: true });

      if (card.greaterThan(0) && !loc.card_enabled) {
        throw validation('CARD_DISABLED', 'Card collections are switched off for this branch', 'cardSales');
      }

      const mismatch = salesMismatch({ total, cash, upi, card, credit, otherAdjustments: other });
      const warnings: Warning[] = [];
      if (!mismatch.isZero()) {
        warnings.push({
          code: 'SALES_SPLIT_MISMATCH',
          message: `Payment split differs from total by ${mismatch.toFixed(2)}`,
          field: 'totalSales',
        });
      }
      const unusual = await this.unusualSales(tx, locationId, date, total);
      if (unusual) warnings.push(unusual);

      const existing = await tx.dailySales.findFirst({
        where: { location_id: locationId, business_date: date, status: 'ACTIVE' },
      });

      const values = {
        total_sales: total,
        cash_sales: cash,
        upi_sales: upi,
        card_sales: card,
        credit_sales: credit,
        complimentary_amount: comp,
        other_adjustments: other,
        mismatch_amount: mismatch,
        remarks: dto.remarks ?? null,
      };

      if (existing) {
        // replay of the same offline operation
        if (dto.clientUuid && existing.client_uuid === dto.clientUuid) return new Envelope(existing, warnings);
        if (dto.version === undefined || dto.version !== existing.version) throw staleVersion();
        const after = await tx.dailySales.update({
          where: { id: existing.id },
          data: { ...values, updated_by: ctx.user.id, version: { increment: 1 } },
        });
        await this.audit.log(tx, ctx, {
          action: 'UPDATE', entityType: 'DAILY_SALES', entityId: after.id, entityCode: `${loc.code} ${dateStr}`,
          locationId, before: existing, after,
        });
        return new Envelope(after, warnings);
      }

      const created = await tx.dailySales.create({
        data: {
          ...values,
          location_id: locationId,
          business_date: date,
          submitted_by: ctx.user.id,
          submitted_at: new Date(),
          client_uuid: dto.clientUuid,
          client_created_at: dto.clientCreatedAt ? new Date(dto.clientCreatedAt) : undefined,
          source: ctx.source,
          created_by: ctx.user.id,
          updated_by: ctx.user.id,
        },
      });
      await this.audit.log(tx, ctx, {
        action: 'CREATE', entityType: 'DAILY_SALES', entityId: created.id, entityCode: `${loc.code} ${dateStr}`,
        locationId, after: created,
      });
      return new Envelope(created, warnings);
    });
  }

  /** V9: total differs from the 28-day same-weekday average by more than sales.unusual_pct. */
  private async unusualSales(tx: Tx, locationId: string, date: Date, total: Prisma.Decimal): Promise<Warning | null> {
    const dates = [7, 14, 21, 28].map((n) => addDays(date, -n));
    const rows = await tx.dailySales.findMany({
      where: { location_id: locationId, status: 'ACTIVE', business_date: { in: dates } },
      select: { total_sales: true },
    });
    if (rows.length < 2) return null;
    const avg = sum(rows.map((r) => r.total_sales)).div(rows.length);
    if (avg.isZero()) return null;
    const pct = total.minus(avg).abs().div(avg).mul(100);
    const limit = D(await this.settings.getNumber('sales.unusual_pct'));
    if (pct.greaterThan(limit)) {
      return {
        code: 'UNUSUAL_SALES',
        message: `Sales are ${pct.toFixed(0)}% away from the usual for this weekday (about ${avg.toFixed(0)})`,
        field: 'totalSales',
      };
    }
    return null;
  }
}
