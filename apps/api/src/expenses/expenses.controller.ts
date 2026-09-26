import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { CreateExpenseDto, ExpenseActionDto, ExpensesService, ListExpensesQuery, UpdateExpenseDto } from './expenses.service';

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly svc: ExpensesService) {}

  @Get() @RequirePermissions('expense:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListExpensesQuery) {
    return this.svc.list(ctx, q);
  }

  @Post() @RequirePermissions('expense:create')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateExpenseDto) {
    return this.svc.create(ctx, dto);
  }

  @Get(':id') @RequirePermissions('expense:view')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Patch(':id') @RequirePermissions('expense:edit')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('expense:approve')
  approve(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(ctx, id);
  }

  @Post(':id/reject') @HttpCode(200) @RequirePermissions('expense:approve')
  reject(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExpenseActionDto) {
    return this.svc.reject(ctx, id, dto);
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('expense:create')
  cancel(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExpenseActionDto) {
    return this.svc.cancel(ctx, id, dto);
  }

  @Post(':id/reverse') @HttpCode(200) @RequirePermissions('expense:reverse')
  reverse(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExpenseActionDto) {
    return this.svc.reverse(ctx, id, dto);
  }
}
