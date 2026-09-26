import { Controller, Get, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { InsightsService } from './insights.service';

@Controller()
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('dashboard/summary') @RequirePermissions('dashboard:view')
  summary(@Ctx() ctx: ReqCtx, @Query('date') date?: string, @Query('locationIds') locationIds?: string) {
    return this.insights.summary(ctx, date, locationIds);
  }

  @Get('exceptions') @RequirePermissions('alert:view')
  exceptions(@Ctx() ctx: ReqCtx) {
    return this.insights.exceptions(ctx);
  }
}
