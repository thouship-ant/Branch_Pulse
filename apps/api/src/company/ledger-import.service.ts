import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { CodesService } from '../common/codes.service';
import { toDate } from '../common/dates';
import { D, ZERO, sum } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { CompanyService } from './company.service';
import { parseLedger } from './ledger-parser';

const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class DataUploadDto {
  @IsUUID() companyId: string;
  /** an existing branch id, or NEW to create one from the fields below */
  @IsString() branchId: string;
  @IsOptional() @IsString() @MaxLength(100) newBranchName?: string;
  @IsOptional() @IsString() @MaxLength(500) newBranchAddress?: string;
  @IsOptional() @IsString() @MaxLength(100) managerName?: string;
  @IsOptional() @Matches(/^\d{10}$/, { message: 'Manager mobile must be 10 digits' }) managerMobile?: string;
  /** true: check the file and report what would happen, change nothing */
  @IsOptional() @Transform(bool) @IsBoolean() dryRun?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * "Company - Data Upload": turns a ledger workbook into live records for one company's branch. Everything lands as a
 * normal, pending record (expenses waiting for approval, advance requests) so the company's own approval rules still apply.
 */
@Injectable()
export class LedgerImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodesService,
    private readonly settings: SettingsService,
  ) {}

  async run(ctx: ReqCtx, dto: DataUploadDto, file: Buffer) {
    const write = !dto.dryRun;
    let parsed;
    try {
      parsed = await parseLedger(file);
    } catch (e) {
      throw validation('INVALID_FILE', (e as Error).message, 'file');
    }
    const errors = [...parsed.errors];
    const warnings = [...parsed.warnings];

    return this.prisma.runScoped(ctx.user, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: dto.companyId } });
      if (!company) throw notFound('Company');

      // ---- which branch
      const isNew = dto.branchId === 'NEW';
      let branch: { id: string; code: string; name: string; default_opening_cash: Prisma.Decimal } | null = null;
      if (!isNew) {
        branch = await tx.location.findFirst({
          where: { id: dto.branchId, company_id: company.id, type: 'BRANCH' },
          select: { id: true, code: true, name: true, default_opening_cash: true },
        });
        if (!branch) throw validation('INVALID_BRANCH', 'Choose one of this company\'s branches', 'branchId');
      } else {
        if (!dto.newBranchName?.trim()) throw validation('BRANCH_NAME_REQUIRED', 'Enter the branch name', 'newBranchName');
        if (!dto.newBranchAddress?.trim()) throw validation('BRANCH_ADDRESS_REQUIRED', 'Enter the branch address', 'newBranchAddress');
        if (!dto.managerName?.trim()) throw validation('MANAGER_NAME_REQUIRED', "Enter the manager's name", 'managerName');
        if (!dto.managerMobile) throw validation('MANAGER_MOBILE_REQUIRED', "Enter the manager's mobile number", 'managerMobile');
        if (await tx.user.findFirst({ where: { OR: [{ mobile: dto.managerMobile }, { username: dto.managerMobile }] }, select: { id: true } })) {
          throw validation('DUPLICATE_MOBILE', 'This mobile number is already registered', 'managerMobile');
        }
      }

      // ---- master data of the company the rows are matched against
      const cats = await tx.expenseCategory.findMany({ where: { company_id: company.id, status: 'ACTIVE' } });
      const top = new Map(cats.filter((c) => !c.parent_id).map((c) => [norm(c.name_en), c]));
      const misc = top.get('miscellaneous');
      const subsOf = (parentId: string) => new Map(cats.filter((c) => c.parent_id === parentId).map((c) => [norm(c.name_en), c]));

      // ---- days that are already approved cannot take new rows
      const dates = [...new Set([...parsed.expenses.map((e) => e.date), ...parsed.staff.map((s) => s.date), ...(parsed.ledgerDate ? [parsed.ledgerDate] : [])])];
      const locked = new Set<string>();
      if (branch && dates.length) {
        const rows = await tx.dailyClosing.findMany({ where: { location_id: branch.id, status: 'APPROVED', business_date: { in: dates.map((d) => toDate(d)) } }, select: { business_date: true } });
        for (const r of rows) locked.add(r.business_date.toISOString().slice(0, 10));
      }

      // ---- rows already imported from this file (same marker) are skipped, so uploading twice is safe
      const seenExpense = new Set<string>();
      const seenAdvance = new Set<string>();
      if (branch) {
        const ex = await tx.expense.findMany({ where: { location_id: branch.id, description: { contains: '[Import ' } }, select: { description: true } });
        for (const e of ex) seenExpense.add(/\[Import ([^\]]+)\]/.exec(e.description ?? '')?.[1] ?? '');
        const adv = await tx.employeeAdvance.findMany({ where: { location_id: branch.id, reason: { contains: '[Import ' } }, select: { reason: true } });
        for (const a of adv) seenAdvance.add(/\[Import ([^\]]+)\]/.exec(a.reason)?.[1] ?? '');
      }

      // ---- create the branch (and its manager) first when asked
      if (isNew && write) {
        branch = await this.createBranch(tx, ctx, company.id, dto, parsed.ledgerDate, parsed.closing.openingCash);
      }

      // ---- expenses
      const expenseRows: Array<{ row: number; date: string; category: string; subCategory: string; amount: string; mode: string; description: string; note?: string }> = [];
      let expenseSkipped = 0;
      for (const e of parsed.expenses) {
        const marker = `${e.date}|${e.sourceId}`;
        if (locked.has(e.date)) { errors.push({ sheet: 'Expenses', row: e.row, message: `${e.date} is already approved for this branch (reopen the day first)` }); continue; }
        if (seenExpense.has(marker)) { expenseSkipped++; continue; }

        let cat = top.get(norm(e.category));
        let note: string | undefined;
        if (!cat) {
          cat = misc;
          note = `Category "${e.category}" not found: imported as Miscellaneous`;
          warnings.push({ sheet: 'Expenses', row: e.row, message: note });
        }
        if (!cat) { errors.push({ sheet: 'Expenses', row: e.row, message: `Category "${e.category}" not found and the company has no Miscellaneous category` }); continue; }
        const sub = e.subCategory ? subsOf(cat.id).get(norm(e.subCategory)) : undefined;
        const description = [e.description || e.subCategory, `[Import ${marker}]`].filter(Boolean).join(' ');
        expenseRows.push({ row: e.row, date: e.date, category: cat.name_en, subCategory: sub?.name_en ?? e.subCategory, amount: e.amount, mode: e.paymentMode, description: description.replace(/ \[Import .*$/, ''), note });

        if (write && branch) {
          await tx.expense.create({
            data: {
              code: await this.codes.next(tx, 'expense', branch.id), location_id: branch.id, business_date: toDate(e.date), category_id: cat.id,
              sub_category_id: sub?.id ?? null, amount: D(e.amount), payment_mode: e.paymentMode, payee_name: e.payee || null, description,
              approval_status: 'SUBMITTED', entered_by: ctx.user.id, source: 'SYSTEM', created_by: ctx.user.id, updated_by: ctx.user.id,
            },
          });
        }
      }

      // ---- staff payments -> advance requests (employee records are created for names not on file)
      const staffRows: Array<{ row: number; date: string; name: string; amount: string; isNewEmployee: boolean }> = [];
      const newEmployees = new Set<string>();
      let staffSkipped = 0;
      if (parsed.staff.length) {
        const emps = branch ? await tx.employee.findMany({ where: { location_id: branch.id } }) : [];
        const byName = new Map(emps.map((x) => [norm(x.full_name), x]));
        for (const s of parsed.staff) {
          const marker = `${s.date}|${s.sourceId}`;
          if (locked.has(s.date)) { errors.push({ sheet: 'Staff_Payments', row: s.row, message: `${s.date} is already approved for this branch` }); continue; }
          if (seenAdvance.has(marker)) { staffSkipped++; continue; }
          let emp = byName.get(norm(s.name));
          const isNewEmployee = !emp;
          if (isNewEmployee) newEmployees.add(s.name);
          staffRows.push({ row: s.row, date: s.date, name: s.name, amount: s.amount, isNewEmployee });
          if (write && branch) {
            if (!emp) {
              emp = await tx.employee.create({
                data: {
                  code: await this.employeeCode(tx), full_name: s.name.slice(0, 100), location_id: branch.id, job_role: 'Staff', joining_date: toDate(s.date),
                  salary_type: 'DAILY', base_salary: ZERO, payment_method: 'CASH', created_by: ctx.user.id, updated_by: ctx.user.id,
                },
              });
              byName.set(norm(s.name), emp);
            }
            await tx.employeeAdvance.create({
              data: {
                code: await this.codes.next(tx, 'advance', branch.id), employee_id: emp.id, location_id: branch.id, request_date: toDate(s.date), amount: D(s.amount),
                reason: [s.notes || 'Staff payment from ledger', `[Import ${marker}]`].join(' '), status: 'REQUESTED', requested_by: ctx.user.id,
                created_by: ctx.user.id, updated_by: ctx.user.id,
              },
            });
          }
        }
      }

      // ---- the day's opening cash and (when filled in) sales
      const c = parsed.closing;
      let salesImported: { date: string; total: string } | null = null;
      if (c.totalSales && Number(c.totalSales) > 0) {
        const date = parsed.ledgerDate;
        const parts = sum([c.cashSales, c.upiSales, c.cardSales, c.creditSales].map((x) => D(x ?? 0)));
        if (!date) errors.push({ sheet: 'Daily_Closing', row: 0, message: 'Sales are filled in but README has no ledger date' });
        else if (!parts.equals(D(c.totalSales))) errors.push({ sheet: 'Daily_Closing', row: 0, message: `Total sales ${c.totalSales} does not equal cash + UPI + card + credit (${parts.toFixed(2)})` });
        else if (locked.has(date)) errors.push({ sheet: 'Daily_Closing', row: 0, message: `${date} is already approved for this branch` });
        else if (branch && (await tx.dailySales.findFirst({ where: { location_id: branch.id, business_date: toDate(date), status: 'ACTIVE' }, select: { id: true } }))) {
          warnings.push({ sheet: 'Daily_Closing', row: 0, message: `Sales for ${date} already exist: not changed` });
        } else {
          salesImported = { date, total: c.totalSales };
          if (write && branch) {
            await tx.dailySales.create({
              data: {
                location_id: branch.id, business_date: toDate(date), total_sales: D(c.totalSales), cash_sales: D(c.cashSales ?? 0), upi_sales: D(c.upiSales ?? 0),
                card_sales: D(c.cardSales ?? 0), credit_sales: D(c.creditSales ?? 0), submitted_by: ctx.user.id, submitted_at: new Date(), source: 'SYSTEM',
                created_by: ctx.user.id, updated_by: ctx.user.id,
              },
            });
          }
        }
      }
      let openingApplied = false;
      if (c.openingCash && branch && !isNew) {
        const hasHistory = await tx.cashReconciliation.findFirst({ where: { location_id: branch.id }, select: { id: true } });
        if (!hasHistory && branch.default_opening_cash.isZero()) {
          openingApplied = true;
          if (write) await tx.location.update({ where: { id: branch.id }, data: { default_opening_cash: D(c.openingCash), updated_by: ctx.user.id, version: { increment: 1 } } });
        }
      } else if (c.openingCash && isNew) openingApplied = true; // set when the branch is created

      const expenseTotal = sum(expenseRows.map((r) => D(r.amount)));
      const staffTotal = sum(staffRows.map((r) => D(r.amount)));
      const nothing = expenseRows.length === 0 && staffRows.length === 0 && !salesImported;

      if (write && !errors.length && !nothing) {
        await this.audit.log(tx, ctx, {
          action: 'CREATE', entityType: 'DATA_IMPORT', entityCode: company.code, companyId: company.id, locationId: branch?.id ?? null,
          after: { branch: branch?.code, expenses: expenseRows.length, advances: staffRows.length, newEmployees: [...newEmployees], sales: salesImported },
        });
      }
      if (write && errors.length) {
        // nothing is half-imported: any error rolls the whole upload back
        throw new AppException(422, 'IMPORT_HAS_ERRORS', `${errors.length} row(s) have problems. Fix the file and upload again.`, errors);
      }

      return {
        dryRun: !write,
        company: { id: company.id, code: company.code, name: company.name },
        branch: branch ? { id: branch.id, code: branch.code, name: branch.name, isNew } : { id: null, code: null, name: dto.newBranchName?.trim() ?? '', isNew: true },
        ledgerDate: parsed.ledgerDate,
        expenses: { count: expenseRows.length, total: expenseTotal.toFixed(2), skipped: expenseSkipped, rows: expenseRows.slice(0, 100) },
        staff: { count: staffRows.length, total: staffTotal.toFixed(2), skipped: staffSkipped, newEmployees: [...newEmployees], rows: staffRows.slice(0, 100) },
        opening: { cash: c.openingCash, applied: openingApplied },
        sales: salesImported,
        errors,
        warnings,
      };
    });
  }

  // ------------------------------------------------------------------ helpers
  private async employeeCode(tx: Tx) {
    const rows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('seq_code_employee') AS n`);
    return `EMP${String(rows[0].n).padStart(6, '0')}`;
  }

  /** New branch plus its manager (a Branch Manager user that signs in with OTP on the given mobile). */
  private async createBranch(tx: Tx, ctx: ReqCtx, companyId: string, dto: DataUploadDto, ledgerDate: string | null, openingCash: string | null) {
    const prefix = String(await this.settings.get('branch.code_prefix', companyId)).toUpperCase();
    const existing = await tx.location.findMany({ where: { company_id: companyId, code: { startsWith: prefix } }, select: { code: true } });
    const re = new RegExp(`^${prefix}(\\d+)$`);
    const max = existing.reduce((m, l) => Math.max(m, Number(re.exec(l.code)?.[1] ?? 0)), 0);

    const role = await tx.role.findFirst({ where: { company_id: companyId, code: 'BRANCH_MANAGER' } });
    if (!role) throw validation('NO_MANAGER_ROLE', 'This company has no Branch Manager role', 'managerMobile');

    const loc = await tx.location.create({
      data: {
        company_id: companyId, code: `${prefix}${String(max + 1).padStart(3, '0')}`, name: dto.newBranchName!.trim(), type: 'BRANCH',
        address: dto.newBranchAddress!.trim(), opened_on: ledgerDate ? toDate(ledgerDate) : null,
        default_opening_cash: openingCash ? D(openingCash) : D(0), created_by: ctx.user.id, updated_by: ctx.user.id,
      },
    });
    const manager = await tx.user.create({
      data: {
        company_id: companyId, username: dto.managerMobile!, mobile: dto.managerMobile!, full_name: dto.managerName!.trim(),
        password_hash: await CompanyService.randomPasswordHash(), created_by: ctx.user.id, updated_by: ctx.user.id,
        roles: { create: [{ role_id: role.id }] }, locations: { create: [{ location_id: loc.id }] },
      },
    });
    await tx.location.update({ where: { id: loc.id }, data: { manager_user_id: manager.id } });
    await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'LOCATION', entityId: loc.id, entityCode: loc.code, companyId, locationId: loc.id, after: { ...loc, manager: manager.full_name } });
    return { id: loc.id, code: loc.code, name: loc.name, default_opening_cash: loc.default_opening_cash };
  }
}

