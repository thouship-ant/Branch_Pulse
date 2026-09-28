import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { CreateItemDto, ItemsService, ListItemsQuery, LocationSettingDto, UpdateItemDto } from './items.service';
import {
  ListCountsQuery, ReconciliationQuery, ReconciliationService, ReviewCountDto, SaveCountDto, SetConsumptionDto, VarianceReportQuery,
} from './reconciliation.service';
import { CreateTransferDto, ListTransfersQuery, ReceiveTransferDto, TransferActionDto, TransfersService } from './transfers.service';
import { CreateUnitDto, UnitsService, UpdateUnitDto } from './units.service';
import { CreateWastageDto, ListWastageQuery, WastageActionDto, WastageService, WastageSummaryQuery } from './wastage.service';

@Controller('items')
export class ItemsController {
  constructor(private readonly svc: ItemsService) {}

  @Get() @RequirePermissions('stock:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListItemsQuery) {
    return this.svc.list(ctx, q);
  }

  @Post() @RequirePermissions('item:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateItemDto) {
    return this.svc.create(ctx, dto);
  }

  @Patch(':id') @RequirePermissions('item:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.svc.update(ctx, id, dto);
  }

  @Put(':id/locations/:locationId') @RequirePermissions('item:manage')
  setLocation(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Param('locationId', ParseUUIDPipe) locationId: string, @Body() dto: LocationSettingDto) {
    return this.svc.setLocation(ctx, id, locationId, dto);
  }
}

/** Units of measure (LLD s2 settings). */
@Controller('units')
export class UnitsController {
  constructor(private readonly svc: UnitsService) {}

  @Get() @RequirePermissions('item:manage')
  list() {
    return this.svc.list();
  }

  @Post() @RequirePermissions('item:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateUnitDto) {
    return this.svc.create(ctx, dto);
  }

  @Patch(':id') @RequirePermissions('item:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUnitDto) {
    return this.svc.update(ctx, id, dto);
  }
}

/** Daily stock reconciliation, consumption entry, physical counts and the variance report. */
@Controller('stock')
export class ReconciliationController {
  constructor(private readonly svc: ReconciliationService) {}

  @Get('reconciliation') @RequirePermissions('stock:view')
  reconciliation(@Ctx() ctx: ReqCtx, @Query() q: ReconciliationQuery) {
    return this.svc.reconciliation(ctx, q.locationId, q.date);
  }

  @Put('consumption') @RequirePermissions('count:enter')
  consumption(@Ctx() ctx: ReqCtx, @Body() dto: SetConsumptionDto) {
    return this.svc.setConsumption(ctx, dto);
  }

  @Get('variance-report') @RequirePermissions('count:view')
  varianceReport(@Ctx() ctx: ReqCtx, @Query() q: VarianceReportQuery) {
    return this.svc.varianceReport(ctx, q);
  }

  @Get('counts') @RequirePermissions('count:view')
  counts(@Ctx() ctx: ReqCtx, @Query() q: ListCountsQuery) {
    return this.svc.listCounts(ctx, q);
  }

  @Put('counts/:locationId/:date') @RequirePermissions('count:enter')
  save(@Ctx() ctx: ReqCtx, @Param('locationId', ParseUUIDPipe) locationId: string, @Param('date') date: string, @Body() dto: SaveCountDto) {
    return this.svc.saveCount(ctx, locationId, date, dto);
  }

  @Post('counts/:locationId/:date/submit') @HttpCode(200) @RequirePermissions('count:submit')
  submit(@Ctx() ctx: ReqCtx, @Param('locationId', ParseUUIDPipe) locationId: string, @Param('date') date: string) {
    return this.svc.submitCount(ctx, locationId, date);
  }

  @Post('counts/:id/approve') @HttpCode(200) @RequirePermissions('count:approve')
  approve(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approveCount(ctx, id);
  }

  @Post('counts/:id/reject') @HttpCode(200) @RequirePermissions('count:approve')
  reject(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewCountDto) {
    return this.svc.rejectCount(ctx, id, dto);
  }
}

@Controller('wastage')
export class WastageController {
  constructor(private readonly svc: WastageService) {}

  @Get() @RequirePermissions('wastage:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListWastageQuery) {
    return this.svc.list(ctx, q);
  }

  @Get('summary') @RequirePermissions('wastage:view')
  summary(@Ctx() ctx: ReqCtx, @Query() q: WastageSummaryQuery) {
    return this.svc.summary(ctx, q);
  }

  @Post() @RequirePermissions('wastage:create')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateWastageDto) {
    return this.svc.create(ctx, dto);
  }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('wastage:approve')
  approve(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(ctx, id);
  }

  @Post(':id/reject') @HttpCode(200) @RequirePermissions('wastage:approve')
  reject(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WastageActionDto) {
    return this.svc.reject(ctx, id, dto);
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('wastage:create')
  cancel(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WastageActionDto) {
    return this.svc.cancel(ctx, id, dto);
  }
}

@Controller('transfers')
export class TransfersController {
  constructor(private readonly svc: TransfersService) {}

  @Get() @RequirePermissions('transfer:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListTransfersQuery) {
    return this.svc.list(ctx, q);
  }

  @Post() @RequirePermissions('transfer:create')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateTransferDto) {
    return this.svc.create(ctx, dto);
  }

  @Get(':id') @RequirePermissions('transfer:view')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('transfer:approve')
  approve(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(ctx, id);
  }

  @Post(':id/dispatch') @HttpCode(200) @RequirePermissions('transfer:dispatch')
  dispatch(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.dispatch(ctx, id);
  }

  @Post(':id/receive') @HttpCode(200) @RequirePermissions('transfer:receive')
  receive(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveTransferDto) {
    return this.svc.receive(ctx, id, dto);
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('transfer:create')
  cancel(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferActionDto) {
    return this.svc.cancel(ctx, id, dto);
  }
}
