import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { CashService, CashTxnDto, ReconciliationDto } from './cash.service';
import { ClosingsService, ReviewDto, SubmitClosingDto } from './closings.service';
import { SalesDto, SalesService } from './sales.service';

@Controller('daily-sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get() @RequirePermissions('sales:view')
  get(@Ctx() ctx: ReqCtx, @Query('locationId', ParseUUIDPipe) locationId: string, @Query('date') date: string) {
    return this.sales.get(ctx, locationId, date);
  }

  @Put() @RequirePermissions('sales:enter')
  put(
    @Ctx() ctx: ReqCtx,
    @Query('locationId', ParseUUIDPipe) locationId: string,
    @Query('date') date: string,
    @Body() dto: SalesDto,
  ) {
    return this.sales.upsert(ctx, locationId, date, dto);
  }
}

@Controller('cash')
export class CashController {
  constructor(
    private readonly cash: CashService,
    private readonly closings: ClosingsService,
  ) {}

  @Get('transactions') @RequirePermissions('cash:view')
  listTxns(@Ctx() ctx: ReqCtx, @Query('locationId', ParseUUIDPipe) locationId: string, @Query('date') date: string) {
    return this.cash.listTxns(ctx, locationId, date);
  }

  @Post('transactions') @RequirePermissions('cash:enter')
  createTxn(@Ctx() ctx: ReqCtx, @Body() dto: CashTxnDto) {
    return this.cash.createTxn(ctx, dto);
  }

  @Get('reconciliation/:locationId/:date') @RequirePermissions('cash:view')
  getRecon(@Ctx() ctx: ReqCtx, @Param('locationId', ParseUUIDPipe) locationId: string, @Param('date') date: string) {
    return this.cash.get(ctx, locationId, date);
  }

  @Put('reconciliation/:locationId/:date') @RequirePermissions('cash:enter')
  saveRecon(
    @Ctx() ctx: ReqCtx,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Param('date') date: string,
    @Body() dto: ReconciliationDto,
  ) {
    return this.cash.save(ctx, locationId, date, dto);
  }

  @Post('reconciliation/:id/approve') @HttpCode(200) @RequirePermissions('cash:approve')
  approveVariance(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.closings.approveVariance(ctx, id);
  }

  @Post('reconciliation/:id/reject') @HttpCode(200) @RequirePermissions('cash:approve')
  rejectVariance(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.closings.rejectVariance(ctx, id, dto);
  }
}

@Controller('closings')
export class ClosingsController {
  constructor(private readonly closings: ClosingsService) {}

  @Get() @RequirePermissions('closing:view')
  board(@Ctx() ctx: ReqCtx, @Query('date') date: string, @Query('status') status?: string) {
    return this.closings.board(ctx, date, status);
  }

  // literal ":id/events" must be declared before the two-segment ":locationId/:date"
  @Get(':id/events') @RequirePermissions('closing:view')
  events(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.closings.events(ctx, id);
  }

  @Get(':locationId/:date') @RequirePermissions('closing:view')
  screen(@Ctx() ctx: ReqCtx, @Param('locationId', ParseUUIDPipe) locationId: string, @Param('date') date: string) {
    return this.closings.screen(ctx, locationId, date);
  }

  @Post(':id/submit') @HttpCode(200) @RequirePermissions('closing:submit')
  submit(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitClosingDto) {
    return this.closings.submit(ctx, id, dto);
  }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('closing:approve')
  approve(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.closings.approve(ctx, id, dto);
  }

  @Post(':id/reject') @HttpCode(200) @RequirePermissions('closing:approve')
  reject(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.closings.reject(ctx, id, dto);
  }

  @Post(':id/reopen') @HttpCode(200) @RequirePermissions('closing:reopen')
  reopen(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.closings.reopen(ctx, id, dto);
  }
}
