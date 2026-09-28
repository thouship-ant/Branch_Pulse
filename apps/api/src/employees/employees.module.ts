import { Module } from '@nestjs/common';
import { AdvanceController, AttendanceController, EmployeesController, SalaryController } from './employees.controller';
import { AdvanceService } from './advance.service';
import { AttendanceService } from './attendance.service';
import { EmployeesService } from './employees.service';
import { SalaryService } from './salary.service';

@Module({
  controllers: [EmployeesController, AttendanceController, SalaryController, AdvanceController],
  providers: [EmployeesService, AttendanceService, SalaryService, AdvanceService],
})
export class EmployeesModule {}
