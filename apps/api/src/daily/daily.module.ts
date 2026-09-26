import { Module } from '@nestjs/common';
import { CashService } from './cash.service';
import { ClosingsService } from './closings.service';
import { CashController, ClosingsController, SalesController } from './daily.controller';
import { SalesService } from './sales.service';

@Module({
  controllers: [SalesController, CashController, ClosingsController],
  providers: [SalesService, CashService, ClosingsService],
  exports: [SalesService, CashService, ClosingsService],
})
export class DailyModule {}
