import { Injectable } from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { toDate } from '../common/dates';
import { CryptoService } from '../common/crypto.service';
import { D, parseMoney } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';

const SALARY_TYPES = ['MONTHLY', 'DAILY'] as const;
const PAY_METHODS = ['CASH', 'BANK', 'UPI'] as const;

export class BankDetailsDto {
  @IsOptional() @IsString() @MaxLength(40) accountHolder?: string;
  @IsOptional() @IsString() @MaxLength(24) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(15) ifsc?: string;
  @IsOptional() @IsString() @MaxLength(60) upiId?: string;
}

export class CreateEmployeeDto {
  @IsString() @MaxLength(100) fullName: string;
  @IsUUID() locationId: string;
  @IsString() @MaxLength(40) jobRole: string;
  @IsOptional() @IsString() @MaxLength(15) phone?: string;
  @IsString() joiningDate: string;
  @IsEnum(SALARY_TYPES) salaryType: (typeof SALARY_TYPES)[number];
  @IsString() baseSalary: string;
  @IsOptional() @IsString() overtimeRatePerHour?: string;
  @IsOptional() @IsEnum(PAY_METHODS) paymentMethod?: (typeof PAY_METHODS)[number];
  @ValidateIf((o) => o.paymentMethod === 'BANK' || o.paymentMethod === 'UPI') bankDetails?: BankDetailsDto;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MaxLength(100) fullName?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() @MaxLength(40) jobRole?: string;
  @IsOptional() @IsString() @MaxLength(15) phone?: string;
  @IsOptional() @IsString() exitDate?: string | null;
  @IsOptional() @IsEnum(SALARY_TYPES) salaryType?: (typeof SALARY_TYPES)[number];
  @IsOptional() @IsString() baseSalary?: string;
  @IsOptional() @IsString() overtimeRatePerHour?: string;
  @IsOptional() @IsEnum(PAY_METHODS) paymentMethod?: (typeof PAY_METHODS)[number];
  @IsOptional() bankDetails?: BankDetailsDto;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListEmployeesQuery {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() includeInactive?: string;
  @IsOptional() @IsString() q?: string;
}

/** Employee master data: name, branch, role, pay terms and (encrypted) bank details. No recruitment workflow - just the record. */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  private async nextCode(tx: Tx): Promise<string> {
    const rows = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('seq_code_employee') AS n`);
    return `EMP${String(rows[0].n).padStart(6, '0')}`;
  }

  private packBankDetails(dto?: BankDetailsDto): Buffer | null {
    if (!dto || !Object.values(dto).some((v) => v?.trim())) return null;
    return this.crypto.encrypt(JSON.stringify(dto));
  }

  private assertBankDetailsPresent(paymentMethod: string | null | undefined, hasBankDetails: boolean) {
    if ((paymentMethod === 'BANK' || paymentMethod === 'UPI') && !hasBankDetails) {
      throw validation('BANK_DETAILS_REQUIRED', 'Add bank/UPI details for this payment method', 'bankDetails');
    }
  }

  /** Never returned from list/get - only from this, behind staff:manage. */
  async bankDetails(ctx: ReqCtx, id: string): Promise<BankDetailsDto | null> {
    const row = await this.prisma.runScoped(ctx.user, (tx) => tx.employee.findUnique({ where: { id }, select: { bank_details_enc: true } }));
    if (!row) throw notFound('Employee');
    if (!row.bank_details_enc) return null;
    return JSON.parse(this.crypto.decrypt(row.bank_details_enc));
  }

  async list(ctx: ReqCtx, q: ListEmployeesQuery) {
    const search = q.q?.trim().toLowerCase();
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const rows = await tx.employee.findMany({
        where: {
          ...(q.includeInactive === 'true' ? {} : { status: 'ACTIVE' }),
          ...(q.locationId ? { location_id: q.locationId } : {}),
        },
        orderBy: { code: 'asc' },
      });
      const locs = await tx.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.location_id))] } }, select: { id: true, code: true, name: true, name_ta: true } });
      return rows
        .filter((r) => !search || `${r.full_name} ${r.code} ${r.job_role}`.toLowerCase().includes(search))
        .map((r) => {
          const { bank_details_enc, ...rest } = r;
          const loc = locs.find((l) => l.id === r.location_id);
          return { ...rest, hasBankDetails: !!bank_details_enc, locationCode: loc?.code, locationName: loc?.name, locationNameTa: loc?.name_ta };
        });
    });
  }

  async get(ctx: ReqCtx, id: string) {
    const row = await this.prisma.runScoped(ctx.user, (tx) => tx.employee.findUnique({ where: { id } }));
    if (!row) throw notFound('Employee');
    const { bank_details_enc, ...rest } = row;
    return { ...rest, hasBankDetails: !!bank_details_enc };
  }

  async create(ctx: ReqCtx, dto: CreateEmployeeDto) {
    const name = dto.fullName.trim();
    if (!name) throw validation('NAME_REQUIRED', 'Enter the employee name', 'fullName');
    const baseSalary = parseMoney(dto.baseSalary, 'baseSalary', { allowZero: false });
    const otRate = dto.overtimeRatePerHour ? parseMoney(dto.overtimeRatePerHour, 'overtimeRatePerHour') : D(0);
    const bankDetailsEnc = this.packBankDetails(dto.bankDetails);
    this.assertBankDetailsPresent(dto.paymentMethod, !!bankDetailsEnc);
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
      if (!loc || loc.status !== 'ACTIVE') throw validation('INVALID_LOCATION', 'Choose an active branch', 'locationId');
      const row = await tx.employee.create({
        data: {
          code: await this.nextCode(tx), full_name: name, location_id: dto.locationId, job_role: dto.jobRole.trim(),
          phone: dto.phone?.trim() || null, joining_date: toDate(dto.joiningDate, 'joiningDate'), salary_type: dto.salaryType,
          base_salary: baseSalary, overtime_rate_per_hour: otRate, payment_method: dto.paymentMethod ?? 'CASH',
          // Buffer is a Uint8Array at runtime; Prisma's generated Bytes type is just fussier about the generic than @types/node
          bank_details_enc: bankDetailsEnc as any,
          created_by: ctx.user.id, updated_by: ctx.user.id,
        },
      });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'EMPLOYEE', entityId: row.id, entityCode: row.code, locationId: row.location_id, after: { ...row, bank_details_enc: undefined } });
      const { bank_details_enc, ...rest } = row;
      return { ...rest, hasBankDetails: !!bank_details_enc };
    });
  }

  async update(ctx: ReqCtx, id: string, dto: UpdateEmployeeDto) {
    return this.prisma.runScoped(ctx.user, async (tx) => {
      const before = await tx.employee.findUnique({ where: { id } });
      if (!before) throw notFound('Employee');
      if (dto.locationId) {
        const loc = await tx.location.findUnique({ where: { id: dto.locationId } });
        if (!loc || loc.status !== 'ACTIVE') throw validation('INVALID_LOCATION', 'Choose an active branch', 'locationId');
      }
      const newBankDetailsEnc = dto.bankDetails ? this.packBankDetails(dto.bankDetails) : undefined;
      const paymentMethod = dto.paymentMethod ?? before.payment_method;
      const hasBankDetails = newBankDetailsEnc !== undefined ? !!newBankDetailsEnc : !!before.bank_details_enc;
      this.assertBankDetailsPresent(paymentMethod, hasBankDetails);
      const after = await tx.employee.update({
        where: { id },
        data: {
          full_name: dto.fullName?.trim() || undefined, location_id: dto.locationId, job_role: dto.jobRole?.trim(),
          phone: dto.phone === undefined ? undefined : dto.phone.trim() || null,
          exit_date: dto.exitDate === undefined ? undefined : dto.exitDate ? toDate(dto.exitDate, 'exitDate') : null,
          salary_type: dto.salaryType, base_salary: dto.baseSalary ? parseMoney(dto.baseSalary, 'baseSalary', { allowZero: false }) : undefined,
          overtime_rate_per_hour: dto.overtimeRatePerHour ? parseMoney(dto.overtimeRatePerHour, 'overtimeRatePerHour') : undefined,
          payment_method: dto.paymentMethod,
          bank_details_enc: newBankDetailsEnc as any,
          status: dto.active === undefined ? undefined : dto.active ? 'ACTIVE' : 'INACTIVE',
          updated_by: ctx.user.id, version: { increment: 1 },
        },
      });
      await this.audit.log(tx, ctx, {
        action: 'UPDATE', entityType: 'EMPLOYEE', entityId: id, entityCode: after.code, locationId: after.location_id,
        before: { ...before, bank_details_enc: undefined }, after: { ...after, bank_details_enc: undefined },
      });
      const { bank_details_enc, ...rest } = after;
      return { ...rest, hasBankDetails: !!bank_details_enc };
    });
  }
}
