import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';
import { LedgerImportService } from './ledger-import.service';
import { SuperUsersService } from './super-users.service';

@Module({
  imports: [AuthModule],
  controllers: [CompanyController],
  providers: [CompanyService, LedgerImportService, SuperUsersService],
})
export class CompanyModule {}
