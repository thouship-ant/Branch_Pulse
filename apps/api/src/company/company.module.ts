import { Module } from '@nestjs/common';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { LedgerImportService } from './ledger-import.service';

@Module({
  controllers: [CompanyController],
  providers: [CompanyService, LedgerImportService],
})
export class CompanyModule {}
