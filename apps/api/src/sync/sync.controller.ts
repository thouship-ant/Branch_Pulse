import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Ctx, ReqCtx } from '../common/auth-user';
import { SyncBatchDto, SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('bootstrap')
  bootstrap(@Ctx() ctx: ReqCtx, @Query('locationId') locationId?: string) {
    return this.sync.bootstrap(ctx, locationId);
  }

  // permission is checked per operation inside the service
  @Post('batch') @HttpCode(200)
  batch(@Ctx() ctx: ReqCtx, @Body() dto: SyncBatchDto) {
    return this.sync.batch(ctx, dto);
  }
}
