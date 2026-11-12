import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { AddPaymentDto, CreateOrderDto, ListOrdersQuery, OrdersService, UpdateOrderDto } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get() @RequirePermissions('order:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListOrdersQuery) { return this.orders.list(ctx, q); }

  // literal route before ":id"
  @Get('summary') @RequirePermissions('order:view')
  summary(@Ctx() ctx: ReqCtx) { return this.orders.summary(ctx); }

  @Get(':id') @RequirePermissions('order:view')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) { return this.orders.get(ctx, id); }

  @Post() @RequirePermissions('order:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateOrderDto) { return this.orders.create(ctx, dto); }

  @Patch(':id') @RequirePermissions('order:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) { return this.orders.update(ctx, id, dto); }

  @Post(':id/payments') @HttpCode(200) @RequirePermissions('order:manage')
  pay(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddPaymentDto) { return this.orders.addPayment(ctx, id, dto); }
}
