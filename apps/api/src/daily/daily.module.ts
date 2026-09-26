import { Module } from '@nestjs/common';
import { CashService } from './cash.service';
import { ClosingsService } from './closings.service';
import { CashController, ClosingsController, SalesController } from './daily.controller';
import { SalesService } from './sales.service';
import { VarianceReportService } from './variance-report.service';

@Module({
  controllers: [SalesController, CashController, ClosingsController],
  providers: [SalesService, CashService, ClosingsService, VarianceReportService],
  exports: [SalesService, CashService, ClosingsService],
})
export class DailyModule {}
