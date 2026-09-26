import { Controller, Get, Param, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { InsightsService } from './insights.service';

@Controller()
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('dashboard/summary') @RequirePermissions('dashboard:view')
  summary(@Ctx() ctx: ReqCtx, @Query('date') date?: string, @Query('locationIds') locationIds?: string) {
    return this.insights.summary(ctx, date, locationIds);
  }

  @Get('dashboard/charts/:code') @RequirePermissions('dashboard:view')
  chart(@Ctx() ctx: ReqCtx, @Param('code') code: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.insights.chart(ctx, code, from, to);
  }

  @Get('exceptions') @RequirePermissions('alert:view')
  exceptions(@Ctx() ctx: ReqCtx) {
    return this.insights.exceptions(ctx);
  }
}
