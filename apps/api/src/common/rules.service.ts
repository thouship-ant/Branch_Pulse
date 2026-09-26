import { Injectable } from '@nestjs/common';
import { AuthUser, can, isOwner } from './auth-user';
import { AppException, validation } from './app-exception';
import { addDays, fmtDate, toDate, todayIST } from './dates';
import { Dec, D } from './money';
import { Tx } from './prisma.service';
import { SettingsService } from './settings.service';

/** Cross-cutting business rules shared by every daily-operations module (LLD s10). */
@Injectable()
export class RulesService {
  constructor(private readonly settings: SettingsService) {}

  /** V2: business_date <= today (IST) and >= today - entry.backdate_days for non-owners. */
  async assertBusinessDate(user: AuthUser, dateStr: string, field = 'businessDate'): Promise<Date> {
    const date = toDate(dateStr, field);
    const today = toDate(todayIST());
    if (date.getTime() > today.getTime()) {
      throw validation('DATE_OUT_OF_RANGE', 'The date cannot be in the future', field);
    }
    if (!isOwner(user)) {
      const backdate = await this.settings.getNumber('entry.backdate_days');
      if (date.getTime() < addDays(today, -backdate).getTime()) {
        throw validation('DATE_OUT_OF_RANGE', `Entries can be back-dated by at most ${backdate} days`, field);
      }
    }
    return date;
  }

  /**
   * V3: a branch-day whose closing is APPROVED is locked (409 DAY_LOCKED). While SUBMITTED, only users
   * who can approve closings may still change the day; branch users must wait for a rejection.
   */
  async assertDayEditable(tx: Tx, user: AuthUser, locationId: string, date: Date): Promise<void> {
    const closing = await tx.dailyClosing.findUnique({
      where: { location_id_business_date: { location_id: locationId, business_date: date } },
      select: { status: true },
    });
    if (!closing) return;
    if (closing.status === 'APPROVED') {
      throw new AppException(409, 'DAY_LOCKED', 'Day closed - ask the owner to reopen it');
    }
    if (closing.status === 'SUBMITTED' && !can(user, 'closing:approve')) {
      throw new AppException(
        409,
        'DAY_SUBMITTED',
        `${fmtDate(date)} is submitted for approval; it can be edited again if the owner rejects it`,
      );
    }
  }

  /**
   * Highest approval limit the caller holds for an entity type, or null for unlimited (Owner).
   * Limits are data (approval_limits), configurable per role.
   */
  async approvalLimit(tx: Tx, user: AuthUser, entityType: string): Promise<Dec | null> {
    if (isOwner(user)) return null;
    const rows = await tx.approvalLimit.findMany({
      where: { entity_type: entityType, role_id: { in: await this.roleIds(tx, user) } },
      select: { max_amount: true },
    });
    return rows.reduce<Dec>((max, r) => (r.max_amount.greaterThan(max) ? r.max_amount : max), D(0));
  }

  private async roleIds(tx: Tx, user: AuthUser): Promise<string[]> {
    const roles = await tx.role.findMany({ where: { code: { in: user.roles } }, select: { id: true } });
    return roles.map((r) => r.id);
  }

  /** True when the caller's limit covers the amount (null = unlimited). */
  withinLimit(limit: Dec | null, amount: Dec): boolean {
    return limit === null || amount.lessThanOrEqualTo(limit);
  }
}
