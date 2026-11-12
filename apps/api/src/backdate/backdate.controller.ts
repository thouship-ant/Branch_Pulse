import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { BackdateService, CreateBackdateDto, DecideBackdateDto } from './backdate.service';

@Controller('backdate-requests')
export class BackdateController {
  constructor(private readonly svc: BackdateService) {}

  /** Past days of a branch that were never closed, with the state of any request for them. */
  @Get('eligible') @RequirePermissions('closing:submit')
  eligible(@Ctx() ctx: ReqCtx, @Query('locationId', ParseUUIDPipe) locationId: string) { return this.svc.eligible(ctx, locationId); }

  @Get() @RequirePermissions('closing:view')
  list(@Ctx() ctx: ReqCtx, @Query('status') status?: string) { return this.svc.list(ctx, status); }

  @Post() @RequirePermissions('closing:submit')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateBackdateDto) { return this.svc.create(ctx, dto); }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('closing:reopen')
  approve(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideBackdateDto) { return this.svc.decide(ctx, id, true, dto); }

  @Post(':id/reject') @HttpCode(200) @RequirePermissions('closing:reopen')
  reject(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideBackdateDto) { return this.svc.decide(ctx, id, false, dto); }
}
