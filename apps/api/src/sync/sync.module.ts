import { Module } from '@nestjs/common';
import { DailyModule } from '../daily/daily.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [DailyModule, ExpensesModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
