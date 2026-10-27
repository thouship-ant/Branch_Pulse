import { Injectable } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AppException, notFound, validation } from '../common/app-exception';
import { AuditService } from '../common/audit.service';
import { ReqCtx } from '../common/auth-user';
import { D } from '../common/money';
import { PrismaService } from '../common/prisma.service';

const FACTOR_RE = /^\d{1,8}(\.\d{1,6})?$/;

export class CreateUnitDto {
  @IsString() @MaxLength(10) code: string;
  @IsString() @MaxLength(30) name: string;
  // omitted = this is a base unit (ml, g, pcs); the factor converts one of this unit into that many base units
  @IsOptional() @IsUUID() baseUnitId?: string;
  @IsOptional() @Matches(FACTOR_RE) factorToBase?: string;
}

export class UpdateUnitDto {
  @IsOptional() @IsString() @MaxLength(30) name?: string;
  @IsOptional() @Matches(FACTOR_RE) factorToBase?: string;
}

/** Units of measure (LLD s2 settings). Conversions are applied at write time and snapshotted onto each record,
 * so editing a unit's factor only changes future entries, never past ones. */
@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.unit.findMany({ orderBy: { code: 'asc' } });
  }

  async create(ctx: ReqCtx, dto: CreateUnitDto) {
    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();
    if (!code || !name) throw validation('NAME_REQUIRED', 'Enter a code and name', 'code');
    return this.prisma.runCurrent(async (tx) => {
      if (await tx.unit.findUnique({ where: { code } })) throw new AppException(409, 'DUPLICATE_UNIT', 'A unit with this code already exists');
      let baseUnitId: string | null = null;
      if (dto.baseUnitId) {
        const base = await tx.unit.findUnique({ where: { id: dto.baseUnitId } });
        if (!base || base.base_unit_id) throw validation('INVALID_UNIT', 'The base unit must itself be a base unit', 'baseUnitId');
        baseUnitId = base.id;
      }
      const unit = await tx.unit.create({
        data: { code, name, base_unit_id: baseUnitId, factor_to_base: baseUnitId ? D(dto.factorToBase ?? '1') : D(1) },
      });
      await this.audit.log(tx, ctx, { action: 'CREATE', entityType: 'UNIT', entityId: unit.id, entityCode: unit.code, after: unit });
      return unit;
    });
  }

  async update(ctx: ReqCtx, id: string, dto: UpdateUnitDto) {
    return this.prisma.runCurrent(async (tx) => {
      const before = await tx.unit.findUnique({ where: { id } });
      if (!before) throw notFound('Unit');
      if (dto.factorToBase !== undefined && !before.base_unit_id) throw validation('INVALID_UNIT', 'A base unit always has a factor of 1', 'factorToBase');
      const after = await tx.unit.update({
        where: { id },
        data: { name: dto.name?.trim() || undefined, factor_to_base: dto.factorToBase !== undefined ? D(dto.factorToBase) : undefined },
      });
      await this.audit.log(tx, ctx, { action: 'UPDATE', entityType: 'UNIT', entityId: id, entityCode: after.code, before, after });
      return after;
    });
  }
}
