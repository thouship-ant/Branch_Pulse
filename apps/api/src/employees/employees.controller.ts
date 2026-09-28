import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { AdjustSalaryDto, ComputeLocationSalaryDto, ComputeSalaryDto, ListSalaryQuery, PaySalaryDto, SalaryService } from './salary.service';
import { AdvanceActionDto, AdvanceService, ListAdvanceQuery, PayAdvanceDto, RepayAdvanceDto, RequestAdvanceDto } from './advance.service';
import { AttendanceHistoryQuery, AttendanceService, MarkAttendanceDto, RosterQuery } from './attendance.service';
import { CreateEmployeeDto, EmployeesService, ListEmployeesQuery, UpdateEmployeeDto } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly svc: EmployeesService) {}

  @Get() @RequirePermissions('staff:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListEmployeesQuery) {
    return this.svc.list(ctx, q);
  }

  @Get(':id') @RequirePermissions('staff:view')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/bank-details') @RequirePermissions('staff:manage')
  bankDetails(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.bankDetails(ctx, id);
  }

  @Post() @RequirePermissions('staff:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateEmployeeDto) {
    return this.svc.create(ctx, dto);
  }

  @Patch(':id') @RequirePermissions('staff:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.svc.update(ctx, id, dto);
  }
}

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Get('roster') @RequirePermissions('attendance:view')
  roster(@Ctx() ctx: ReqCtx, @Query() q: RosterQuery) {
    return this.svc.roster(ctx, q);
  }

  @Get('history') @RequirePermissions('attendance:view')
  history(@Ctx() ctx: ReqCtx, @Query() q: AttendanceHistoryQuery) {
    return this.svc.history(ctx, q);
  }

  @Put() @RequirePermissions('attendance:mark')
  mark(@Ctx() ctx: ReqCtx, @Body() dto: MarkAttendanceDto) {
    return this.svc.mark(ctx, dto);
  }
}

@Controller('salary')
export class SalaryController {
  constructor(private readonly svc: SalaryService) {}

  @Get() @RequirePermissions('salary:manage')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListSalaryQuery) {
    return this.svc.list(ctx, q);
  }

  @Get(':id') @RequirePermissions('salary:manage')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post('compute') @RequirePermissions('salary:manage')
  compute(@Ctx() ctx: ReqCtx, @Body() dto: ComputeSalaryDto) {
    return this.svc.compute(ctx, dto);
  }

  @Post('compute-location') @RequirePermissions('salary:manage')
  computeForLocation(@Ctx() ctx: ReqCtx, @Body() dto: ComputeLocationSalaryDto) {
    return this.svc.computeForLocation(ctx, dto);
  }

  @Patch(':id/adjust') @RequirePermissions('salary:manage')
  adjust(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustSalaryDto) {
    return this.svc.adjust(ctx, id, dto);
  }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('salary:approve')
  approve(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(ctx, id);
  }

  @Post(':id/pay') @HttpCode(200) @RequirePermissions('salary:pay')
  pay(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaySalaryDto) {
    return this.svc.pay(ctx, id, dto);
  }
}

@Controller('advances')
export class AdvanceController {
  constructor(private readonly svc: AdvanceService) {}

  @Get() @RequirePermissions('advance:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListAdvanceQuery) {
    return this.svc.list(ctx, q);
  }

  @Get(':id') @RequirePermissions('advance:view')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post() @RequirePermissions('advance:request')
  request(@Ctx() ctx: ReqCtx, @Body() dto: RequestAdvanceDto) {
    return this.svc.request(ctx, dto);
  }

  @Post(':id/manager-approve') @HttpCode(200) @RequirePermissions('advance:manager_approve')
  managerApprove(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.managerApprove(ctx, id);
  }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('advance:approve')
  finalApprove(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.finalApprove(ctx, id);
  }

  @Post(':id/reject') @HttpCode(200) @RequirePermissions('advance:view')
  reject(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdvanceActionDto) {
    return this.svc.reject(ctx, id, dto);
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('advance:request')
  cancel(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdvanceActionDto) {
    return this.svc.cancel(ctx, id, dto);
  }

  @Post(':id/pay') @HttpCode(200) @RequirePermissions('advance:pay')
  pay(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayAdvanceDto) {
    return this.svc.pay(ctx, id, dto);
  }

  @Post(':id/repay') @HttpCode(200) @RequirePermissions('advance:pay')
  repay(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RepayAdvanceDto) {
    return this.svc.repay(ctx, id, dto);
  }
}
