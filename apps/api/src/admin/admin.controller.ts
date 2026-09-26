import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { Ctx, ReqCtx, RequirePermissions } from '../common/auth-user';
import { CreateLocationDto, LocationsService, UpdateLocationDto } from './locations.service';
import { ApprovalLimitDto, CategoryDto, MasterService, SettingValueDto, UpdateCategoryDto } from './master.service';
import { CreateUserDto, UpdateUserDto, UsersService } from './users.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly svc: LocationsService) {}

  @Get() @RequirePermissions('location:view')
  list(@Ctx() ctx: ReqCtx, @Query('type') type?: string) {
    return this.svc.list(ctx, type);
  }

  @Get(':id') @RequirePermissions('location:view')
  get(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ctx, id);
  }

  @Get(':id/history') @RequirePermissions('location:view')
  history(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.history(ctx, id);
  }

  @Post() @RequirePermissions('location:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateLocationDto) {
    return this.svc.create(ctx, dto);
  }

  @Patch(':id') @RequirePermissions('location:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto) {
    return this.svc.update(ctx, id, dto);
  }

  @Post(':id/activate') @HttpCode(200) @RequirePermissions('location:manage')
  activate(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setActive(ctx, id, true);
  }

  @Post(':id/deactivate') @HttpCode(200) @RequirePermissions('location:manage')
  deactivate(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.setActive(ctx, id, false);
  }
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get() @RequirePermissions('user:manage')
  list() {
    return this.users.list();
  }

  @Post() @RequirePermissions('user:manage')
  create(@Ctx() ctx: ReqCtx, @Body() dto: CreateUserDto) {
    return this.users.create(ctx, dto);
  }

  @Patch(':id') @RequirePermissions('user:manage')
  update(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(ctx, id, dto);
  }

  @Post(':id/sessions/revoke') @HttpCode(200) @RequirePermissions('user:manage')
  revoke(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeUserSessions(id, ctx);
  }
}

@Controller()
export class MasterController {
  constructor(private readonly master: MasterService) {}

  // any authenticated user may read categories (entry screens need them)
  @Get('expense-categories')
  categories() {
    return this.master.listCategories();
  }

  @Post('expense-categories') @RequirePermissions('settings:manage')
  createCategory(@Ctx() ctx: ReqCtx, @Body() dto: CategoryDto) {
    return this.master.createCategory(ctx, dto);
  }

  @Patch('expense-categories/:id') @RequirePermissions('settings:manage')
  updateCategory(@Ctx() ctx: ReqCtx, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.master.updateCategory(ctx, id, dto);
  }

  @Get('settings') @RequirePermissions('settings:manage')
  settings() {
    return this.master.allSettings();
  }

  @Put('settings/:key') @RequirePermissions('settings:manage')
  putSetting(@Ctx() ctx: ReqCtx, @Param('key') key: string, @Body() dto: SettingValueDto) {
    return this.master.putSetting(ctx, key, dto.value);
  }

  @Get('approval-limits') @RequirePermissions('settings:manage')
  limits() {
    return this.master.listLimits();
  }

  @Put('approval-limits') @RequirePermissions('settings:manage')
  putLimit(@Ctx() ctx: ReqCtx, @Body() dto: ApprovalLimitDto) {
    return this.master.putLimit(ctx, dto);
  }
}
