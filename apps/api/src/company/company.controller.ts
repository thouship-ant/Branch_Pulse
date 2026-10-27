import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { AppException } from '../common/app-exception';
import { CompanyService, CreateCompanyDto, UpdateCompanyDto } from './company.service';
import { DataUploadDto, LedgerImportService } from './ledger-import.service';

const MAX_UPLOAD = 5 * 1024 * 1024; // 5 MB: a ledger workbook is far smaller

/** Super Admin area: companies and the Excel data upload. Every route needs company:manage, which only Super Admin holds. */
@Controller('super')
@RequirePermissions('company:manage')
export class CompanyController {
  constructor(
    private readonly companies: CompanyService,
    private readonly importer: LedgerImportService,
  ) {}

  @Get('companies')
  list(@Ctx() ctx: ReqCtx) {
    return this.companies.list(ctx);
  }

  @Post('companies')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateCompanyDto) {
    return this.companies.create(ctx, dto);
  }

  @Patch('companies/:id')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(ctx, id, dto);
  }

  @Get('companies/:id/branches')
  branches(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.companies.branches(ctx, id);
  }

  /** The sample workbook the upload expects (same layout as a real ledger). */
  @Get('sample-ledger')
  sample(@Res() res: Response) {
    const candidates = [join(__dirname, '..', '..', 'assets', 'tea_shop_ledger_sample.xlsx'), join(process.cwd(), 'assets', 'tea_shop_ledger_sample.xlsx'), join(process.cwd(), 'apps', 'api', 'assets', 'tea_shop_ledger_sample.xlsx')];
    const file = candidates.find((p) => existsSync(p));
    if (!file) throw new AppException(404, 'NOT_FOUND', 'The sample file is not installed on this server');
    res.setHeader('Content-Disposition', 'attachment; filename="tea_shop_ledger_sample.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.sendFile(file);
  }

  /** multipart: file + companyId + branchId (an id or NEW) [+ new branch fields] [+ dryRun=true to preview only] */
  @Post('data-upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  upload(@Ctx() ctx: ReqCtx, @Body() dto: DataUploadDto, @UploadedFile() file?: { buffer: Buffer; originalname: string; size: number }) {
    if (!file) throw new AppException(422, 'FILE_REQUIRED', 'Choose an Excel (.xlsx) file to upload', [{ field: 'file', message: 'Choose an Excel (.xlsx) file' }]);
    if (!/\.xlsx$/i.test(file.originalname)) throw new AppException(422, 'INVALID_FILE', 'Only .xlsx files can be uploaded', [{ field: 'file', message: 'Only .xlsx files' }]);
    return this.importer.run(ctx, dto, file.buffer);
  }
}
