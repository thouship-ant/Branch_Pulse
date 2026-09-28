import { Controller, Get, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { ConsolidatedPLQuery, PLQuery, PLService } from './pl.service';

/** Management P&L - a management-accounting view, never a statutory return. */
@Controller('pl')
export class PLController {
  constructor(private readonly svc: PLService) {}

  @Get('branch') @RequirePermissions('pl:view')
  branch(@Ctx() ctx: ReqCtx, @Query() q: PLQuery) {
    return this.svc.branch(ctx, q);
  }

  @Get('consolidated') @RequirePermissions('pl:view')
  consolidated(@Ctx() ctx: ReqCtx, @Query() q: ConsolidatedPLQuery) {
    return this.svc.consolidated(ctx, q);
  }
}
