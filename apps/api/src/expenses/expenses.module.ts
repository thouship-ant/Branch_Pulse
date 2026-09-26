import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpenseReportService } from './expense-report.service';
import { ExpensesService } from './expenses.service';

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseReportService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
