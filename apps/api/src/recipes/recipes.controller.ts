import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import {
  CostTrendQuery, CreateRecipeDto, ListRecipesQuery, RawMaterialTrendQuery, RecipesService, UpdateRecipeDto,
} from './recipes.service';

/** Recipe / cost management: management accounting only, never billing (LLD explicit). */
@Controller('recipes')
export class RecipesController {
  constructor(private readonly svc: RecipesService) {}

  @Get() @RequirePermissions('recipe:view')
  list(@Ctx() ctx: ReqCtx, @Query() q: ListRecipesQuery) {
    return this.svc.list(ctx, q);
  }

  @Get('raw-material-cost-trend') @RequirePermissions('recipe:view')
  rawMaterialTrend(@Ctx() ctx: ReqCtx, @Query() q: RawMaterialTrendQuery) {
    return this.svc.rawMaterialTrend(ctx, q);
  }

  @Get(':id') @RequirePermissions('recipe:view')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/cost-trend') @RequirePermissions('recipe:view')
  costTrend(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Query() q: CostTrendQuery) {
    return this.svc.costTrend(ctx, id, q);
  }

  @Post() @RequirePermissions('recipe:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateRecipeDto) {
    return this.svc.create(ctx, dto);
  }

  @Patch(':id') @RequirePermissions('recipe:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecipeDto) {
    return this.svc.update(ctx, id, dto);
  }
}
