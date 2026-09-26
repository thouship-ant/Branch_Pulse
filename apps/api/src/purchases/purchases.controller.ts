import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { CreatePurchaseDto, ListPurchasesQuery, PurchaseActionDto, PurchaseSummaryQuery, PurchasesService } from './purchases.service';
import { StockMovementsQuery, StockQuery, StockService } from './stock.service';
import { DuesQuery, PaymentHistoryQuery, SupplierReportsService } from './supplier-reports.service';
import { CreateSupplierDto, LedgerQuery, ListSuppliersQuery, SupplierPaymentDto, SuppliersService, UpdateSupplierDto } from './suppliers.service';

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly svc: PurchasesService) {}

  @Get() @RequirePermissions('purchase:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListPurchasesQuery) {
    return this.svc.list(ctx, q);
  }

  @Get('summary') @RequirePermissions('purchase:view')
  summary(@Ctx() ctx: ReqCtx, @Query() q: PurchaseSummaryQuery) {
    return this.svc.summary(ctx, q);
  }

  @Post() @RequirePermissions('purchase:create')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreatePurchaseDto) {
    return this.svc.create(ctx, dto);
  }

  @Get(':id') @RequirePermissions('purchase:view')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('purchase:approve')
  approve(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(ctx, id);
  }

  @Post(':id/reject') @HttpCode(200) @RequirePermissions('purchase:approve')
  reject(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PurchaseActionDto) {
    return this.svc.reject(ctx, id, dto);
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('purchase:create')
  cancel(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PurchaseActionDto) {
    return this.svc.cancel(ctx, id, dto);
  }

  @Post(':id/reverse') @HttpCode(200) @RequirePermissions('purchase:approve')
  reverse(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PurchaseActionDto) {
    return this.svc.reverse(ctx, id, dto);
  }
}

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly svc: SuppliersService, private readonly reports: SupplierReportsService) {}

  @Get('payments') @RequirePermissions('supplier:pay')
  payments(@Ctx() ctx: ReqCtx, @Query() q: PaymentHistoryQuery) {
    return this.reports.payments(ctx, q);
  }

  @Get('dues') @RequirePermissions('supplier:pay')
  dues(@Ctx() ctx: ReqCtx, @Query() q: DuesQuery) {
    return this.reports.dues(ctx, q);
  }

  @Get() @RequirePermissions('supplier:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListSuppliersQuery) {
    return this.svc.list(ctx, q);
  }

  @Post() @RequirePermissions('supplier:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateSupplierDto) {
    return this.svc.create(ctx, dto);
  }

  @Post('payments/:paymentId/reverse') @HttpCode(200) @RequirePermissions('supplier:pay')
  reversePayment(@Ctx() ctx: ReqCtx, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: PurchaseActionDto) {
    return this.svc.reversePayment(ctx, paymentId, dto.reason);
  }

  @Get(':id') @RequirePermissions('supplier:view')
  profile(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.profile(ctx, id);
  }

  @Patch(':id') @RequirePermissions('supplier:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.svc.update(ctx, id, dto);
  }

  @Get(':id/ledger') @RequirePermissions('supplier:pay')
  statement(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Query() q: LedgerQuery) {
    return this.svc.statement(ctx, id, q);
  }

  @Post(':id/payments') @RequirePermissions('supplier:pay')
  pay(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierPaymentDto) {
    return this.svc.pay(ctx, id, dto);
  }
}

@Controller('stock')
export class StockController {
  constructor(private readonly svc: StockService) {}

  @Get() @RequirePermissions('stock:view')
  levels(@Ctx() ctx: ReqCtx, @Query() q: StockQuery) {
    return this.svc.levels(ctx, q);
  }

  @Get('movements') @RequirePermissions('stock:view')
  movements(@Ctx() ctx: ReqCtx, @Query() q: StockMovementsQuery) {
    return this.svc.movements(ctx, q);
  }
}
